import type { NextRequest } from 'next/server'
import { parseTruthyFlag } from '../parse-truthy-flag'
import { getDatabase } from '../db'
import type { GoogleAdsCampaignRemoteActionSummary } from '@/lib/google-ads/campaign/remote-actions'

// --- from google-ads-account-delete-config.ts ---
function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

export interface GoogleAdsAccountDeleteRemoteConfig {
  maxCampaigns: number
  concurrency: number
  perCampaignTimeoutMs: number
  totalTimeoutMs: number
}

export function getGoogleAdsAccountDeleteRemoteConfig(): GoogleAdsAccountDeleteRemoteConfig {
  return {
    maxCampaigns: parseBoundedInt(process.env.GOOGLE_ADS_ACCOUNT_DELETE_MAX_CAMPAIGNS, 50, 1, 200),
    concurrency: parseBoundedInt(process.env.GOOGLE_ADS_ACCOUNT_DELETE_CONCURRENCY, 3, 1, 10),
    perCampaignTimeoutMs: parseBoundedInt(
      process.env.GOOGLE_ADS_ACCOUNT_DELETE_PER_CAMPAIGN_TIMEOUT_MS,
      45_000,
      5_000,
      120_000
    ),
    totalTimeoutMs: parseBoundedInt(
      process.env.GOOGLE_ADS_ACCOUNT_DELETE_TOTAL_TIMEOUT_MS,
      180_000,
      30_000,
      600_000
    ),
  }
}

// --- from google-ads-account-delete-campaigns.ts ---

export interface DeletableRemoteCampaignRow {
  google_campaign_id: string
}

/**
 * 删除账号前可同步到 Google Ads 远端的 Campaign（已同步、未移除、未软删）
 */
export async function listDeletableRemoteCampaignsForAccount(
  accountId: number,
  userId: number
): Promise<DeletableRemoteCampaignRow[]> {
  const db = await getDatabase()
  const isDeletedFalse = 'FALSE'

  return (await db.query(
    `
    SELECT google_campaign_id
    FROM campaigns
    WHERE google_ads_account_id = ?
      AND user_id = ?
      AND (is_deleted = ${isDeletedFalse} OR is_deleted IS NULL)
      AND status != 'REMOVED'
      AND google_campaign_id IS NOT NULL
      AND google_campaign_id != ''
  `,
    [accountId, userId]
  )) as DeletableRemoteCampaignRow[]
}

export async function countDeletableRemoteCampaignsForAccount(
  accountId: number,
  userId: number
): Promise<number> {
  const rows = await listDeletableRemoteCampaignsForAccount(accountId, userId)
  return rows.length
}

export function limitDeletableRemoteCampaigns<T extends DeletableRemoteCampaignRow>(
  campaigns: T[],
  maxCampaigns: number
): { selected: T[]; truncated: number; maxCampaigns: number } {
  const safeMax = Math.max(1, maxCampaigns)
  if (campaigns.length <= safeMax) {
    return { selected: campaigns, truncated: 0, maxCampaigns: safeMax }
  }
  return {
    selected: campaigns.slice(0, safeMax),
    truncated: campaigns.length - safeMax,
    maxCampaigns: safeMax,
  }
}

// --- from google-ads-account-delete-request.ts ---

export interface DeleteGoogleAdsAccountRequestOptions {
  removeGoogleAdsCampaigns: boolean
}

/**
 * 解析 DELETE 请求参数：优先 query，其次 JSON body（兼容无 Content-Type 的 body）
 */
export async function parseDeleteGoogleAdsAccountRequest(
  request: NextRequest
): Promise<DeleteGoogleAdsAccountRequestOptions> {
  if (parseTruthyFlag(request.nextUrl.searchParams.get('removeGoogleAdsCampaigns'))) {
    return { removeGoogleAdsCampaigns: true }
  }

  try {
    const rawBody = await request.text()
    if (!rawBody.trim()) {
      return { removeGoogleAdsCampaigns: false }
    }
    const body = JSON.parse(rawBody) as { removeGoogleAdsCampaigns?: unknown }
    return { removeGoogleAdsCampaigns: parseTruthyFlag(body?.removeGoogleAdsCampaigns) }
  } catch {
    return { removeGoogleAdsCampaigns: false }
  }
}

// --- from google-ads-account-delete-messages.ts ---

export function buildDeleteAccountRemoteMessage(
  removeRemote: boolean,
  googleAds?: GoogleAdsCampaignRemoteActionSummary
): { tone: 'success' | 'warning'; message: string } {
  if (!removeRemote) {
    return { tone: 'success', message: '仅删除本地记录，未操作 Google Ads 远端' }
  }

  if (!googleAds) {
    return { tone: 'success', message: '本地已删除' }
  }

  if (googleAds.skipReason === 'NO_CAMPAIGNS') {
    return { tone: 'success', message: '本地已删除；该账号下没有可同步的远端广告系列' }
  }

  if (googleAds.skipReason === 'ACCOUNT_INELIGIBLE') {
    return {
      tone: 'warning',
      message: '本地已删除；远端未执行（账号缺少 customer_id 或不可用）',
    }
  }

  if (googleAds.skipReason === 'CREDENTIALS_MISSING') {
    return {
      tone: 'warning',
      message: '本地已删除；远端未执行（缺少 Google Ads OAuth 凭证）',
    }
  }

  if (googleAds.truncated > 0) {
    const truncateNote = `受单次上限 ${googleAds.maxCampaigns} 限制，仅远端处理 ${googleAds.planned} 个（另有 ${googleAds.truncated} 个仅本地删除）`
    if (!googleAds.executed) {
      return { tone: 'warning', message: `本地已删除；${truncateNote}` }
    }
  }

  if (!googleAds.executed) {
    if (googleAds.failures.length > 0) {
      return {
        tone: 'warning',
        message: `本地已删除；远端未执行（${googleAds.failures[0]?.reason || '未知原因'}）`,
      }
    }
    return { tone: 'success', message: '本地已删除' }
  }

  const successCount = googleAds.removed + googleAds.pausedFallback
  const parts = [
    `远端处理 ${googleAds.attempted} 个：删除 ${googleAds.removed}，降级暂停 ${googleAds.pausedFallback}`,
  ]

  if (googleAds.failed > 0 || googleAds.failures.length > 0) {
    parts.push(`失败 ${googleAds.failed}`)
    const sample = googleAds.failures
      .slice(0, 3)
      .map((item) => `${item.campaignId}（${item.reason}）`)
      .join('；')
    if (sample) {
      parts.push(`示例：${sample}`)
    }
    if (googleAds.failures.length > 3) {
      parts.push(`另有 ${googleAds.failures.length - 3} 条失败未展示`)
    }
    return { tone: 'warning', message: parts.join('。') }
  }

  if (successCount === 0 && googleAds.planned > 0) {
    return { tone: 'warning', message: '本地已删除，但远端广告系列均未成功处理' }
  }

  return { tone: 'success', message: parts.join('。') }
}

// --- from google-ads-account-delete-warnings.ts ---

export function buildDeleteAccountApiWarnings(
  shouldRemoveRemote: boolean,
  googleAds: GoogleAdsCampaignRemoteActionSummary,
  options?: { localDeleted?: boolean }
): string[] | undefined {
  if (!shouldRemoveRemote) {
    return undefined
  }

  const localDeleted = options?.localDeleted !== false
  const localPrefix = localDeleted ? '本地账号已删除，但' : '本地账号删除失败；'

  const warnings: string[] = []

  if (!localDeleted) {
    warnings.push('本地账号删除失败；请检查远端操作结果与 failures 明细')
  }

  if (googleAds.skipReason === 'ACCOUNT_INELIGIBLE') {
    warnings.push(`${localPrefix}远端未执行（账号缺少 customer_id 或不可用）`)
  }

  if (googleAds.skipReason === 'CREDENTIALS_MISSING') {
    warnings.push(`${localPrefix}远端未执行（缺少 Google Ads 认证凭证）`)
  }

  if (googleAds.truncated > 0) {
    warnings.push(
      `共 ${googleAds.planned + googleAds.truncated} 个可删远端广告系列，受单次上限 ${googleAds.maxCampaigns} 限制，仅处理前 ${googleAds.planned} 个（其余仅本地删除）`
    )
  }

  if (googleAds.timedOut) {
    warnings.push('远端批处理触发整体超时，未完成的广告系列见 failures 明细')
  }

  const partialFailure =
    googleAds.executed &&
    googleAds.planned > 0 &&
    googleAds.removed + googleAds.pausedFallback < googleAds.planned &&
    (googleAds.failed > 0 || googleAds.failures.length > 0)

  if (partialFailure) {
    warnings.push('部分 Google Ads 远端广告系列删除失败，请查看 failures 明细')
  }

  const globalFailure =
    googleAds.executed &&
    googleAds.planned > 0 &&
    googleAds.removed + googleAds.pausedFallback === 0 &&
    googleAds.failures.length > 0

  if (globalFailure) {
    warnings.push('Google Ads 远端操作未成功，请查看 failures 明细')
  }

  return warnings.length > 0 ? warnings : undefined
}
