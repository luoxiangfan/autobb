import { logger } from '@/lib/common/server'
import crypto from 'crypto'
import { getDatabase } from '../db'
import { applyCampaignTransition } from './campaign-state-machine'
import {
  computeCampaignConfigHash,
  computeContentHash,
  type CampaignConfigData,
  type CreativeContentData,
} from '../launch-score/server'

export type ResumablePublishCampaignRow = {
  id: number
  campaign_name: string
  creation_status: string
  status: string
  google_campaign_id: string | null
  campaign_id: string | null
  google_ad_group_id: string | null
  google_ad_id: string | null
  campaign_config: string | null
  google_ads_account_id: number | null
  ad_creative_id: number | null
  budget_amount: number | null
  budget_type: string | null
  max_cpc: number | null
}

export type PublishResumePlan = {
  resumeMode: boolean
  /* * 本地无 google_campaign_id 时，按 campaign_name 在 Google Ads 侧查找已创建资源 */
  discoverRemoteByName: boolean
  googleCampaignId: string | null
  googleAdGroupId: string | null
  googleAdId: string | null
  campaignSettingsChanged: boolean
  adGroupSettingsChanged: boolean
  keywordsChanged: boolean
  rsaChanged: boolean
  extensionsChanged: boolean
}

const DEFAULT_RESUME_FAILED_LOOKBACK_DAYS = 14

function getResumableFailedLookbackIso(days: number = DEFAULT_RESUME_FAILED_LOOKBACK_DAYS): string {
  const safeDays =
    Number.isFinite(days) && days > 0 ? Math.floor(days) : DEFAULT_RESUME_FAILED_LOOKBACK_DAYS
  return new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString()
}

type ParsedCampaignConfig = Record<string, unknown>

function parseCampaignConfig(raw: unknown): ParsedCampaignConfig {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as ParsedCampaignConfig
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as ParsedCampaignConfig
      }
    } catch {
      return {}
    }
  }
  return {}
}

function normalizeGoogleResourceId(
  googleCampaignId: string | null | undefined,
  campaignId: string | null | undefined
): string | null {
  const fromGoogle = String(googleCampaignId || '').trim()
  if (fromGoogle) return fromGoogle
  const fromCampaign = String(campaignId || '').trim()
  return fromCampaign || null
}

function normalizeKeywordList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    const text =
      typeof item === 'string'
        ? item
        : String(
            (item as { text?: string; keyword?: string })?.text ||
              (item as { keyword?: string })?.keyword ||
              ''
          )
    const normalized = text.trim().replace(/\s+/g, ' ')
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result.sort((a, b) => a.localeCompare(b))
}

function normalizeTextAssets(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}

function hashValue(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').substring(0, 16)
}

function buildCampaignSettingsFingerprint(config: ParsedCampaignConfig): string {
  const payload: CampaignConfigData = {
    targetCountry: String(config.targetCountry || config.target_country || 'US'),
    targetLanguage: String(config.targetLanguage || config.target_language || 'en'),
    dailyBudget: Number(config.budgetAmount ?? config.budget_amount ?? 0),
    maxCpc: Number(config.maxCpcBid ?? config.max_cpc_bid ?? config.maxCpc ?? 0),
  }
  return computeCampaignConfigHash(payload)
}

function buildAdGroupFingerprint(config: ParsedCampaignConfig): string {
  return hashValue({
    adGroupName: String(config.adGroupName || config.ad_group_name || '').trim(),
    maxCpcBid: Number(config.maxCpcBid ?? config.max_cpc_bid ?? 0),
  })
}

function buildKeywordsFingerprint(config: ParsedCampaignConfig): string {
  return hashValue({
    keywords: normalizeKeywordList(config.keywords),
    negativeKeywords: normalizeKeywordList(config.negativeKeywords || config.negative_keywords),
    negativeKeywordMatchType:
      config.negativeKeywordMatchType || config.negative_keywords_match_type || null,
  })
}

function buildRsaFingerprint(
  config: ParsedCampaignConfig,
  creative?: {
    headlines?: string[]
    descriptions?: string[]
    finalUrl?: string
    finalUrlSuffix?: string
    path1?: string
    path2?: string
  }
): string {
  const headlines = normalizeTextAssets(creative?.headlines ?? config.headlines)
  const descriptions = normalizeTextAssets(creative?.descriptions ?? config.descriptions)
  const payload: CreativeContentData = {
    headlines: headlines.length > 0 ? headlines : [''],
    descriptions: descriptions.length > 0 ? descriptions : [''],
    keywords: normalizeKeywordList(config.keywords),
    negativeKeywords: normalizeKeywordList(config.negativeKeywords || config.negative_keywords),
    finalUrl: String(
      creative?.finalUrl ||
        config.finalUrl ||
        (Array.isArray(config.finalUrls) ? config.finalUrls[0] : '') ||
        ''
    )
      .toLowerCase()
      .trim(),
  }
  const base = computeContentHash(payload)
  return hashValue({
    base,
    finalUrlSuffix: String(creative?.finalUrlSuffix || config.finalUrlSuffix || '').trim(),
    path1: String(creative?.path1 || config.path1 || '').trim(),
    path2: String(creative?.path2 || config.path2 || '').trim(),
  })
}

function buildExtensionsFingerprint(
  config: ParsedCampaignConfig,
  creative?: {
    callouts?: string[]
    sitelinks?: unknown[]
  }
): string {
  return hashValue({
    callouts: normalizeTextAssets(creative?.callouts ?? config.callouts),
    sitelinks: Array.isArray(creative?.sitelinks ?? config.sitelinks)
      ? (creative?.sitelinks ?? config.sitelinks)
      : [],
  })
}

/**
 * 查找可续发的 Campaign
 * 优先 pending（非超时）
 * 其次近期 publish_failed（含 google_campaign_id 为空、仅本地失败记录的情况）
 */
export async function findResumablePublishCampaignForOffer(
  offerId: number,
  userId: number
): Promise<ResumablePublishCampaignRow | null> {
  const db = await getDatabase()

  const { getStaleUpdatedAtThresholdIso } = await import('./campaign-offer-constraint')
  const staleThresholdIso = getStaleUpdatedAtThresholdIso()
  const stalePendingExclude = staleThresholdIso
    ? `AND NOT (creation_status = 'pending' AND updated_at < '${staleThresholdIso.replace(/'/g, "''")}')`
    : ''

  const failedLookbackIso = getResumableFailedLookbackIso()
  const escapedFailedLookback = failedLookbackIso.replace(/'/g, "''")

  const row = (await db.queryOne(
    `
      SELECT
        id,
        campaign_name,
        creation_status,
        status,
        google_campaign_id,
        campaign_id,
        google_ad_group_id,
        google_ad_id,
        campaign_config,
        google_ads_account_id,
        ad_creative_id,
        budget_amount,
        budget_type,
        max_cpc
      FROM campaigns
      WHERE offer_id = ?
        AND user_id = ?
        AND (
          (
            creation_status = 'pending'
            AND is_deleted = false
            AND UPPER(COALESCE(status, '')) != 'REMOVED'
            ${stalePendingExclude}
          )
          OR (
            creation_status = 'failed'
            AND COALESCE(removed_reason, '') = 'publish_failed'
            AND updated_at >= '${escapedFailedLookback}'
          )
        )
      ORDER BY
        CASE creation_status WHEN 'pending' THEN 0 ELSE 1 END,
        updated_at DESC,
        id DESC
      LIMIT 1
    `,
    [offerId, userId]
  )) as ResumablePublishCampaignRow | undefined

  return row ?? null
}

export function buildPublishResumePlan(params: {
  stored: ResumablePublishCampaignRow | null
  nextCampaignConfig: Record<string, unknown>
  nextCreative: {
    headlines: string[]
    descriptions: string[]
    finalUrl: string
    finalUrlSuffix?: string
    path1?: string
    path2?: string
    callouts?: string[]
    sitelinks?: unknown[]
  }
  /* * 复用本地失败/未完成记录续发（即使 google_campaign_id 为空） */
  enableLocalResume?: boolean
}): PublishResumePlan {
  const googleCampaignId = params.stored
    ? normalizeGoogleResourceId(params.stored.google_campaign_id, params.stored.campaign_id)
    : null
  const googleAdGroupId = String(params.stored?.google_ad_group_id || '').trim() || null
  const googleAdId = String(params.stored?.google_ad_id || '').trim() || null
  const storedConfig = parseCampaignConfig(params.stored?.campaign_config)
  const hasStoredRemoteCampaign = Boolean(googleCampaignId)
  const shouldResumeLocally = Boolean(params.stored && params.enableLocalResume)

  if (!shouldResumeLocally) {
    return {
      resumeMode: false,
      discoverRemoteByName: false,
      googleCampaignId,
      googleAdGroupId,
      googleAdId,
      campaignSettingsChanged: true,
      adGroupSettingsChanged: true,
      keywordsChanged: true,
      rsaChanged: true,
      extensionsChanged: true,
    }
  }

  const campaignSettingsChanged =
    buildCampaignSettingsFingerprint(storedConfig) !==
    buildCampaignSettingsFingerprint(params.nextCampaignConfig)
  const adGroupSettingsChanged =
    buildAdGroupFingerprint(storedConfig) !== buildAdGroupFingerprint(params.nextCampaignConfig)
  const keywordsChanged =
    buildKeywordsFingerprint(storedConfig) !== buildKeywordsFingerprint(params.nextCampaignConfig)
  const rsaChanged =
    buildRsaFingerprint(storedConfig) !==
    buildRsaFingerprint(params.nextCampaignConfig, params.nextCreative)
  const extensionsChanged =
    buildExtensionsFingerprint(storedConfig) !==
    buildExtensionsFingerprint(params.nextCampaignConfig, params.nextCreative)

  return {
    resumeMode: true,
    discoverRemoteByName: !hasStoredRemoteCampaign,
    googleCampaignId,
    googleAdGroupId,
    googleAdId,
    campaignSettingsChanged,
    adGroupSettingsChanged,
    keywordsChanged,
    rsaChanged,
    extensionsChanged,
  }
}

export function collectCampaignNameCandidates(
  ...names: Array<string | null | undefined>
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of names) {
    const name = String(raw || '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(name)
  }
  return result
}

function normalizeGoogleAdsId(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

/**
 * 发布过程中一旦获得远端 ID 立即写库（仅更新 pending 记录，避免覆盖已 synced 数据）。
 */
export async function persistPublishGoogleAdsIds(params: {
  userId: number
  campaignId: number
  googleCampaignId?: string | null
  googleAdGroupId?: string | null
  googleAdId?: string | null
}): Promise<boolean> {
  const googleCampaignId = normalizeGoogleAdsId(params.googleCampaignId)
  const googleAdGroupId = normalizeGoogleAdsId(params.googleAdGroupId)
  const googleAdId = normalizeGoogleAdsId(params.googleAdId)

  if (!googleCampaignId && !googleAdGroupId && !googleAdId) {
    return false
  }

  const db = await getDatabase()
  const assignments: string[] = []
  const values: Array<string | number> = []

  if (googleCampaignId) {
    assignments.push('campaign_id = ?', 'google_campaign_id = ?')
    values.push(googleCampaignId, googleCampaignId)
  }
  if (googleAdGroupId) {
    assignments.push('google_ad_group_id = ?')
    values.push(googleAdGroupId)
  }
  if (googleAdId) {
    assignments.push('google_ad_id = ?')
    values.push(googleAdId)
  }

  assignments.push(`updated_at = NOW()`)

  const result = await db.exec(
    `
      UPDATE campaigns
      SET ${assignments.join(', ')}
      WHERE id = ?
        AND user_id = ?
        AND creation_status = 'pending'
    `,
    [...values, params.campaignId, params.userId]
  )

  const updated = (result.changes || 0) > 0
  if (updated) {
    const parts = [
      googleCampaignId ? `campaign=${googleCampaignId}` : null,
      googleAdGroupId ? `adGroup=${googleAdGroupId}` : null,
      googleAdId ? `ad=${googleAdId}` : null,
    ].filter(Boolean)
    logger.debug(
      `[CampaignPublish] 💾 已即时回写远端 ID（local=${params.campaignId}）: ${parts.join(', ')}`
    )
  }

  return updated
}

export async function reactivateCampaignForPublishResume(params: {
  campaignId: number
  offerId: number
  userId: number
  googleAdsAccountId: number
  adCreativeId: number
  campaignName: string
  campaignConfig: Record<string, unknown>
  budgetAmount: number
  budgetType: string
  maxCpc: number | null
}): Promise<void> {
  const db = await getDatabase()
  await applyCampaignTransition({
    userId: params.userId,
    campaignId: params.campaignId,
    action: 'PUBLISH_QUEUED',
  })

  await db.exec(
    `
      UPDATE campaigns
      SET
        is_deleted = false,
        deleted_at = NULL,
        offer_id = ?,
        google_ads_account_id = ?,
        ad_creative_id = ?,
        campaign_name = ?,
        campaign_config = ?,
        budget_amount = ?,
        budget_type = ?,
        max_cpc = ?,
        creation_error = NULL,
        removed_reason = NULL,
        updated_at = NOW()
      WHERE id = ?
        AND user_id = ?
    `,
    [
      params.offerId,
      params.googleAdsAccountId,
      params.adCreativeId,
      params.campaignName,
      JSON.stringify(params.campaignConfig),
      params.budgetAmount,
      params.budgetType,
      params.maxCpc,
      params.campaignId,
      params.userId,
    ]
  )
}
