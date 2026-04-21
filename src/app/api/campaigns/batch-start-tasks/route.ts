import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { createClickFarmTask, updateClickFarmTask } from '@/lib/click-farm'
import { getClickFarmTaskByOfferId } from '@/lib/click-farm'
import { createUrlSwapTask, updateUrlSwapTask, getUrlSwapTaskByOfferId } from '@/lib/url-swap'
import { generateDefaultDistribution } from '@/lib/click-farm/distribution'

/**
 * POST /api/campaigns/batch-start-tasks
 * 批量开启广告系列关联 Offer 的补点击和换链任务
 * 
 * 公共配置：
 * - 补点击：每日点击数 10、开始日期（当前日期）、时间段 - 白天 (06:00-24:00)、持续时长（不限期）、Referer 类型（留空）、时间分布曲线（均衡分布）
 * - 换链接：换链方式（方式一：自动访问推广链接解析）、换链间隔（24 小时）、任务持续（不限期）
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const body = await request.json()
    const { campaignIds, enableClickFarm = true, enableUrlSwap = true } = body

    if (!campaignIds || !Array.isArray(campaignIds) || campaignIds.length === 0) {
      return NextResponse.json(
        { error: '请选择至少一个广告系列' },
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 查询广告系列关联的 Offer
    const campaigns = await db.query(`
      SELECT DISTINCT o.id as offer_id, o.url as offer_url, o.affiliate_link, o.target_country
      FROM campaigns c
      INNER JOIN offers o ON c.offer_id = o.id
      WHERE c.id = ANY(?) AND c.user_id = ? AND c.is_deleted = 0
        AND o.is_deleted = 0
    `, [campaignIds, userId]) as Array<{
      offer_id: number
      offer_url: string
      affiliate_link: string
      target_country: string
    }>

    if (campaigns.length === 0) {
      return NextResponse.json(
        { error: '未找到有效的广告系列或 Offer' },
        { status: 404 }
      )
    }

    const result = {
      success: true,
      clickFarmTasksCreated: 0,
      clickFarmTasksUpdated: 0,
      urlSwapTasksCreated: 0,
      urlSwapTasksUpdated: 0,
      errors: [] as Array<{ offerId: number; type: string; error: string }>,
    }

    // 公共配置
    const today = new Date().toISOString().split('T')[0]
    const clickFarmConfig = {
      dailyClickCount: 10,
      startTime: '06:00',
      endTime: '24:00',
      durationDays: 9999,  // 不限期
      scheduledStartDate: today,
      timezone: 'America/New_York',  // 默认时区
      hourlyDistribution: generateDefaultDistribution(10, '06:00', '24:00'),
      refererConfig: { type: 'none' as const },
    }

    const urlSwapConfig = {
      swapMode: 'auto' as const,
      swapIntervalMinutes: 1440,  // 24 小时
      durationDays: -1,  // 不限期
    }

    // 为每个 Offer 创建或更新任务
    for (const campaign of campaigns) {
      try {
        const timezone = getTimezoneByCountry(campaign.target_country || 'US')

        // 处理补点击任务
        if (enableClickFarm) {
          try {
            // 检查是否已有任务
            const existingTask = await getClickFarmTaskByOfferId(campaign.offer_id, userId)

            if (existingTask) {
              // 更新现有任务
              await updateClickFarmTask(existingTask.id, userId, {
                daily_click_count: clickFarmConfig.dailyClickCount,
                start_time: clickFarmConfig.startTime,
                end_time: clickFarmConfig.endTime,
                duration_days: clickFarmConfig.durationDays,
                scheduled_start_date: clickFarmConfig.scheduledStartDate,
                hourly_distribution: clickFarmConfig.hourlyDistribution,
                timezone: timezone,
                referer_config: clickFarmConfig.refererConfig,
              })
              result.clickFarmTasksUpdated++
            } else {
              // 创建新任务
              await createClickFarmTask(userId, {
                offer_id: campaign.offer_id,
                daily_click_count: clickFarmConfig.dailyClickCount,
                start_time: clickFarmConfig.startTime,
                end_time: clickFarmConfig.endTime,
                duration_days: clickFarmConfig.durationDays,
                scheduled_start_date: clickFarmConfig.scheduledStartDate,
                hourly_distribution: clickFarmConfig.hourlyDistribution,
                timezone: timezone,
                referer_config: clickFarmConfig.refererConfig,
              })
              result.clickFarmTasksCreated++
            }
          } catch (error: any) {
            result.errors.push({
              offerId: campaign.offer_id,
              type: 'clickFarm',
              error: error.message,
            })
          }
        }

        // 处理换链接任务
        if (enableUrlSwap) {
          try {
            // 检查是否已有任务
            const existingTask = await getUrlSwapTaskByOfferId(campaign.offer_id, userId)

            if (existingTask) {
              // 更新现有任务
              await updateUrlSwapTask(existingTask.id, userId, {
                swap_interval_minutes: urlSwapConfig.swapIntervalMinutes,
                duration_days: urlSwapConfig.durationDays,
              })
              result.urlSwapTasksUpdated++
            } else {
              // 创建新任务
              await createUrlSwapTask(userId, {
                offer_id: campaign.offer_id,
                swap_mode: urlSwapConfig.swapMode,
                swap_interval_minutes: urlSwapConfig.swapIntervalMinutes,
                duration_days: urlSwapConfig.durationDays,
              })
              result.urlSwapTasksCreated++
            }
          } catch (error: any) {
            result.errors.push({
              offerId: campaign.offer_id,
              type: 'urlSwap',
              error: error.message,
            })
          }
        }
      } catch (error: any) {
        result.errors.push({
          offerId: campaign.offer_id,
          type: 'general',
          error: error.message,
        })
        console.error(`[Batch Start Tasks] Error for offer ${campaign.offer_id}:`, error)
      }
    }

    return NextResponse.json({
      success: true,
      message: `成功处理 ${result.clickFarmTasksCreated + result.clickFarmTasksUpdated} 个补点击任务和 ${result.urlSwapTasksCreated + result.urlSwapTasksUpdated} 个换链接任务`,
      data: result,
    })
  } catch (error: any) {
    console.error('批量开启任务失败:', error)
    return NextResponse.json(
      { error: error.message || '批量开启任务失败' },
      { status: 500 }
    )
  }
}

/**
 * 根据国家代码获取时区
 */
function getTimezoneByCountry(countryCode: string): string {
  const timezoneMap: Record<string, string> = {
    'US': 'America/New_York',
    'GB': 'Europe/London',
    'CA': 'America/Toronto',
    'AU': 'Australia/Sydney',
    'DE': 'Europe/Berlin',
    'FR': 'Europe/Paris',
    'JP': 'Asia/Tokyo',
    'CN': 'Asia/Shanghai',
  }
  return timezoneMap[countryCode] || 'America/New_York'
}
