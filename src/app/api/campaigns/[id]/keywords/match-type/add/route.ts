import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { boolCondition, boolParam, getInsertedId } from '@/lib/db-helpers'
import { createGoogleAdsKeywordsBatch, updateGoogleAdsKeywordStatus } from '@/lib/google-ads-api'
import { getGoogleAdsCredentials, getUserAuthType } from '@/lib/google-ads-oauth'
import { patchCampaignConfigKeywords, type CampaignConfigKeyword } from '@/lib/campaign-config-keywords'

type KeywordInput = string | {
  text?: string
  keyword?: string
  keywordText?: string
  matchType?: string
}

type AddKeywordsRequestBody = {
  keywords?: KeywordInput[]
  status?: 'ENABLED' | 'PAUSED'
  oldKeywords?: KeywordInput[]
  replaceMode?: 'none' | 'pause_existing'
}

type NormalizedKeyword = {
  text: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
}

type NormalizedOldKeyword = {
  text: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
}

type KeywordCreateFailure = {
  keywordText: string
  message: string
}

type KeywordPauseFailure = {
  keywordText: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
  message: string
}

function normalizeKeywordText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeMatchType(value: unknown): 'BROAD' | 'PHRASE' | 'EXACT' {
  const raw = String(value || '').trim().toUpperCase()
  if (raw === 'BROAD' || raw === 'PHRASE' || raw === 'EXACT') {
    return raw
  }
  return 'PHRASE'
}

function parseKeywords(inputs: KeywordInput[] | undefined): NormalizedKeyword[] {
  if (!Array.isArray(inputs)) return []

  const seen = new Set<string>()
  const normalized: NormalizedKeyword[] = []
  for (const item of inputs) {
    const text = typeof item === 'string'
      ? normalizeKeywordText(item)
      : normalizeKeywordText(item?.text || item?.keyword || item?.keywordText)
    if (!text) continue
    if (text.length < 2 || text.length > 80) continue
    const matchType = normalizeMatchType(typeof item === 'string' ? undefined : item?.matchType)
    const key = `${text.toLowerCase()}|${matchType}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({
      text,
      matchType,
    })
  }
  return normalized
}

function parseOldKeywords(inputs: KeywordInput[] | undefined): NormalizedOldKeyword[] {
  if (!Array.isArray(inputs)) return []

  const seen = new Set<string>()
  const normalized: NormalizedOldKeyword[] = []
  for (const item of inputs) {
    const text = typeof item === 'string'
      ? normalizeKeywordText(item)
      : normalizeKeywordText(item?.text || item?.keyword || item?.keywordText)
    if (!text) continue
    if (text.length < 2 || text.length > 80) continue

    const rawMatchType = typeof item === 'string'
      ? undefined
      : (item as any)?.currentMatchType || item?.matchType
    const matchType = normalizeMatchType(rawMatchType)
    const key = `${text.toLowerCase()}|${matchType}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({
      text,
      matchType,
    })
  }
  return normalized
}

function normalizeReplaceMode(value: unknown): 'none' | 'pause_existing' {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'none' ? 'none' : 'pause_existing'
}

function isDuplicateKeywordError(error: any): boolean {
  const message = String(error?.message || error || '').toLowerCase()
  return message.includes('already exists')
    || message.includes('resource_already_exists')
    || message.includes('duplicate')
    || message.includes('重复')
}

async function ensurePrimaryAdGroup(params: {
  userId: number
  campaignId: number
  googleAdGroupId: string | null
  campaignName: string
}): Promise<{ localAdGroupId: number; googleAdGroupId: string }> {
  const db = await getDatabase()
  const primary = await db.queryOne<{ id: number; ad_group_id: string | null }>(
    `
      SELECT id, ad_group_id
      FROM ad_groups
      WHERE user_id = ?
        AND campaign_id = ?
      ORDER BY
        CASE WHEN ad_group_id IS NOT NULL AND ad_group_id != '' THEN 0 ELSE 1 END,
        created_at ASC
      LIMIT 1
    `,
    [params.userId, params.campaignId]
  )

  const existingGoogleAdGroupId = normalizeKeywordText(primary?.ad_group_id)
  if (primary?.id && existingGoogleAdGroupId) {
    return {
      localAdGroupId: Number(primary.id),
      googleAdGroupId: existingGoogleAdGroupId,
    }
  }

  const fallbackGoogleAdGroupId = normalizeKeywordText(params.googleAdGroupId)
  if (!fallbackGoogleAdGroupId) {
    throw new Error('未找到可用的广告组（缺少 google_ad_group_id）')
  }

  if (primary?.id) {
    await db.exec(
      `
        UPDATE ad_groups
        SET ad_group_id = ?,
            ad_group_name = COALESCE(NULLIF(ad_group_name, ''), ?),
            creation_status = 'synced',
            last_sync_at = ?,
            updated_at = ?
        WHERE id = ?
          AND user_id = ?
      `,
      [
        fallbackGoogleAdGroupId,
        `${params.campaignName || 'Campaign'} - Primary`,
        new Date().toISOString(),
        new Date().toISOString(),
        primary.id,
        params.userId,
      ]
    )
    return {
      localAdGroupId: Number(primary.id),
      googleAdGroupId: fallbackGoogleAdGroupId,
    }
  }

  const result = await db.exec(
    `
      INSERT INTO ad_groups (
        user_id,
        campaign_id,
        ad_group_id,
        ad_group_name,
        status,
        creation_status,
        creation_error,
        last_sync_at
      ) VALUES (?, ?, ?, ?, 'ENABLED', 'synced', NULL, ?)
    `,
    [
      params.userId,
      params.campaignId,
      fallbackGoogleAdGroupId,
      `${params.campaignName || 'Campaign'} - Primary`,
      new Date().toISOString(),
    ]
  )

  return {
    localAdGroupId: getInsertedId(result, db.type),
    googleAdGroupId: fallbackGoogleAdGroupId,
  }
}

async function createKeywordsByMatchType(params: {
  userId: number
  customerId: string
  refreshToken: string
  adGroupId: string
  status: 'ENABLED' | 'PAUSED'
  keywords: NormalizedKeyword[]
  accountId: number
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<{
  created: Array<{ keywordId: string; keywordText: string; matchType: 'BROAD' | 'PHRASE' | 'EXACT' }>
  duplicateKeywords: string[]
  failures: KeywordCreateFailure[]
}> {
  const created: Array<{ keywordId: string; keywordText: string; matchType: 'BROAD' | 'PHRASE' | 'EXACT' }> = []
  const duplicateKeywords: string[] = []
  const failures: KeywordCreateFailure[] = []

  for (const item of params.keywords) {
    try {
      const rows = await createGoogleAdsKeywordsBatch({
        customerId: params.customerId,
        refreshToken: params.refreshToken,
        adGroupId: params.adGroupId,
        keywords: [
          {
            keywordText: item.text,
            matchType: item.matchType,
            status: params.status,
            isNegative: false,
          },
        ],
        accountId: params.accountId,
        userId: params.userId,
        authType: params.authType,
        serviceAccountId: params.serviceAccountId,
      })

      const first = rows[0]
      created.push({
        keywordId: first?.keywordId || '',
        keywordText: first?.keywordText || item.text,
        matchType: item.matchType,
      })
    } catch (error: any) {
      if (isDuplicateKeywordError(error)) {
        duplicateKeywords.push(item.text)
        continue
      }
      failures.push({
        keywordText: item.text,
        message: error?.message || '关键词创建失败',
      })
    }
  }

  return { created, duplicateKeywords, failures }
}

async function pauseExistingKeywords(params: {
  db: Awaited<ReturnType<typeof getDatabase>>
  userId: number
  customerId: string
  refreshToken: string
  accountId: number
  campaignId: number
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string
  oldKeywords: NormalizedOldKeyword[]
}): Promise<{
  pausedCount: number
  pausedKeywords: Array<{ keywordText: string; matchType: 'BROAD' | 'PHRASE' | 'EXACT' }>
  failures: KeywordPauseFailure[]
}> {
  if (params.oldKeywords.length === 0) {
    return { pausedCount: 0, pausedKeywords: [], failures: [] }
  }

  const positiveCondition = boolCondition('k.is_negative', false, params.db.type)
  const keywordMatchConditions = params.oldKeywords
    .map(() => `(LOWER(TRIM(k.keyword_text)) = ? AND UPPER(COALESCE(k.match_type, 'PHRASE')) = ?)`)
    .join(' OR ')
  const queryParams: any[] = [params.campaignId, params.userId, params.userId]
  for (const item of params.oldKeywords) {
    queryParams.push(item.text.toLowerCase(), item.matchType)
  }

  const rows = await params.db.query<{
    keyword_local_id: number
    keyword_id: string | null
    keyword_text: string
    match_type: string | null
    status: string | null
    google_ad_group_id: string | null
  }>(
    `
      SELECT
        k.id AS keyword_local_id,
        k.keyword_id,
        k.keyword_text,
        k.match_type,
        k.status,
        ag.ad_group_id AS google_ad_group_id
      FROM keywords k
      INNER JOIN ad_groups ag ON ag.id = k.ad_group_id
      WHERE ag.campaign_id = ?
        AND ag.user_id = ?
        AND k.user_id = ?
        AND ${positiveCondition}
        AND (${keywordMatchConditions})
    `,
    queryParams
  )

  if ((rows || []).length === 0) {
    return { pausedCount: 0, pausedKeywords: [], failures: [] }
  }

  const now = new Date().toISOString()
  const pausedKeywords: Array<{ keywordText: string; matchType: 'BROAD' | 'PHRASE' | 'EXACT' }> = []
  const failures: KeywordPauseFailure[] = []

  for (const row of rows || []) {
    const keywordText = normalizeKeywordText(row.keyword_text)
    const matchType = normalizeMatchType(row.match_type)
    const localKeywordId = Number(row.keyword_local_id)
    const currentStatus = String(row.status || '').toUpperCase()
    if (currentStatus === 'PAUSED') {
      continue
    }

    try {
      const keywordId = normalizeKeywordText(row.keyword_id)
      const adGroupId = normalizeKeywordText(row.google_ad_group_id)
      if (params.authType === 'oauth' && keywordId && adGroupId) {
        await updateGoogleAdsKeywordStatus({
          customerId: params.customerId,
          refreshToken: params.refreshToken,
          adGroupId,
          keywordId,
          status: 'PAUSED',
          accountId: params.accountId,
          userId: params.userId,
          authType: params.authType,
          serviceAccountId: params.serviceAccountId,
        })
      }

      await params.db.exec(
        `
          UPDATE keywords
          SET status = 'PAUSED',
              creation_status = 'synced',
              creation_error = NULL,
              last_sync_at = ?,
              updated_at = ?
          WHERE id = ?
            AND user_id = ?
        `,
        [now, now, localKeywordId, params.userId]
      )

      pausedKeywords.push({
        keywordText,
        matchType,
      })
    } catch (error: any) {
      failures.push({
        keywordText,
        matchType,
        message: error?.message || '旧关键词暂停失败',
      })
    }
  }

  return {
    pausedCount: pausedKeywords.length,
    pausedKeywords,
    failures,
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const campaignId = Number(params.id)
    if (!Number.isFinite(campaignId)) {
      return NextResponse.json({ error: '无效的campaignId' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({})) as AddKeywordsRequestBody
    const db = await getDatabase()
    const positiveCondition = boolCondition('k.is_negative', false, db.type)

    const campaign = await db.queryOne<{
      id: number
      campaign_name: string
      status: string
      is_deleted: number | boolean
      google_ads_account_id: number | null
      google_ad_group_id: string | null
      campaign_config: unknown
      customer_id: string | null
      account_refresh_token: string | null
      account_is_active: number | boolean | null
      account_is_deleted: number | boolean | null
    }>(
      `
        SELECT
          c.id,
          c.campaign_name,
          c.status,
          c.is_deleted,
          c.google_ads_account_id,
          c.google_ad_group_id,
          c.campaign_config,
          gaa.customer_id,
          gaa.refresh_token AS account_refresh_token,
          gaa.is_active AS account_is_active,
          gaa.is_deleted AS account_is_deleted
        FROM campaigns c
        LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
        WHERE c.id = ?
          AND c.user_id = ?
        LIMIT 1
      `,
      [campaignId, userId]
    )

    if (!campaign) {
      return NextResponse.json({ error: '广告系列不存在或无权限访问' }, { status: 404 })
    }

    const isDeleted = campaign.is_deleted === true || campaign.is_deleted === 1
    if (isDeleted || String(campaign.status || '').toUpperCase() === 'REMOVED') {
      return NextResponse.json({ error: '该广告系列已下线/删除，无法新增关键词' }, { status: 400 })
    }

    if (!campaign.google_ads_account_id || !campaign.customer_id) {
      return NextResponse.json({ error: '广告系列未绑定有效的Google Ads账号' }, { status: 400 })
    }

    const accountIsActive = campaign.account_is_active === true || campaign.account_is_active === 1
    const accountIsDeleted = campaign.account_is_deleted === true || campaign.account_is_deleted === 1
    if (!accountIsActive || accountIsDeleted) {
      return NextResponse.json({ error: '关联Ads账号不可用（可能已停用或解绑）' }, { status: 400 })
    }

    const syncCampaignConfigKeywords = async (params: {
      addKeywords?: CampaignConfigKeyword[]
      removeKeywords?: CampaignConfigKeyword[]
    }) => {
      const addKeywords = params.addKeywords || []
      const removeKeywords = params.removeKeywords || []
      if (!addKeywords.length && !removeKeywords.length) return
      const patch = patchCampaignConfigKeywords({
        campaignConfig: campaign.campaign_config,
        addKeywords,
        removeKeywords,
      })
      if (!patch.changed) return
      const nowExpr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
      await db.exec(
        `
          UPDATE campaigns
          SET campaign_config = ?,
              updated_at = ${nowExpr}
          WHERE id = ?
            AND user_id = ?
        `,
        [patch.nextCampaignConfigJson, campaignId, userId]
      )
      campaign.campaign_config = patch.nextCampaignConfigJson
    }

    const parsedKeywords = parseKeywords(body.keywords)
    const replaceMode = normalizeReplaceMode(body.replaceMode)
    const parsedOldKeywords = parseOldKeywords(body.oldKeywords)
    if (parsedKeywords.length === 0) {
      return NextResponse.json({ error: '请提供至少一个有效关键词' }, { status: 400 })
    }

    const existingKeywordRows = await db.query<{ keyword_text: string; match_type: string | null }>(
      `
        SELECT k.keyword_text, k.match_type
        FROM keywords k
        INNER JOIN ad_groups ag ON ag.id = k.ad_group_id
        WHERE ag.campaign_id = ?
          AND ag.user_id = ?
          AND k.user_id = ?
          AND ${positiveCondition}
      `,
      [campaignId, userId, userId]
    )

    const existingKeywordSet = new Set(
      (existingKeywordRows || [])
        .map((row) => `${normalizeKeywordText(row.keyword_text).toLowerCase()}|${normalizeMatchType(row.match_type)}`)
        .filter(Boolean)
    )

    const toCreate = parsedKeywords.filter((item) => !existingKeywordSet.has(`${item.text.toLowerCase()}|${item.matchType}`))
    const skippedExistingKeywordRows = parsedKeywords
      .filter((item) => existingKeywordSet.has(`${item.text.toLowerCase()}|${item.matchType}`))
    const skippedExistingKeywords = skippedExistingKeywordRows.map((item) => item.text)

    if (toCreate.length === 0) {
      await syncCampaignConfigKeywords({
        addKeywords: skippedExistingKeywordRows.map((item) => ({ text: item.text, matchType: item.matchType })),
      })
      return NextResponse.json({
        success: true,
        addedCount: 0,
        skippedExistingKeywords,
        duplicateKeywords: [],
        failures: [],
      })
    }

    const { localAdGroupId, googleAdGroupId } = await ensurePrimaryAdGroup({
      userId,
      campaignId,
      googleAdGroupId: campaign.google_ad_group_id,
      campaignName: campaign.campaign_name,
    })

    const auth = await getUserAuthType(userId)
    let refreshToken = ''
    if (auth.authType === 'oauth') {
      const oauthCredentials = await getGoogleAdsCredentials(userId)
      refreshToken = oauthCredentials?.refresh_token || campaign.account_refresh_token || ''
      if (!refreshToken) {
        return NextResponse.json(
          { error: 'Google Ads OAuth 授权已过期，请重新连接账号' },
          { status: 400 }
        )
      }
    }

    const status = body.status === 'PAUSED' ? 'PAUSED' : 'ENABLED'
    const createResult = await createKeywordsByMatchType({
      userId,
      customerId: String(campaign.customer_id),
      refreshToken,
      adGroupId: googleAdGroupId,
      status,
      keywords: toCreate,
      accountId: Number(campaign.google_ads_account_id),
      authType: auth.authType,
      serviceAccountId: auth.serviceAccountId,
    })

    const now = new Date().toISOString()
    const insertedKeywords: Array<{ keywordId: string; keywordText: string; matchType: 'BROAD' | 'PHRASE' | 'EXACT' }> = []
    for (const created of createResult.created) {
      try {
        await db.exec(
          `
            INSERT INTO keywords (
              user_id,
              ad_group_id,
              keyword_id,
              keyword_text,
              match_type,
              status,
              is_negative,
              ai_generated,
              generation_source,
              creation_status,
              creation_error,
              last_sync_at,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'openclaw_strategy_match_type', 'synced', NULL, ?, ?, ?)
          `,
          [
            userId,
            localAdGroupId,
            created.keywordId || null,
            created.keywordText,
            created.matchType,
            status,
            boolParam(false, db.type),
            boolParam(false, db.type),
            now,
            now,
            now,
          ]
        )
        insertedKeywords.push(created)
      } catch (error: any) {
        if (!isDuplicateKeywordError(error)) {
          createResult.failures.push({
            keywordText: created.keywordText,
            message: error?.message || '关键词入库失败',
          })
        }
      }
    }

    const duplicateKeywords = Array.from(
      new Set([...createResult.duplicateKeywords, ...skippedExistingKeywords])
    )
    const duplicateKeywordSet = new Set(createResult.duplicateKeywords.map((item) => item.toLowerCase()))
    const duplicateKeywordRows = toCreate
      .filter((item) => duplicateKeywordSet.has(item.text.toLowerCase()))
      .map((item) => ({ text: item.text, matchType: item.matchType }))

    const pauseResult = replaceMode === 'pause_existing'
      ? await pauseExistingKeywords({
        db,
        userId,
        customerId: String(campaign.customer_id),
        refreshToken,
        accountId: Number(campaign.google_ads_account_id),
        campaignId,
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId,
        oldKeywords: parsedOldKeywords,
      })
      : { pausedCount: 0, pausedKeywords: [], failures: [] as KeywordPauseFailure[] }

    if (insertedKeywords.length === 0 && createResult.failures.length > 0) {
      return NextResponse.json(
        {
          error: '关键词新增失败',
          duplicateKeywords,
          failures: [...createResult.failures, ...pauseResult.failures],
        },
        { status: 500 }
      )
    }

    await syncCampaignConfigKeywords({
      addKeywords: [
        ...insertedKeywords.map((item) => ({ text: item.keywordText, matchType: item.matchType })),
        ...skippedExistingKeywordRows.map((item) => ({ text: item.text, matchType: item.matchType })),
        ...duplicateKeywordRows,
      ],
      removeKeywords: pauseResult.pausedKeywords.map((item) => ({
        text: item.keywordText,
        matchType: item.matchType,
      })),
    })

    return NextResponse.json({
      success: true,
      campaignId,
      adGroupId: localAdGroupId,
      googleAdGroupId,
      addedCount: insertedKeywords.length,
      addedKeywords: insertedKeywords,
      duplicateKeywords,
      replaceMode,
      requestedPauseOldCount: parsedOldKeywords.length,
      pausedOldCount: pauseResult.pausedCount,
      pausedOldKeywords: pauseResult.pausedKeywords,
      failures: [...createResult.failures, ...pauseResult.failures],
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '新增关键词失败' },
      { status: 500 }
    )
  }
}
