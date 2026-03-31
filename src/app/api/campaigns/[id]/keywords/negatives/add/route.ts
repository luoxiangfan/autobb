import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { boolCondition, boolParam, getInsertedId } from '@/lib/db-helpers'
import { createGoogleAdsKeywordsBatch } from '@/lib/google-ads-api'
import { getGoogleAdsCredentials, getUserAuthType } from '@/lib/google-ads-oauth'
import { patchCampaignConfigKeywords } from '@/lib/campaign-config-keywords'

type KeywordInput = string | {
  text?: string
  keyword?: string
  keywordText?: string
  matchType?: string
}

type AddNegativeKeywordsRequestBody = {
  keywords?: KeywordInput[]
}

type NormalizedNegativeKeyword = {
  text: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
}

type KeywordCreateFailure = {
  keywordText: string
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
  return 'EXACT'
}

function parseKeywords(inputs: KeywordInput[] | undefined): NormalizedNegativeKeyword[] {
  if (!Array.isArray(inputs)) return []

  const seen = new Set<string>()
  const normalized: NormalizedNegativeKeyword[] = []
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

async function createNegativeKeywords(params: {
  userId: number
  customerId: string
  refreshToken: string
  adGroupId: string
  keywords: NormalizedNegativeKeyword[]
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
            negativeKeywordMatchType: item.matchType,
            status: 'ENABLED',
            isNegative: true,
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
        message: error?.message || '否词创建失败',
      })
    }
  }

  return { created, duplicateKeywords, failures }
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

    const body = await request.json().catch(() => ({})) as AddNegativeKeywordsRequestBody
    const db = await getDatabase()
    const negativeCondition = boolCondition('k.is_negative', true, db.type)

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
      return NextResponse.json({ error: '该广告系列已下线/删除，无法新增否词' }, { status: 400 })
    }

    if (!campaign.google_ads_account_id || !campaign.customer_id) {
      return NextResponse.json({ error: '广告系列未绑定有效的Google Ads账号' }, { status: 400 })
    }

    const accountIsActive = campaign.account_is_active === true || campaign.account_is_active === 1
    const accountIsDeleted = campaign.account_is_deleted === true || campaign.account_is_deleted === 1
    if (!accountIsActive || accountIsDeleted) {
      return NextResponse.json({ error: '关联Ads账号不可用（可能已停用或解绑）' }, { status: 400 })
    }

    const syncCampaignConfigNegativeKeywords = async (negativeKeywords: string[]) => {
      if (!negativeKeywords.length) return
      const patch = patchCampaignConfigKeywords({
        campaignConfig: campaign.campaign_config,
        addNegativeKeywords: negativeKeywords,
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
    if (parsedKeywords.length === 0) {
      return NextResponse.json({ error: '请提供至少一个有效否词' }, { status: 400 })
    }

    const existingKeywordRows = await db.query<{ keyword_text: string; match_type: string | null }>(
      `
        SELECT k.keyword_text, k.match_type
        FROM keywords k
        INNER JOIN ad_groups ag ON ag.id = k.ad_group_id
        WHERE ag.campaign_id = ?
          AND ag.user_id = ?
          AND k.user_id = ?
          AND ${negativeCondition}
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
      await syncCampaignConfigNegativeKeywords(skippedExistingKeywordRows.map((item) => item.text))
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

    const createResult = await createNegativeKeywords({
      userId,
      customerId: String(campaign.customer_id),
      refreshToken,
      adGroupId: googleAdGroupId,
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
            ) VALUES (?, ?, ?, ?, ?, 'ENABLED', ?, ?, 'openclaw_strategy_negative', 'synced', NULL, ?, ?, ?)
          `,
          [
            userId,
            localAdGroupId,
            created.keywordId || null,
            created.keywordText,
            created.matchType,
            boolParam(true, db.type),
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
            message: error?.message || '否词入库失败',
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
      .map((item) => item.text)

    await syncCampaignConfigNegativeKeywords([
      ...insertedKeywords.map((item) => item.keywordText),
      ...skippedExistingKeywordRows.map((item) => item.text),
      ...duplicateKeywordRows,
    ])

    if (insertedKeywords.length === 0 && createResult.failures.length > 0) {
      return NextResponse.json(
        {
          error: '否词新增失败',
          duplicateKeywords,
          failures: createResult.failures,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      campaignId,
      adGroupId: localAdGroupId,
      googleAdGroupId,
      addedCount: insertedKeywords.length,
      addedKeywords: insertedKeywords,
      duplicateKeywords,
      failures: createResult.failures,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '新增否词失败' },
      { status: 500 }
    )
  }
}
