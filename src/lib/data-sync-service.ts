import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB, enums } from './google-ads-api'
import { getServiceAccountConfig } from './google-ads-service-account'
import { getDatabase } from './db'
import { getUserAuthType, getGoogleAdsCredentials } from './google-ads-oauth'
import { executeGAQLQueryPython } from './python-ads-client'
import { getInsertedId, nowFunc } from './db-helpers'
import { createRiskAlert } from './risk-alerts'
import { resolveLoginCustomerCandidates, isGoogleAdsAccountAccessError } from './google-ads-login-customer'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import { normalizeCountryCode, normalizeLanguageCode } from './language-country-codes'
import { normalizeBrandKey, refreshBrandCoreKeywordCache } from './brand-core-keywords'
import { isInvalidKeyword } from './keyword-invalid-filter'
import { trackApiUsage, ApiOperationType } from './google-ads-api-tracker'

/**
 * 同步状态
 */
export interface SyncStatus {
  isRunning: boolean
  lastSyncAt: string | null
  nextSyncAt: string | null
  lastSyncDuration: number | null
  lastSyncRecordCount: number
  lastSyncError: string | null
}

/**
 * 同步日志
 * 🔧 修复(2025-12-11): 统一使用 camelCase 字段名
 */
export interface SyncLog {
  id: number
  userId: number
  googleAdsAccountId: number
  syncType: 'manual' | 'auto'
  status: 'success' | 'failed' | 'running'
  recordCount: number
  durationMs: number
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

/**
 * GAQL查询参数
 * 🔧 修复(2025-12-12): 独立账号模式 - 添加凭证参数
 * 🔧 修复(2025-12-24): 服务账号模式支持
 */
export interface GAQLQueryParams {
  customerId: string
  refreshToken?: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  accountId: number
  userId: number
  accountParentMccId?: string
  credentials?: {
    client_id: string
    client_secret: string
    developer_token: string
    login_customer_id?: string
  }
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}

/**
 * Campaign性能数据
 */
export interface CampaignPerformanceData {
  campaign_id: string
  campaign_name: string
  date: string
  impressions: number
  clicks: number
  conversions: number
  cost: number
  ctr: number
  cpc: number
  conversion_rate: number
  currency_code?: string
  time_zone?: string
}

/**
 * 搜索词报告数据
 */
export interface SearchTermPerformanceData {
  campaign_id: string
  ad_group_id: string
  search_term: string
  search_term_match_type: string
  date: string
  impressions: number
  clicks: number
  conversions: number
  cost: number
}

/**
 * 关键词表现数据
 */
export interface KeywordPerformanceData {
  campaign_id: string
  keyword_text: string
  date: string
  impressions: number
  clicks: number
}

/**
 * DataSyncService - 数据同步服务
 * 负责从Google Ads API拉取性能数据并存储到SQLite
 */
export class DataSyncService {
  private static instance: DataSyncService
  private static googleAdsQuotaBackoffUntilMs = 0
  private syncStatus: Map<number, SyncStatus> = new Map()

  private normalizeCurrency(value: unknown): string {
    const normalized = String(value ?? '').trim().toUpperCase()
    return normalized || 'USD'
  }

  private normalizeSearchTermMatchType(raw: unknown): 'EXACT' | 'PHRASE' | 'BROAD' | 'UNKNOWN' {
    const value = String(raw ?? '').trim().toUpperCase()
    if (!value) return 'UNKNOWN'

    if (value.includes('EXACT')) return 'EXACT'
    if (value.includes('PHRASE')) return 'PHRASE'
    if (value.includes('BROAD')) return 'BROAD'

    return 'UNKNOWN'
  }

  private constructor() {}

  static getInstance(): DataSyncService {
    if (!DataSyncService.instance) {
      DataSyncService.instance = new DataSyncService()
    }
    return DataSyncService.instance
  }

  private getGoogleAdsQuotaBackoffSecondsRemaining(): number {
    const remainingMs = DataSyncService.googleAdsQuotaBackoffUntilMs - Date.now()
    if (remainingMs <= 0) return 0
    return Math.ceil(remainingMs / 1000)
  }

  private isGoogleAdsQuotaErrorMessage(message: string): boolean {
    const normalized = message.toLowerCase()
    return (
      normalized.includes('quota_error') ||
      normalized.includes('too many requests') ||
      normalized.includes('number of operations for explorer access')
    )
  }

  private extractRetryInSeconds(message: string): number | null {
    const match = message.match(/retry in\s+(\d+)\s+seconds/i)
    if (!match) return null
    const seconds = parseInt(match[1], 10)
    if (!Number.isFinite(seconds) || seconds <= 0) return null
    return seconds
  }

  private markGoogleAdsQuotaBackoffIfNeeded(error: unknown, source: string): number {
    const message = this.buildSyncErrorMessage(error)
    if (!this.isGoogleAdsQuotaErrorMessage(message)) return 0

    const retryInSeconds = this.extractRetryInSeconds(message)
    if (!retryInSeconds) return 0

    const until = Date.now() + retryInSeconds * 1000
    if (until > DataSyncService.googleAdsQuotaBackoffUntilMs) {
      DataSyncService.googleAdsQuotaBackoffUntilMs = until
      console.warn(
        `[DataSync] 检测到Google Ads配额限制，触发全局冷却 ${retryInSeconds}s（来源: ${source}）`
      )
    }

    return this.getGoogleAdsQuotaBackoffSecondsRemaining()
  }

  /**
   * 获取同步状态
   */
  getSyncStatus(userId: number): SyncStatus {
    return this.syncStatus.get(userId) || {
      isRunning: false,
      lastSyncAt: null,
      nextSyncAt: null,
      lastSyncDuration: null,
      lastSyncRecordCount: 0,
      lastSyncError: null,
    }
  }

  /**
   * 获取指定Campaign在过去N天内已同步的日期列表
   */
  async getSyncedDates(
    userId: number,
    campaignId: number,
    days: number = 7
  ): Promise<string[]> {
    const db = await getDatabase()

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    const rows = await db.query(
      `
      SELECT DISTINCT date
      FROM campaign_performance
      WHERE user_id = ? AND campaign_id = ? AND date >= ?
      ORDER BY date
    `,
      [userId, campaignId, this.formatDate(cutoffDate)]
    ) as Array<{ date: string }>

    return rows.map(r => r.date)
  }

  /**
   * 获取过去N天所有日期列表
   */
  private getDateRange(days: number): string[] {
    const dates: string[] = []
    const today = new Date()

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date()
      date.setDate(today.getDate() - i)
      dates.push(this.formatDate(date))
    }

    return dates
  }

  /**
   * 检测缺失的日期
   * @returns 缺失的日期列表
   */
  async getMissingDates(
    userId: number,
    campaignId: number,
    days: number = 7
  ): Promise<string[]> {
    const syncedDates = await this.getSyncedDates(userId, campaignId, days)
    const syncedSet = new Set(syncedDates)
    const allDates = this.getDateRange(days)

    return allDates.filter(date => !syncedSet.has(date))
  }

  /**
   * 执行数据同步（手动触发或定时任务）
   * 🔧 修复(2025-12-12): 独立账号模式 - 使用用户凭证
   * 🔧 修复(2025-12-28): 添加僵尸任务清理机制
   * 🔧 修复(2025-12-28): 智能补齐过去7天缺失数据
   */
  async syncPerformanceData(
    userId: number,
    syncType: 'manual' | 'auto' = 'manual',
    options?: {
      startDate?: string
      endDate?: string
      forceFullSync?: boolean  // 强制全量补齐（过去7天）
      smartFillMissing?: boolean  // 智能补齐缺失数据（默认true）
    }
  ): Promise<SyncLog> {
    const db = await getDatabase()
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    // 🔧 修复(2025-12-28): 清理僵尸任务（超过2小时仍为running状态的任务）
    const zombieThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    await db.exec(`
      UPDATE sync_logs
      SET status = 'failed',
          error_message = '任务超时被系统取消（僵尸任务清理）',
          completed_at = ?
      WHERE user_id = ?
        AND status = 'running'
        AND started_at < ?
    `, [startedAt, userId, zombieThreshold])
    console.log(`🧹 已清理用户 ${userId} 的僵尸同步任务`)

    // 更新同步状态为运行中
    this.syncStatus.set(userId, {
      isRunning: true,
      lastSyncAt: null,
      nextSyncAt: null,
      lastSyncDuration: null,
      lastSyncRecordCount: 0,
      lastSyncError: null,
    })

    let recordCount = 0
    let syncLogId: number | undefined

    try {
      // 🔧 修复(2025-12-29): 支持两种认证方式 (OAuth + 服务账号)
      // 先判断用户使用哪种认证方式
      const auth = await getUserAuthType(userId)

      // 对于OAuth模式，需要检查system_settings中的凭证
      // 对于服务账号模式，凭证在google_ads_service_accounts表中，此处无需检查
      if (auth.authType === 'oauth') {
        const credentials = await getGoogleAdsCredentialsFromDB(userId)
        if (!credentials) {
          throw new Error('Google Ads 凭证未配置，请在设置页面完成配置')
        }
        if (!credentials.client_id || !credentials.client_secret || !credentials.developer_token) {
          throw new Error('Google Ads 凭证配置不完整，请在设置页面完成配置')
        }
      } else {
        // 服务账号模式：验证服务账号配置是否存在
        const serviceAccount = await getServiceAccountConfig(userId, auth.serviceAccountId)
        if (!serviceAccount) {
          throw new Error('未找到服务账号配置，请上传服务账号JSON文件')
        }
        if (!serviceAccount.mccCustomerId || !serviceAccount.developerToken || !serviceAccount.serviceAccountEmail || !serviceAccount.privateKey) {
          throw new Error('服务账号配置不完整，请检查服务账号参数')
        }
      }

      // 获取凭证（仅OAuth模式需要）
      const credentials = auth.authType === 'oauth'
        ? await getGoogleAdsCredentialsFromDB(userId)
        : null

      const userCredentials = credentials ? {
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        developer_token: credentials.developer_token,
        login_customer_id: credentials.login_customer_id || undefined
      } : undefined

      // 🔧 PostgreSQL兼容性修复: is_active在PostgreSQL中是BOOLEAN类型
      const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

      // 1. 获取用户的所有Google Ads账户
      // 🔧 修复(2025-12-30): 添加currency字段以支持多货币账户
      // 🔧 修复(2026-01-03): 添加account_name字段用于风险警报显示
      const accounts = await db.query(
        `
        SELECT id, customer_id, parent_mcc_id, account_name, refresh_token, user_id, service_account_id, currency
        FROM google_ads_accounts
        WHERE user_id = ? AND ${isActiveCondition}
      `,
        [userId]
      ) as Array<{
        id: number
        customer_id: string
        parent_mcc_id: string | null
        account_name: string | null
        refresh_token: string
        user_id: number
        service_account_id: string | null
        currency: string | null
      }>

      if (accounts.length === 0) {
        throw new Error('未找到活跃的Google Ads账户')
      }

      // 2. 为每个账户同步数据
      for (const account of accounts) {
        let accountSyncLogId: number | undefined
        try {
          // 创建同步日志记录
          const logResult = await db.exec(
            `
            INSERT INTO sync_logs (
              user_id, google_ads_account_id, sync_type, status,
              record_count, duration_ms, started_at
            ) VALUES (?, ?, ?, 'running', 0, 0, ?)
          `,
            [userId, account.id, syncType, startedAt]
          )

          accountSyncLogId = getInsertedId(logResult, db.type)
          syncLogId = accountSyncLogId  // 保留最后一个syncLogId用于整体同步日志

          const quotaBackoffRemaining = this.getGoogleAdsQuotaBackoffSecondsRemaining()
          if (quotaBackoffRemaining > 0) {
            const skipMessage = `Google Ads API 配额冷却中，跳过剩余账户（约 ${quotaBackoffRemaining}s）`
            console.warn(`[DataSync] ${skipMessage}`)
            await db.exec(
              `
              UPDATE sync_logs
              SET status = 'success', record_count = 0, error_message = ?, duration_ms = ?, completed_at = ?
              WHERE id = ?
              `,
              [skipMessage, Date.now() - startTime, new Date().toISOString(), accountSyncLogId]
            )
            break
          }

          // 查询该账户下的所有Campaigns
          const campaigns = await db.query(
            `
            SELECT
              c.id,
              c.google_campaign_id,
              c.campaign_name,
              c.is_test_variant,
              c.offer_id,
              o.brand,
              o.target_country,
              o.target_language
            FROM campaigns c
            JOIN offers o ON o.id = c.offer_id
            WHERE c.user_id = ? AND c.google_ads_account_id = ?
              AND c.google_campaign_id IS NOT NULL
          `,
            [userId, account.id]
          ) as Array<{
            id: number
            google_campaign_id: string
            campaign_name: string
            is_test_variant: boolean | number
            offer_id: number
            brand: string
            target_country: string
            target_language: string | null
          }>

          if (campaigns.length === 0) {
            console.log(`账户 ${account.customer_id} 没有已同步的Campaigns，跳过`)
            // 🔧 修复(2025-12-28): 清理没有campaigns的账户的sync_log（标记为success，但record_count=0）
            await db.exec(
              `
              UPDATE sync_logs
              SET status = 'success', record_count = 0, duration_ms = ?, completed_at = ?
              WHERE id = ?
              `,
              [Date.now() - startTime, new Date().toISOString(), accountSyncLogId]
            )
            continue
          }

          const campaignMap = new Map<string, (typeof campaigns)[number]>()
          for (const campaign of campaigns) {
            if (campaign.google_campaign_id) {
              campaignMap.set(campaign.google_campaign_id, campaign)
            }
          }

          // 3. 使用GAQL查询性能数据（最近7天）
          const endDate = new Date()
          const startDate = new Date()
          startDate.setDate(startDate.getDate() - 7)

          const auth = await getUserAuthType(userId)

          // 🔧 修复(2025-12-28): OAuth模式下需要从google_ads_credentials获取refresh_token
          let refreshToken = account.refresh_token || undefined
          if (auth.authType === 'oauth' && !refreshToken) {
            // 从google_ads_credentials表获取refresh_token
            const oauthCredentials = await getGoogleAdsCredentials(userId)
            refreshToken = oauthCredentials?.refresh_token || undefined

            if (!refreshToken) {
              console.warn(`⚠️ 用户 ${userId} OAuth模式下缺少refresh_token，跳过账户 ${account.customer_id}`)
              // 🔧 修复(2025-12-28): 清理因凭证缺失而无法同步的sync_log
              await db.exec(
                `
                UPDATE sync_logs
                SET status = 'failed', error_message = ?, duration_ms = ?, completed_at = ?
                WHERE id = ?
                `,
                [
                  `OAuth模式下缺少refresh_token，无法同步`,
                  Date.now() - startTime,
                  new Date().toISOString(),
                  accountSyncLogId
                ]
              )
              continue
            }
          }

          const startDateStr = this.formatDate(startDate)
          const endDateStr = this.formatDate(endDate)

          const performanceData = await this.queryPerformanceData({
            customerId: account.customer_id,
            refreshToken,
            startDate: startDateStr,
            endDate: endDateStr,
            accountId: account.id,
            userId: userId,
            accountParentMccId: account.parent_mcc_id || undefined,
            credentials: userCredentials,
            authType: auth.authType,
            serviceAccountId: auth.serviceAccountId,
          })

          // 🔧 修复(2026-01-15): 从 Google Ads API 获取账户真实币种/时区并回写到google_ads_accounts
          // 避免账号初次创建时默认USD导致全站显示"$"
          const derivedCurrency = this.normalizeCurrency(performanceData[0]?.currency_code || account.currency)
          const derivedTimeZone = String(performanceData[0]?.time_zone || '').trim() || null

          try {
            const currentCurrency = this.normalizeCurrency(account.currency)
            const shouldUpdateCurrency = derivedCurrency && derivedCurrency !== currentCurrency
            const shouldUpdateTimezone = Boolean(derivedTimeZone)

            if (shouldUpdateCurrency || shouldUpdateTimezone) {
              await db.exec(
                `
                UPDATE google_ads_accounts
                SET currency = COALESCE(?, currency),
                    timezone = COALESCE(?, timezone),
                    updated_at = ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"}
                WHERE id = ?
              `,
                [shouldUpdateCurrency ? derivedCurrency : null, derivedTimeZone, account.id]
              )
            }
          } catch (e) {
            console.warn(`⚠️ 回写账号币种/时区失败（账号 ${account.customer_id}）:`, e)
          }

          // 4. 批量写入数据库（使用upsert处理重复）
          // Note: 使用事务确保数据一致性
          let accountRecordCount = 0
          await db.transaction(async () => {
            for (const record of performanceData) {
              // 查找本地campaign_id
              const campaign = campaignMap.get(record.campaign_id)
              if (!campaign) {
                console.warn(`未找到Campaign: ${record.campaign_id}，跳过`)
                continue
              }

              const cpa =
                record.conversions > 0 ? record.cost / record.conversions : 0

              // 🔧 修复(2025-12-30): 支持多货币账户
              // Google Ads API返回的cost_micros是账户货币的微单位，需要保存原始货币信息
              const accountCurrency = derivedCurrency

              await db.exec(
                `
                INSERT INTO campaign_performance (
                  user_id, campaign_id, date,
                  impressions, clicks, conversions, cost,
                  ctr, cpc, cpa, conversion_rate, currency
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(campaign_id, date) DO UPDATE SET
                  impressions = excluded.impressions,
                  clicks = excluded.clicks,
                  conversions = excluded.conversions,
                  cost = excluded.cost,
                  ctr = excluded.ctr,
                  cpc = excluded.cpc,
                  cpa = excluded.cpa,
                  conversion_rate = excluded.conversion_rate,
                  currency = excluded.currency
              `,
                [
                  userId,
                  campaign.id,
                  record.date,
                  record.impressions,
                  record.clicks,
                  record.conversions,
                  record.cost,
                  record.ctr,
                  record.cpc,
                  cpa,
                  record.conversion_rate,
                  accountCurrency,
                ]
              )
              accountRecordCount++
              recordCount++
            }
          })

          // 4. 同步搜索词/关键词表现并更新品牌全局核心关键词池
          try {
            await this.syncBrandCoreKeywordsForAccount({
              userId,
              customerId: account.customer_id,
              refreshToken,
              startDate: startDateStr,
              endDate: endDateStr,
              accountId: account.id,
              accountParentMccId: account.parent_mcc_id || undefined,
              credentials: userCredentials,
              authType: auth.authType,
              serviceAccountId: auth.serviceAccountId,
              campaigns,
              campaignMap,
            })
          } catch (error) {
            const quotaBackoffRemaining = this.markGoogleAdsQuotaBackoffIfNeeded(
              error,
              `brand-core-keywords:${account.customer_id}`
            )
            const errorMessage = this.buildSyncErrorMessage(error)
            if (quotaBackoffRemaining > 0) {
              console.warn(
                `⚠️ 品牌全局核心关键词同步命中配额冷却（剩余约 ${quotaBackoffRemaining}s，不影响主流程）: ${errorMessage}`
              )
            } else {
              console.warn(`⚠️ 品牌全局核心关键词同步失败（不影响主流程）: ${errorMessage}`)
            }
          }

          // 更新账户的last_sync_at
          await db.exec(
            `UPDATE google_ads_accounts SET last_sync_at = ? WHERE id = ?`,
            [new Date().toISOString(), account.id]
          )

          // 🔧 修复(2025-12-28): 更新该账户的sync_log为success
          await db.exec(
            `
            UPDATE sync_logs
            SET status = 'success', record_count = ?, duration_ms = ?, completed_at = ?
            WHERE id = ?
            `,
            [accountRecordCount, Date.now() - startTime, new Date().toISOString(), accountSyncLogId]
          )
        } catch (accountError) {
          // 🔧 修复(2025-12-28): 为该账户的sync_log记录错误
          const errorMessage = this.buildSyncErrorMessage(accountError)

          if (accountSyncLogId) {
            await db.exec(
              `
              UPDATE sync_logs
              SET status = 'failed', error_message = ?, duration_ms = ?, completed_at = ?
              WHERE id = ?
              `,
              [errorMessage, Date.now() - startTime, new Date().toISOString(), accountSyncLogId]
            )
          }

          console.error(`❌ 账户 ${account.customer_id} 同步失败: ${errorMessage}`)

          const quotaBackoffRemaining = this.markGoogleAdsQuotaBackoffIfNeeded(
            accountError,
            `performance:${account.customer_id}`
          )

          // 🆕 修复(2026-01-02): 检测OAuth token过期错误并创建风险警报
          const isTokenExpiredError =
            errorMessage.includes('invalid_grant') ||
            errorMessage.includes('Token has been expired') ||
            errorMessage.includes('Token has been revoked')

          if (isTokenExpiredError) {
            console.warn(`⚠️ 检测到OAuth token过期，创建风险警报...`)
            try {
              await createRiskAlert(
                userId,
                'oauth_token_expired',
                'critical',
                'Google Ads授权已过期',
                `您的Google Ads授权已过期或被撤销，无法同步账户数据。请前往设置页面重新授权以恢复数据同步。`,
                {
                  details: {
                    accountId: account.id,
                    customerId: account.customer_id,
                    accountName: account.account_name || `账户 ${account.customer_id}`,
                    errorType: 'invalid_grant',
                    errorMessage: errorMessage.substring(0, 200), // 截取前200字符
                    actionRequired: '重新授权Google Ads',
                    actionUrl: '/settings'
                  }
                }
              )
              console.log(`✅ 已创建OAuth token过期风险警报`)
            } catch (alertError) {
              console.error(`❌ 创建风险警报失败:`, alertError)
              // 不影响主流程
            }
          }

          if (quotaBackoffRemaining > 0) {
            console.warn(
              `[DataSync] Google Ads 配额冷却中，终止本轮剩余账户同步（剩余约 ${quotaBackoffRemaining}s）`
            )
            break
          }

          // 继续处理下一个账户，不中断整体同步流程
        }
      }

      // 5. 同步成功，更新日志
      const duration = Date.now() - startTime
      const completedAt = new Date().toISOString()

      await db.exec(
        `
        UPDATE sync_logs
        SET status = 'success', record_count = ?, duration_ms = ?, completed_at = ?
        WHERE id = ?
      `,
        [recordCount, duration, completedAt, syncLogId]
      )

      // 更新同步状态
      this.syncStatus.set(userId, {
        isRunning: false,
        lastSyncAt: completedAt,
        nextSyncAt: this.calculateNextSyncTime(),
        lastSyncDuration: duration,
        lastSyncRecordCount: recordCount,
        lastSyncError: null,
      })

      // 🔧 修复(2025-12-11): 返回 camelCase 字段名
      return {
        id: syncLogId!,
        userId: userId,
        googleAdsAccountId: accounts[0].id,
        syncType: syncType,
        status: 'success',
        recordCount: recordCount,
        durationMs: duration,
        errorMessage: null,
        startedAt: startedAt,
        completedAt: completedAt,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      const completedAt = new Date().toISOString()
      const errorMessage = this.buildSyncErrorMessage(error)

      // 更新日志为失败
      if (syncLogId) {
        await db.exec(
          `
          UPDATE sync_logs
          SET status = 'failed', error_message = ?, duration_ms = ?, completed_at = ?
          WHERE id = ?
        `,
          [errorMessage, duration, completedAt, syncLogId]
        )
      }

      // 更新同步状态
      this.syncStatus.set(userId, {
        isRunning: false,
        lastSyncAt: completedAt,
        nextSyncAt: null,
        lastSyncDuration: duration,
        lastSyncRecordCount: 0,
        lastSyncError: errorMessage,
      })

      throw error
    }
  }

  /**
   * 使用GAQL查询性能数据
   * 🔧 修复(2025-12-12): 独立账号模式 - 传递用户凭证
   * 🔧 修复(2025-12-24): 服务账号模式支持
   */
  private async queryPerformanceData(
    params: GAQLQueryParams
  ): Promise<CampaignPerformanceData[]> {
    const { customerId, refreshToken, startDate, endDate, accountId, userId, credentials, authType, serviceAccountId, accountParentMccId } = params

    try {
      const query = `
        SELECT
          customer.currency_code,
          customer.time_zone,
          campaign.id,
          campaign.name,
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.cost_micros
        FROM campaign
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
          AND campaign.status != 'REMOVED'
        ORDER BY segments.date DESC
      `

      const toPerformanceData = (results: any[]): CampaignPerformanceData[] =>
        results.map((row: any) => {
          const impressions = row.metrics?.impressions || 0
          const clicks = row.metrics?.clicks || 0
          const conversions = row.metrics?.conversions || 0
          const costMicros = row.metrics?.cost_micros || 0

          // 计算指标
          const cost = costMicros / 1_000_000 // 转换为标准货币单位
          const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
          const cpc = clicks > 0 ? cost / clicks : 0
          const conversion_rate =
            clicks > 0 ? (conversions / clicks) * 100 : 0

          return {
            campaign_id: row.campaign?.id?.toString() || '',
            campaign_name: row.campaign?.name || '',
            date: row.segments?.date || '',
            impressions,
            clicks,
            conversions,
            cost,
            ctr,
            cpc,
            conversion_rate,
            currency_code: row.customer?.currency_code || undefined,
            time_zone: row.customer?.time_zone || undefined,
          }
        })

      if (authType === 'service_account' && serviceAccountId) {
        // 服务账号模式
        const config = await getServiceAccountConfig(userId, serviceAccountId)
        if (!config) {
          throw new Error('未找到服务账号配置')
        }

        const results = (await executeGAQLQueryPython({ userId, serviceAccountId, customerId, query })).results || []
        return toPerformanceData(results)
      }

      // OAuth模式
      if (!refreshToken) {
        throw new Error('Google Ads账号缺少refresh token')
      }

      const loginCustomerIdCandidates = resolveLoginCustomerCandidates({
        authType: 'oauth',
        accountParentMccId,
        oauthLoginCustomerId: credentials?.login_customer_id,
        targetCustomerId: customerId,
      })

      let lastQueryError: unknown = null
      for (let i = 0; i < loginCustomerIdCandidates.length; i += 1) {
        const loginCustomerId = loginCustomerIdCandidates[i]
        try {
          const customer = await getCustomerWithCredentials({
            customerId,
            refreshToken,
            loginCustomerId: loginCustomerId ?? null,
            credentials: credentials ? {
              client_id: credentials.client_id,
              client_secret: credentials.client_secret,
              developer_token: credentials.developer_token,
            } : undefined,
            accountId,
            userId,
          })

          const results = await this.executeOAuthGaqlWithTracking<any[]>({
            userId,
            customerId,
            operationType: ApiOperationType.REPORT,
            endpoint: '/api/google-ads/query',
            fn: () => (customer as any).query(query),
          })
          if (i > 0) {
            console.log(`✅ 账号 ${customerId} 使用备用 login_customer_id=${this.describeLoginCustomerId(loginCustomerId)} 查询效果成功`)
          }
          return toPerformanceData(results)
        } catch (error) {
          lastQueryError = error
          const hasNextCandidate = i < loginCustomerIdCandidates.length - 1
          if (hasNextCandidate && isGoogleAdsAccountAccessError(error)) {
            const nextLoginCustomerId = loginCustomerIdCandidates[i + 1]
            console.warn(
              `⚠️ 账号 ${customerId} login_customer_id=${this.describeLoginCustomerId(loginCustomerId)} 查询失败，切换到 ${this.describeLoginCustomerId(nextLoginCustomerId)} 重试`
            )
            continue
          }
          throw error
        }
      }

      throw lastQueryError || new Error(`Google Ads账号 ${customerId} 查询失败`)
    } catch (error) {
      const quotaBackoffRemaining = this.markGoogleAdsQuotaBackoffIfNeeded(
        error,
        `gaql-performance:${customerId}`
      )
      const errorMessage = this.buildSyncErrorMessage(error)
      if (quotaBackoffRemaining > 0) {
        console.error(`GAQL查询失败(效果，配额冷却剩余约${quotaBackoffRemaining}s): ${errorMessage}`)
      } else {
        console.error(`GAQL查询失败(效果): ${errorMessage}`)
      }
      throw new Error(
        `Google Ads API查询失败: ${errorMessage}`
      )
    }
  }

  /**
   * 使用GAQL查询搜索词报告数据
   */
  private async querySearchTermData(
    params: GAQLQueryParams
  ): Promise<SearchTermPerformanceData[]> {
    const { customerId, refreshToken, startDate, endDate, accountId, userId, credentials, authType, serviceAccountId, accountParentMccId } = params

    try {
      const queryWithMatchType = `
        SELECT
          campaign.id,
          ad_group.id,
          segments.date,
          segments.search_term_match_type,
          search_term_view.search_term,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.cost_micros
        FROM search_term_view
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
          AND campaign.status != 'REMOVED'
          AND metrics.impressions > 0
        ORDER BY segments.date DESC
      `
      const queryFallback = `
        SELECT
          campaign.id,
          ad_group.id,
          segments.date,
          search_term_view.search_term,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.cost_micros
        FROM search_term_view
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
          AND campaign.status != 'REMOVED'
          AND metrics.impressions > 0
        ORDER BY segments.date DESC
      `

      const isServiceAccountMode = authType === 'service_account' && serviceAccountId
      const runQueryWithSchemaFallback = async (
        primaryQuery: () => Promise<any[]>,
        fallbackQuery: () => Promise<any[]>
      ): Promise<any[]> => {
        try {
          return await primaryQuery()
        } catch (error: any) {
          const message = String(error?.message || '')
          const canFallback = message.includes('search_term_match_type')
            || message.includes('Unrecognized field')
            || message.includes('Invalid field name')
          if (!canFallback) {
            throw error
          }
          console.warn('search_term_match_type字段不可用，降级为UNKNOWN继续同步')
          return await fallbackQuery()
        }
      }

      let results: any[] = []

      if (isServiceAccountMode) {
        const config = await getServiceAccountConfig(userId, serviceAccountId)
        if (!config) {
          throw new Error('未找到服务账号配置')
        }

        results = await runQueryWithSchemaFallback(
          async () => (
            (await executeGAQLQueryPython({
              userId,
              serviceAccountId,
              customerId,
              query: queryWithMatchType,
            })).results || []
          ),
          async () => (
            (await executeGAQLQueryPython({
              userId,
              serviceAccountId,
              customerId,
              query: queryFallback,
            })).results || []
          )
        )
      } else {
        if (!refreshToken) {
          throw new Error('Google Ads账号缺少refresh token')
        }

        const loginCustomerIdCandidates = resolveLoginCustomerCandidates({
          authType: 'oauth',
          accountParentMccId,
          oauthLoginCustomerId: credentials?.login_customer_id,
          targetCustomerId: customerId,
        })

        let lastQueryError: unknown = null
        let querySucceeded = false

        for (let i = 0; i < loginCustomerIdCandidates.length; i += 1) {
          const loginCustomerId = loginCustomerIdCandidates[i]

          try {
            const customer = await getCustomerWithCredentials({
              customerId,
              refreshToken,
              loginCustomerId: loginCustomerId ?? null,
              credentials: credentials ? {
                client_id: credentials.client_id,
                client_secret: credentials.client_secret,
                developer_token: credentials.developer_token,
              } : undefined,
              accountId,
              userId,
            })

            results = await runQueryWithSchemaFallback(
              async () => await this.executeOAuthGaqlWithTracking<any[]>({
                userId,
                customerId,
                operationType: ApiOperationType.REPORT,
                endpoint: '/api/google-ads/query',
                fn: () => (customer as any).query(queryWithMatchType),
              }),
              async () => await this.executeOAuthGaqlWithTracking<any[]>({
                userId,
                customerId,
                operationType: ApiOperationType.REPORT,
                endpoint: '/api/google-ads/query',
                fn: () => (customer as any).query(queryFallback),
              })
            )

            if (i > 0) {
              console.log(`✅ 账号 ${customerId} 使用备用 login_customer_id=${this.describeLoginCustomerId(loginCustomerId)} 查询搜索词成功`)
            }

            querySucceeded = true
            break
          } catch (error) {
            lastQueryError = error
            const hasNextCandidate = i < loginCustomerIdCandidates.length - 1
            if (hasNextCandidate && isGoogleAdsAccountAccessError(error)) {
              const nextLoginCustomerId = loginCustomerIdCandidates[i + 1]
              console.warn(
                `⚠️ 账号 ${customerId} login_customer_id=${this.describeLoginCustomerId(loginCustomerId)} 查询搜索词失败，切换到 ${this.describeLoginCustomerId(nextLoginCustomerId)} 重试`
              )
              continue
            }
            throw error
          }
        }

        if (!querySucceeded && lastQueryError) {
          throw lastQueryError
        }
      }

      return results.map((row: any) => {
        const impressions = row.metrics?.impressions || 0
        const clicks = row.metrics?.clicks || 0
        const conversions = row.metrics?.conversions || 0
        const costMicros = row.metrics?.cost_micros || 0
        return {
          campaign_id: row.campaign?.id?.toString() || '',
          ad_group_id: row.ad_group?.id?.toString() || '',
          search_term: row.search_term_view?.search_term || '',
          search_term_match_type: row.segments?.search_term_match_type || '',
          date: row.segments?.date || '',
          impressions,
          clicks,
          conversions,
          cost: costMicros / 1_000_000,
        }
      })
    } catch (error) {
      const quotaBackoffRemaining = this.markGoogleAdsQuotaBackoffIfNeeded(
        error,
        `gaql-search-term:${customerId}`
      )
      const errorMessage = this.buildSyncErrorMessage(error)
      if (quotaBackoffRemaining > 0) {
        console.error(`GAQL查询搜索词报告失败(配额冷却剩余约${quotaBackoffRemaining}s): ${errorMessage}`)
      } else {
        console.error(`GAQL查询搜索词报告失败: ${errorMessage}`)
      }
      throw new Error(
        `Google Ads API查询失败(搜索词报告): ${errorMessage}`
      )
    }
  }

  /**
   * 使用GAQL查询关键词表现数据
   */
  private async queryKeywordPerformanceData(
    params: GAQLQueryParams
  ): Promise<KeywordPerformanceData[]> {
    const { customerId, refreshToken, startDate, endDate, accountId, userId, credentials, authType, serviceAccountId, accountParentMccId } = params

    try {
      const query = `
        SELECT
          campaign.id,
          segments.date,
          ad_group_criterion.keyword.text,
          metrics.impressions,
          metrics.clicks
        FROM keyword_view
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
          AND campaign.status != 'REMOVED'
          AND ad_group_criterion.status != 'REMOVED'
          AND metrics.impressions > 0
          AND metrics.clicks > 0
        ORDER BY segments.date DESC
      `

      const isServiceAccountMode = authType === 'service_account' && serviceAccountId
      let results: any[] = []

      if (isServiceAccountMode) {
        const config = await getServiceAccountConfig(userId, serviceAccountId)
        if (!config) {
          throw new Error('未找到服务账号配置')
        }
        results = (await executeGAQLQueryPython({ userId, serviceAccountId, customerId, query })).results || []
      } else {
        if (!refreshToken) {
          throw new Error('Google Ads账号缺少refresh token')
        }

        const loginCustomerIdCandidates = resolveLoginCustomerCandidates({
          authType: 'oauth',
          accountParentMccId,
          oauthLoginCustomerId: credentials?.login_customer_id,
          targetCustomerId: customerId,
        })

        let lastQueryError: unknown = null
        let querySucceeded = false

        for (let i = 0; i < loginCustomerIdCandidates.length; i += 1) {
          const loginCustomerId = loginCustomerIdCandidates[i]

          try {
            const customer = await getCustomerWithCredentials({
              customerId,
              refreshToken,
              loginCustomerId: loginCustomerId ?? null,
              credentials: credentials ? {
                client_id: credentials.client_id,
                client_secret: credentials.client_secret,
                developer_token: credentials.developer_token,
              } : undefined,
              accountId,
              userId,
            })

            results = await this.executeOAuthGaqlWithTracking<any[]>({
              userId,
              customerId,
              operationType: ApiOperationType.REPORT,
              endpoint: '/api/google-ads/query',
              fn: () => (customer as any).query(query),
            })

            if (i > 0) {
              console.log(`✅ 账号 ${customerId} 使用备用 login_customer_id=${this.describeLoginCustomerId(loginCustomerId)} 查询关键词成功`)
            }

            querySucceeded = true
            break
          } catch (error) {
            lastQueryError = error
            const hasNextCandidate = i < loginCustomerIdCandidates.length - 1
            if (hasNextCandidate && isGoogleAdsAccountAccessError(error)) {
              const nextLoginCustomerId = loginCustomerIdCandidates[i + 1]
              console.warn(
                `⚠️ 账号 ${customerId} login_customer_id=${this.describeLoginCustomerId(loginCustomerId)} 查询关键词失败，切换到 ${this.describeLoginCustomerId(nextLoginCustomerId)} 重试`
              )
              continue
            }
            throw error
          }
        }

        if (!querySucceeded && lastQueryError) {
          throw lastQueryError
        }
      }

      return results.map((row: any) => {
        const impressions = row.metrics?.impressions || 0
        const clicks = row.metrics?.clicks || 0
        const keywordText =
          row.ad_group_criterion?.keyword?.text ||
          row.keyword_view?.keyword?.text ||
          ''

        return {
          campaign_id: row.campaign?.id?.toString() || '',
          keyword_text: keywordText,
          date: row.segments?.date || '',
          impressions,
          clicks,
        }
      })
    } catch (error) {
      const quotaBackoffRemaining = this.markGoogleAdsQuotaBackoffIfNeeded(
        error,
        `gaql-keyword:${customerId}`
      )
      const errorMessage = this.buildSyncErrorMessage(error)
      if (quotaBackoffRemaining > 0) {
        console.error(`GAQL查询关键词表现失败(配额冷却剩余约${quotaBackoffRemaining}s): ${errorMessage}`)
      } else {
        console.error(`GAQL查询关键词表现失败: ${errorMessage}`)
      }
      throw new Error(
        `Google Ads API查询失败(关键词表现): ${errorMessage}`
      )
    }
  }

  private describeLoginCustomerId(value: string | undefined): string {
    return value || 'null(omit)'
  }

  private async executeOAuthGaqlWithTracking<T>(params: {
    userId: number
    customerId: string
    operationType: ApiOperationType
    endpoint: string
    fn: () => Promise<T>
  }): Promise<T> {
    const startTime = Date.now()
    try {
      const result = await params.fn()
      await trackApiUsage({
        userId: params.userId,
        operationType: params.operationType,
        endpoint: params.endpoint,
        customerId: params.customerId,
        requestCount: 1,
        responseTimeMs: Date.now() - startTime,
        isSuccess: true,
      })
      return result
    } catch (error: any) {
      await trackApiUsage({
        userId: params.userId,
        operationType: params.operationType,
        endpoint: params.endpoint,
        customerId: params.customerId,
        requestCount: 1,
        responseTimeMs: Date.now() - startTime,
        isSuccess: false,
        errorMessage: this.buildSyncErrorMessage(error),
      }).catch(() => {})
      throw error
    }
  }

  private safeStringify(value: unknown): string | null {
    try {
      const seen = new WeakSet<object>()
      return JSON.stringify(value, (_, v) => {
        if (v && typeof v === 'object') {
          if (seen.has(v as object)) return '[Circular]'
          seen.add(v as object)
        }
        return v
      })
    } catch {
      return null
    }
  }

  private buildSyncErrorMessage(error: unknown): string {
    const err = error as any
    const detailPayload: Record<string, unknown> = {
      name: err?.name,
      message: err?.message,
      status: err?.status ?? err?.statusCode ?? err?.response?.status,
      code: err?.code ?? err?.response?.statusCode,
      details: err?.details,
      errors: Array.isArray(err?.errors) ? err.errors : undefined,
      statusDetails: Array.isArray(err?.statusDetails) ? err.statusDetails : undefined,
    }

    const detailJson = this.safeStringify(detailPayload)
    let text = detailJson && detailJson !== '{}' ? detailJson : ''

    if (!text || text === '{}' || text.includes('"message":"[object Object]"')) {
      const fullJson = this.safeStringify(error)
      if (fullJson && fullJson !== '{}') {
        text = fullJson
      }
    }

    if (!text) {
      text = String(error ?? 'Unknown error')
    }

    const normalized = String(text).trim() || 'Unknown error'
    return normalized.length > 2000 ? `${normalized.slice(0, 2000)}...` : normalized
  }

  /**
   * 同步搜索词/关键词表现并更新品牌全局核心关键词池
   */
  private async syncBrandCoreKeywordsForAccount(params: {
    userId: number
    customerId: string
    refreshToken?: string
    startDate: string
    endDate: string
    accountId: number
    accountParentMccId?: string
    credentials?: {
      client_id: string
      client_secret: string
      developer_token: string
      login_customer_id?: string
    }
    authType?: 'oauth' | 'service_account'
    serviceAccountId?: string
    campaigns: Array<{
      id: number
      google_campaign_id: string
      is_test_variant: boolean | number
      offer_id: number
      brand: string
      target_country: string
      target_language: string | null
    }>
    campaignMap: Map<string, {
      id: number
      google_campaign_id: string
      is_test_variant: boolean | number
      offer_id: number
      brand: string
      target_country: string
      target_language: string | null
    }>
  }): Promise<void> {
    const {
      userId,
      customerId,
      refreshToken,
      startDate,
      endDate,
      accountId,
      accountParentMccId,
      credentials,
      authType,
      serviceAccountId,
      campaigns,
      campaignMap,
    } = params

    const [searchTermData, keywordPerfData] = await Promise.all([
      this.querySearchTermData({
        customerId,
        refreshToken,
        startDate,
        endDate,
        accountId,
        userId,
        accountParentMccId,
        credentials,
        authType,
        serviceAccountId,
      }),
      this.queryKeywordPerformanceData({
        customerId,
        refreshToken,
        startDate,
        endDate,
        accountId,
        userId,
        accountParentMccId,
        credentials,
        authType,
        serviceAccountId,
      }),
    ])

    const db = await getDatabase()
    const nowSql = nowFunc(db.type)

    const campaignIds = campaigns.map(c => c.id)
    if (campaignIds.length > 0) {
      const placeholders = campaignIds.map(() => '?').join(',')
      await db.exec(
        `
        DELETE FROM search_term_reports
        WHERE campaign_id IN (${placeholders})
          AND date BETWEEN ? AND ?
      `,
        [...campaignIds, startDate, endDate]
      )
    }

    type DailyAggregate = {
      brandKey: string
      country: string
      language: string
      keywordNorm: string
      date: string
      searchTermImpressions: number
      searchTermClicks: number
      keywordPerfImpressions: number
      keywordPerfClicks: number
      hasSearchTerm: boolean
      hasKeywordPerf: boolean
    }

    const dailyMap = new Map<string, DailyAggregate>()
    const keywordDisplayMap = new Map<string, string>()
    const brandDisplayMap = new Map<string, string>()
    const affectedScopes = new Map<string, { brandKey: string; country: string; language: string }>()

    for (const campaign of campaigns) {
      const isTestVariant = campaign.is_test_variant === true || campaign.is_test_variant === 1
      if (isTestVariant) continue
      const brandKey = normalizeBrandKey(campaign.brand)
      if (!brandKey) continue
      const country = normalizeCountryCode(campaign.target_country || 'US')
      const language = normalizeLanguageCode(campaign.target_language || 'en')
      const scopeKey = `${brandKey}||${country}||${language}`
      if (!affectedScopes.has(scopeKey)) {
        affectedScopes.set(scopeKey, { brandKey, country, language })
      }
      if (!brandDisplayMap.has(scopeKey)) {
        brandDisplayMap.set(scopeKey, campaign.brand)
      }
    }

    const addToDaily = (
      source: 'search_term' | 'keyword_perf',
      campaign: {
        brand: string
        target_country: string
        target_language: string | null
      },
      keywordText: string,
      date: string,
      impressions: number,
      clicks: number
    ) => {
      if (impressions <= 0 || clicks <= 0) return
      const keywordNorm = normalizeGoogleAdsKeyword(keywordText)
      if (!keywordNorm || isInvalidKeyword(keywordNorm)) return

      const brandKey = normalizeBrandKey(campaign.brand)
      if (!brandKey) return

      const country = normalizeCountryCode(campaign.target_country || 'US')
      const language = normalizeLanguageCode(campaign.target_language || 'en')
      const scopeKey = `${brandKey}||${country}||${language}`
      const dailyKey = `${scopeKey}||${keywordNorm}||${date}`

      if (!brandDisplayMap.has(scopeKey)) {
        brandDisplayMap.set(scopeKey, campaign.brand)
      }

      const displayKey = `${scopeKey}||${keywordNorm}`
      if (!keywordDisplayMap.has(displayKey)) {
        const trimmed = keywordText?.trim()
        if (trimmed) keywordDisplayMap.set(displayKey, trimmed)
      }

      if (!affectedScopes.has(scopeKey)) {
        affectedScopes.set(scopeKey, { brandKey, country, language })
      }

      const existing = dailyMap.get(dailyKey)
      if (!existing) {
        dailyMap.set(dailyKey, {
          brandKey,
          country,
          language,
          keywordNorm,
          date,
          searchTermImpressions: source === 'search_term' ? impressions : 0,
          searchTermClicks: source === 'search_term' ? clicks : 0,
          keywordPerfImpressions: source === 'keyword_perf' ? impressions : 0,
          keywordPerfClicks: source === 'keyword_perf' ? clicks : 0,
          hasSearchTerm: source === 'search_term',
          hasKeywordPerf: source === 'keyword_perf',
        })
        return
      }

      if (source === 'search_term') {
        existing.searchTermImpressions += impressions
        existing.searchTermClicks += clicks
        existing.hasSearchTerm = true
      } else {
        existing.keywordPerfImpressions += impressions
        existing.keywordPerfClicks += clicks
        existing.hasKeywordPerf = true
      }
    }

    const searchTermRows: Array<{
      campaign_id: number
      ad_group_id: number | null
      google_ad_group_id: string | null
      search_term: string
      match_type: string
      raw_match_type: string | null
      impressions: number
      clicks: number
      conversions: number
      cost: number
      date: string
    }> = []

    const campaignIdsForAdGroups = campaigns
      .map((campaign) => campaign.id)
      .filter((id, index, arr) => id > 0 && arr.indexOf(id) === index)

    const adGroupByCampaignAndGoogleId = new Map<string, number>()
    if (campaignIdsForAdGroups.length > 0) {
      const placeholders = campaignIdsForAdGroups.map(() => '?').join(',')
      const adGroupRows = await db.query<{
        id: number
        campaign_id: number
        ad_group_id: string | null
      }>(
        `
        SELECT id, campaign_id, ad_group_id
        FROM ad_groups
        WHERE campaign_id IN (${placeholders})
          AND ad_group_id IS NOT NULL
      `,
        campaignIdsForAdGroups
      )

      for (const row of adGroupRows) {
        const googleAdGroupId = String(row.ad_group_id || '').trim()
        if (!googleAdGroupId) continue
        adGroupByCampaignAndGoogleId.set(`${row.campaign_id}:${googleAdGroupId}`, row.id)
      }
    }

    for (const row of searchTermData) {
      if (!row.search_term) continue
      const campaign = campaignMap.get(row.campaign_id)
      if (!campaign) continue
      const isTestVariant = campaign.is_test_variant === true || campaign.is_test_variant === 1
      if (isTestVariant) continue

      const keywordText = row.search_term.trim()
      if (!keywordText) continue

      addToDaily('search_term', campaign, keywordText, row.date, row.impressions, row.clicks)

      const keywordNorm = normalizeGoogleAdsKeyword(keywordText)
      if (!keywordNorm || isInvalidKeyword(keywordNorm)) continue

      const googleAdGroupId = String(row.ad_group_id || '').trim()
      const localAdGroupId = googleAdGroupId
        ? (adGroupByCampaignAndGoogleId.get(`${campaign.id}:${googleAdGroupId}`) ?? null)
        : null
      const normalizedMatchType = this.normalizeSearchTermMatchType(row.search_term_match_type)
      const rawMatchType = String(row.search_term_match_type || '').trim() || null

      searchTermRows.push({
        campaign_id: campaign.id,
        ad_group_id: localAdGroupId,
        google_ad_group_id: googleAdGroupId || null,
        search_term: keywordText,
        match_type: normalizedMatchType,
        raw_match_type: rawMatchType,
        impressions: row.impressions,
        clicks: row.clicks,
        conversions: row.conversions,
        cost: row.cost,
        date: row.date,
      })
    }

    for (const row of keywordPerfData) {
      if (!row.keyword_text) continue
      const campaign = campaignMap.get(row.campaign_id)
      if (!campaign) continue
      const isTestVariant = campaign.is_test_variant === true || campaign.is_test_variant === 1
      if (isTestVariant) continue

      const keywordText = row.keyword_text.trim()
      if (!keywordText) continue

      addToDaily('keyword_perf', campaign, keywordText, row.date, row.impressions, row.clicks)
    }

    if (searchTermRows.length > 0) {
      await db.transaction(async () => {
        for (const row of searchTermRows) {
          await db.exec(
            `
            INSERT INTO search_term_reports (
              user_id, campaign_id, ad_group_id, google_ad_group_id,
              search_term, match_type, raw_match_type,
              impressions, clicks, conversions, cost, date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              userId,
              row.campaign_id,
              row.ad_group_id,
              row.google_ad_group_id,
              row.search_term,
              row.match_type,
              row.raw_match_type,
              row.impressions,
              row.clicks,
              row.conversions,
              row.cost,
              row.date,
            ]
          )
        }
      })
    }

    if (dailyMap.size > 0) {
      const buildSourceMask = (hasSearchTerm: boolean, hasKeywordPerf: boolean): string => {
        if (hasSearchTerm && hasKeywordPerf) return 'search_term|keyword_perf'
        if (hasKeywordPerf) return 'keyword_perf'
        return 'search_term'
      }

      await db.transaction(async () => {
        for (const entry of dailyMap.values()) {
          const impressions = entry.hasKeywordPerf ? entry.keywordPerfImpressions : entry.searchTermImpressions
          const clicks = entry.hasKeywordPerf ? entry.keywordPerfClicks : entry.searchTermClicks
          const sourceMask = buildSourceMask(entry.hasSearchTerm, entry.hasKeywordPerf)

          await db.exec(
            `
            INSERT INTO brand_core_keyword_daily (
              brand_key, target_country, target_language,
              keyword_norm, date, impressions, clicks, source_mask
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(brand_key, target_country, target_language, keyword_norm, date)
            DO UPDATE SET
              impressions = excluded.impressions,
              clicks = excluded.clicks,
              source_mask = excluded.source_mask
          `,
            [
              entry.brandKey,
              entry.country,
              entry.language,
              entry.keywordNorm,
              entry.date,
              impressions,
              clicks,
              sourceMask,
            ]
          )
        }
      })
    }

    const cutoffDate = this.formatDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))

    for (const scope of affectedScopes.values()) {
      const aggregated = await db.query(
        `
        SELECT
          keyword_norm,
          SUM(impressions) AS impressions_total,
          SUM(clicks) AS clicks_total,
          MAX(date) AS last_seen_at,
          MAX(CASE WHEN source_mask LIKE '%search_term%' THEN 1 ELSE 0 END) AS has_search_term,
          MAX(CASE WHEN source_mask LIKE '%keyword_perf%' THEN 1 ELSE 0 END) AS has_keyword_perf
        FROM brand_core_keyword_daily
        WHERE brand_key = ? AND target_country = ? AND target_language = ? AND date >= ?
        GROUP BY keyword_norm
      `,
        [scope.brandKey, scope.country, scope.language, cutoffDate]
      ) as Array<{
        keyword_norm: string
        impressions_total: number
        clicks_total: number
        last_seen_at: string | null
        has_search_term: number
        has_keyword_perf: number
      }>

      await db.transaction(async () => {
        for (const row of aggregated) {
          const hasSearchTerm = Number(row.has_search_term || 0) > 0
          const hasKeywordPerf = Number(row.has_keyword_perf || 0) > 0
          const sourceMask = hasSearchTerm && hasKeywordPerf
            ? 'search_term|keyword_perf'
            : (hasKeywordPerf ? 'keyword_perf' : 'search_term')

          const scopeKey = `${scope.brandKey}||${scope.country}||${scope.language}`
          const displayKey = `${scopeKey}||${row.keyword_norm}`
          const brandDisplay = brandDisplayMap.get(scopeKey) || null
          const keywordDisplay = keywordDisplayMap.get(displayKey) || null

          await db.exec(
            `
            INSERT INTO brand_core_keywords (
              brand_key, brand_display, target_country, target_language,
              keyword_norm, keyword_display, source_mask,
              impressions_total, clicks_total, last_seen_at,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowSql}, ${nowSql})
            ON CONFLICT(brand_key, target_country, target_language, keyword_norm)
            DO UPDATE SET
              impressions_total = excluded.impressions_total,
              clicks_total = excluded.clicks_total,
              last_seen_at = excluded.last_seen_at,
              source_mask = excluded.source_mask,
              brand_display = COALESCE(brand_core_keywords.brand_display, excluded.brand_display),
              keyword_display = COALESCE(brand_core_keywords.keyword_display, excluded.keyword_display),
              updated_at = ${nowSql}
          `,
            [
              scope.brandKey,
              brandDisplay,
              scope.country,
              scope.language,
              row.keyword_norm,
              keywordDisplay,
              sourceMask,
              row.impressions_total || 0,
              row.clicks_total || 0,
              row.last_seen_at,
            ]
          )
        }
      })

      await db.exec(
        `
        DELETE FROM brand_core_keywords
        WHERE brand_key = ? AND target_country = ? AND target_language = ? AND last_seen_at < ?
      `,
        [scope.brandKey, scope.country, scope.language, cutoffDate]
      )

      await refreshBrandCoreKeywordCache(scope.brandKey, scope.country, scope.language)
    }
  }

  /**
   * 清理90天之前的数据
   */
  async cleanupOldData(): Promise<number> {
    const db = await getDatabase()

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - 90)

    const result = await db.exec(
      `
      DELETE FROM campaign_performance
      WHERE date < ?
    `,
      [this.formatDate(cutoffDate)]
    )

    return result.changes
  }

  /**
   * 获取同步日志
   * 🔧 修复(2025-12-11): 使用 AS 别名返回 camelCase 字段
   */
  async getSyncLogs(userId: number, limit: number = 20): Promise<SyncLog[]> {
    const db = await getDatabase()

    return await db.query(
      `
      SELECT
        id,
        user_id AS userId,
        google_ads_account_id AS googleAdsAccountId,
        sync_type AS syncType,
        status,
        record_count AS recordCount,
        duration_ms AS durationMs,
        error_message AS errorMessage,
        started_at AS startedAt,
        completed_at AS completedAt
      FROM sync_logs
      WHERE user_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `,
      [userId, limit]
    ) as SyncLog[]
  }

  /**
   * 格式化日期为 YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]
  }

  /**
   * 计算下次同步时间（4小时后）
   */
  private calculateNextSyncTime(): string {
    const nextSync = new Date()
    nextSync.setHours(nextSync.getHours() + 4)
    return nextSync.toISOString()
  }
}

/**
 * 导出单例实例
 */
export const dataSyncService = DataSyncService.getInstance()
