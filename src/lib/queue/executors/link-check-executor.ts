/**
 * Link Check 任务执行器
 *
 * 负责执行链接可用性检查任务，包括：
 * - 检查Offer的推广链接是否可访问
 * - 复用offer创建时的"推广链接解析"功能（resolveAffiliateLink）
 * - 如果能提取出final url和final url suffix，说明链接有效
 * - 检查Google Ads账号状态
 * - 生成风险提示
 *
 * 🔄 迁移自 scheduler.ts 中的 linkAndAccountCheckTask()
 * 优势：支持并发控制、失败重试、按用户隔离执行、复用URL解析逻辑
 */

import type { Task, TaskExecutor } from '../types'
import { dailyLinkCheck } from '@/lib/risk-alerts'
import { resolveAffiliateLink } from '@/lib/url-resolver'
import { getDatabase } from '@/lib/db'
import { getProxyForCountry } from '../user-proxy-loader'
import { analyzeProxyError } from './proxy-error-handler'
import { pauseClickFarmTasksByOfferId } from '../../click-farm'
import { pauseUrlSwapTargetsByOfferId } from '../../url-swap'

/**
 * Link Check 任务数据接口
 */
export interface LinkCheckTaskData {
  checkType: 'daily' | 'manual' | 'single-offer'
  userId?: number  // 可选，指定用户ID时只检查该用户
  offerId?: number // 可选，指定Offer ID时只检查该Offer
  useUrlResolver?: boolean  // 是否使用URL解析器验证（默认true）
}

/**
 * Link Check 任务结果接口
 */
export interface LinkCheckTaskResult {
  success: boolean
  totalUsers: number
  totalLinks: number
  totalAlerts: number
  brokenLinks: number
  validLinks: number
  pausedCampaigns: number  // 🔧 新增：暂停的广告系列数
  pausedClickFarmTasks: number  // 🔧 新增：暂停的补点击任务数
  pausedUrlSwapTasks: number  // 🔧 新增：暂停的换链接任务数
  deactivatedOffers: number  // 🔧 新增：停用的 Offer 数
  accountChecks: {
    totalAccounts: number
    problemAccounts: number
  }
  errorMessage?: string
  duration: number  // 检查耗时（毫秒）
}

/**
 * 使用URL解析器验证单个链接
 * 复用offer创建时的推广链接解析功能
 */
async function validateLinkWithResolver(
  affiliateLink: string,
  targetCountry: string,
  userId: number
): Promise<{ isValid: boolean; finalUrl?: string; finalUrlSuffix?: string; error?: string }> {
  try {
    // 获取用户配置的代理
    const proxyConfig = await getProxyForCountry(targetCountry, userId)
    const proxyUrl = proxyConfig?.originalUrl

    // 使用URL解析器解析链接（不使用缓存，确保实时检查）
    const resolved = await resolveAffiliateLink(affiliateLink, proxyUrl, false)

    // 如果能提取出final url和final url suffix，说明链接有效
    if (resolved.finalUrl && resolved.finalUrl.length > 0) {
      return {
        isValid: true,
        finalUrl: resolved.finalUrl,
        finalUrlSuffix: resolved.finalUrlSuffix
      }
    } else {
      return {
        isValid: false,
        error: '无法解析到最终URL'
      }
    }
  } catch (error: any) {
    const errorAnalysis = analyzeProxyError(error)
    return {
      isValid: false,
      error: errorAnalysis.isProxyError
        ? errorAnalysis.enhancedMessage
        : (error.message || '链接解析失败')
    }
  }
}

/**
 * 创建 Link Check 任务执行器
 */
export function createLinkCheckExecutor(): TaskExecutor<LinkCheckTaskData, LinkCheckTaskResult> {
  return async (task: Task<LinkCheckTaskData>) => {
    const { checkType, userId, offerId, useUrlResolver = true } = task.data

    console.log(`🔍 [LinkCheckExecutor] 开始链接检查任务: 类型=${checkType}, 用户=${userId || 'all'}, Offer=${offerId || 'all'}, 使用URL解析器=${useUrlResolver}`)

    const startTime = Date.now()

    try {
      // 如果使用URL解析器验证（推荐方式）
      if (useUrlResolver) {
        const db = await getDatabase()

        // 🔧 修复: PostgreSQL BOOLEAN 兼容性
        const isActiveCondition = db.type === 'postgres' ? 'o.is_active = true' : 'o.is_active = 1'

        // 构建查询条件
        let query = `
          SELECT o.id, o.affiliate_link, o.target_country, o.user_id, o.brand, o.offer_name
          FROM offers o
          WHERE ${isActiveCondition} AND o.affiliate_link IS NOT NULL
        `
        const params: any[] = []

        if (userId) {
          query += ' AND o.user_id = ?'
          params.push(userId)
        }
        if (offerId) {
          query += ' AND o.id = ?'
          params.push(offerId)
        }

        const offers = await db.query<{
          id: number
          affiliate_link: string
          target_country: string
          user_id: number
          brand: string
          offer_name: string | null
        }>(query, params)

        console.log(`   找到 ${offers.length} 个需要检查的Offer`)

        let validLinks = 0
        let brokenLinks = 0
        let totalAlerts = 0

        // 逐个检查链接
        for (const offer of offers) {
          const displayName = offer.offer_name || offer.brand || `Offer #${offer.id}`
          const result = await validateLinkWithResolver(
            offer.affiliate_link,
            offer.target_country || 'US',
            offer.user_id
          )

          if (result.isValid) {
            validLinks++
            console.log(`   ✅ ${displayName}: 链接有效`)
          } else {
            brokenLinks++
            totalAlerts++
            console.log(`   ❌ ${displayName}: 链接失效 - ${result.error}`)

            const isDeletedFalse = db.type === 'postgres' ? 'FALSE' : '0'
            // 🔧 暂停关联的广告系列
            const pausedCampaigns = await (async () => {
              try {
                const result = await db.exec(`
                  UPDATE campaigns
                  SET status = 'PAUSED',
                      updated_at = ?
                  WHERE offer_id = ?
                    AND status != 'PAUSED'
                    AND is_deleted = ${isDeletedFalse}
                `, [new Date(), offer.id])
                console.log(`   ⏸️  已暂停 ${result.changes || 0} 个广告系列`)
                return result.changes || 0
              } catch (error: any) {
                console.error(`   ⚠️  暂停广告系列失败:`, error.message)
                return 0
              }
            })()

            // 🔧 暂停补点击任务
            const pausedClickFarm = await pauseClickFarmTasksByOfferId(offer.id)
            console.log(`   ⏸️  已暂停 ${pausedClickFarm} 个补点击任务`)

            // 🔧 暂停换链接任务
            const pausedUrlSwap = await pauseUrlSwapTargetsByOfferId(offer.id)
            console.log(`   ⏸️  已暂停 ${pausedUrlSwap} 个换链接任务`)

            // 🔧 停用 Offer
            try {
              await db.exec(`
                UPDATE offers
                SET is_active = ?,
                    updated_at = ?
                WHERE id = ?
              `, [db.type === 'postgres' ? 'FALSE' : '0', new Date(), offer.id])
              console.log(`   ⏸️  已停用 Offer ${offer.id}`)
            } catch (error: any) {
              console.error(`   ⚠️  停用 Offer 失败:`, error.message)
            }

            // 创建风险提示
            await db.exec(`
              INSERT INTO risk_alerts (user_id, alert_type, severity, resource_type, resource_id, title, message, status)
              VALUES (?, 'broken_link', 'warning', 'offer', ?, ?, ?, 'active')
            `, [
              offer.user_id,
              offer.id,
              `推广链接失效: ${displayName}`,
              `Offer "${displayName}" 的推广链接无法正常解析。错误：${result.error}. 已自动暂停 ${pausedCampaigns} 个广告系列、${pausedClickFarm} 个补点击任务、${pausedUrlSwap} 个换链接任务，并停用 Offer`
            ])
          }
        }

        const duration = Date.now() - startTime

        console.log(`✅ [LinkCheckExecutor] 链接检查完成: 有效=${validLinks}, 失效=${brokenLinks}, 新风险提示=${totalAlerts}, 耗时=${duration}ms`)

        const timeThreshold = db.type === 'postgres'
          ? "(CURRENT_TIMESTAMP - INTERVAL '1 hour')"
          : "datetime('now', '-1 hour')"
        const createdAtField = db.type === 'postgres' 
          ? "created_at::timestamptz" 
          : "created_at";
        // 🔧 统计暂停的资源数量（从 risk_alerts 中解析）
        const recentAlerts = await db.query(`
          SELECT message FROM risk_alerts
          WHERE alert_type = 'broken_link'
            AND ${createdAtField} >= ${timeThreshold}
          ORDER BY created_at DESC
          LIMIT ?
        `, [totalAlerts]) as Array<{ message: string }>

        let pausedCampaigns = 0
        let pausedClickFarmTasks = 0
        let pausedUrlSwapTasks = 0

        for (const alert of recentAlerts) {
          const match = alert.message.match(/已自动暂停 (\d+) 个广告系列、(\d+) 个补点击任务、(\d+) 个换链接任务/)
          if (match) {
            pausedCampaigns += parseInt(match[1], 10)
            pausedClickFarmTasks += parseInt(match[2], 10)
            pausedUrlSwapTasks += parseInt(match[3], 10)
          }
        }

        return {
          success: true,
          totalUsers: new Set(offers.map(o => o.user_id)).size,
          totalLinks: offers.length,
          totalAlerts,
          brokenLinks,
          validLinks,
          pausedCampaigns,
          pausedClickFarmTasks,
          pausedUrlSwapTasks,
          deactivatedOffers: brokenLinks,  // 失效的 Offer 都会被停用
          accountChecks: { totalAccounts: 0, problemAccounts: 0 },
          duration
        }
      }

      // 使用原有的dailyLinkCheck方法（兼容旧逻辑）
      const result = await dailyLinkCheck()

      let brokenLinks = 0
      Object.values(result.results).forEach((r: any) => {
        brokenLinks += r.broken || 0
      })

      const duration = Date.now() - startTime

      console.log(`✅ [LinkCheckExecutor] 链接检查完成: 用户数=${result.totalUsers}, 链接数=${result.totalLinks}, 新风险提示=${result.totalAlerts}, 耗时=${duration}ms`)

      return {
        success: true,
        totalUsers: result.totalUsers,
        totalLinks: result.totalLinks,
        totalAlerts: result.totalAlerts,
        brokenLinks,
        validLinks: result.totalLinks - brokenLinks,
        pausedCampaigns: 0,  // 原有逻辑不包含暂停功能
        pausedClickFarmTasks: 0,
        pausedUrlSwapTasks: 0,
        deactivatedOffers: 0,
        accountChecks: result.accountChecks,
        duration
      }
    } catch (error: any) {
      const duration = Date.now() - startTime
      console.error(`❌ [LinkCheckExecutor] 链接检查失败: ${error.message}, 耗时=${duration}ms`)

      return {
        success: false,
        totalUsers: 0,
        totalLinks: 0,
        totalAlerts: 0,
        brokenLinks: 0,
        validLinks: 0,
        pausedCampaigns: 0,
        pausedClickFarmTasks: 0,
        pausedUrlSwapTasks: 0,
        deactivatedOffers: 0,
        accountChecks: { totalAccounts: 0, problemAccounts: 0 },
        errorMessage: error.message,
        duration
      }
    }
  }
}
