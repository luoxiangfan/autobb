import type { NextRequest } from 'next/server'
import { parseTruthyFlag } from '../parse-truthy-flag'
import { getDatabase } from '../db'

export { buildDeleteAccountRemoteMessage } from './account-delete-messages'
export { buildDeleteAccountApiWarnings } from './account-delete-warnings'

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
