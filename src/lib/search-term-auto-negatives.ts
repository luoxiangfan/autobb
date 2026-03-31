import { getDatabase } from '@/lib/db'
import { boolCondition, boolParam } from '@/lib/db-helpers'
import { createGoogleAdsKeywordsBatch } from '@/lib/google-ads-api'
import { getGoogleAdsCredentials, getUserAuthType } from '@/lib/google-ads-oauth'
import { classifyKeywordIntent, recommendMatchTypeForKeyword } from '@/lib/keyword-intent'
import { KEYWORD_POLICY } from '@/lib/keyword-policy'

export interface SearchTermAutoNegativeOptions {
  userId?: number
  offerId?: number
  dryRun?: boolean
  lookbackDays?: number
  minClicks?: number
  minCost?: number
  maxPerAdGroup?: number
  maxPerUser?: number
}

export interface SearchTermAutoNegativeResult {
  dryRun: boolean
  lookbackDays: number
  scannedRows: number
  selected: number
  applied: number
  skippedExisting: number
  skippedDuplicateRemote: number
  failed: number
  users: Array<{
    userId: number
    selected: number
    applied: number
    failed: number
  }>
}

export interface SearchTermAutoPositiveOptions {
  userId?: number
  offerId?: number
  dryRun?: boolean
  lookbackDays?: number
  minClicks?: number
  minConversions?: number
  maxPerAdGroup?: number
  maxPerUser?: number
}

export interface SearchTermAutoPositiveResult {
  dryRun: boolean
  lookbackDays: number
  scannedRows: number
  selected: number
  applied: number
  skippedExisting: number
  skippedDuplicateRemote: number
  skippedLowIntent: number
  failed: number
  users: Array<{
    userId: number
    selected: number
    applied: number
    failed: number
  }>
}

interface SearchTermAggregateRow {
  user_id: number
  campaign_id: number
  ad_group_id: number | null
  google_ad_group_id: string | null
  search_term: string
  impressions: number | string
  clicks: number | string
  conversions: number | string
  cost: number | string
  google_ads_account_id: number
  customer_id: string
  refresh_token: string | null
  target_language: string | null
  brand: string | null
}

interface SearchTermAutoNegativeAction {
  userId: number
  adGroupId: number
  googleAdGroupId: string
  campaignId: number
  searchTerm: string
  clicks: number
  cost: number
  googleAdsAccountId: number
  customerId: string
  refreshToken: string
}

interface SearchTermAutoPositiveAction {
  userId: number
  adGroupId: number
  googleAdGroupId: string
  campaignId: number
  searchTerm: string
  clicks: number
  conversions: number
  cost: number
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
  googleAdsAccountId: number
  customerId: string
  refreshToken: string
}

const NEGATIVE_DEFAULTS = { ...KEYWORD_POLICY.autoActions.negative }
const POSITIVE_DEFAULTS = { ...KEYWORD_POLICY.autoActions.positive }

const AUTO_NEGATIVE_SOURCE = 'auto-search-term-hard-negative'
const AUTO_POSITIVE_SOURCE = 'auto-search-term-positive-promote'

function toNumber(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return parsed
}

function normalizeSearchTerm(input: string): string {
  return String(input ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeTermKey(input: string): string {
  return normalizeSearchTerm(input).toLowerCase()
}

function parseAggregateSearchTermRow(row: SearchTermAggregateRow): {
  adGroupId: number
  googleAdGroupId: string
  searchTerm: string
} | null {
  const adGroupId = Number(row.ad_group_id || 0)
  if (!adGroupId) return null

  const googleAdGroupId = String(row.google_ad_group_id || '').trim()
  if (!googleAdGroupId) return null

  const searchTerm = normalizeSearchTerm(row.search_term)
  if (!searchTerm) return null

  return {
    adGroupId,
    googleAdGroupId,
    searchTerm,
  }
}

function formatDateYmd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function toUserStatsArray(
  actions: Array<{ userId: number }>
): Map<number, { userId: number; selected: number; applied: number; failed: number }> {
  const userStats = new Map<number, { userId: number; selected: number; applied: number; failed: number }>()
  for (const action of actions) {
    if (!userStats.has(action.userId)) {
      userStats.set(action.userId, { userId: action.userId, selected: 0, applied: 0, failed: 0 })
    }
    userStats.get(action.userId)!.selected++
  }
  return userStats
}

async function loadSearchTermAggregates(options: {
  userId?: number
  offerId?: number
  lookbackDays: number
}): Promise<{ rows: SearchTermAggregateRow[]; startDate: string; endDate: string }> {
  const endDate = formatDateYmd(new Date())
  const start = new Date()
  start.setUTCDate(start.getUTCDate() - options.lookbackDays)
  const startDate = formatDateYmd(start)

  const db = await getDatabase()
  const campaignNotDeleted = boolCondition('c.is_deleted', false, db.type)
  const campaignNotTestVariant = boolCondition('c.is_test_variant', false, db.type)
  const accountActive = boolCondition('gaa.is_active', true, db.type)
  const accountNotDeleted = boolCondition('gaa.is_deleted', false, db.type)

  const params: Array<string | number> = [startDate, endDate]
  const userFilterSql = options.userId ? 'AND str.user_id = ?' : ''
  if (options.userId) params.push(options.userId)
  const offerFilterSql = options.offerId ? 'AND c.offer_id = ?' : ''
  if (options.offerId) params.push(options.offerId)

  const rows = await db.query<SearchTermAggregateRow>(
    `
      SELECT
        str.user_id,
        str.campaign_id,
        str.ad_group_id,
        str.google_ad_group_id,
        str.search_term,
        SUM(str.impressions) AS impressions,
        SUM(str.clicks) AS clicks,
        SUM(str.conversions) AS conversions,
        SUM(str.cost) AS cost,
        c.google_ads_account_id,
        gaa.customer_id,
        gaa.refresh_token,
        o.target_language,
        o.brand
      FROM search_term_reports str
      INNER JOIN campaigns c ON c.id = str.campaign_id
      INNER JOIN google_ads_accounts gaa ON gaa.id = c.google_ads_account_id
      LEFT JOIN offers o ON o.id = c.offer_id
      WHERE str.date BETWEEN ? AND ?
        AND str.ad_group_id IS NOT NULL
        AND str.google_ad_group_id IS NOT NULL
        AND TRIM(str.search_term) <> ''
        AND c.status IN ('ENABLED', 'PAUSED')
        AND ${campaignNotDeleted}
        AND ${campaignNotTestVariant}
        AND gaa.status = 'ENABLED'
        AND ${accountActive}
        AND ${accountNotDeleted}
        ${userFilterSql}
        ${offerFilterSql}
      GROUP BY
        str.user_id,
        str.campaign_id,
        str.ad_group_id,
        str.google_ad_group_id,
        str.search_term,
        c.google_ads_account_id,
        gaa.customer_id,
        gaa.refresh_token,
        o.target_language,
        o.brand
      ORDER BY SUM(str.cost) DESC, SUM(str.clicks) DESC
    `,
    params
  )

  return { rows, startDate, endDate }
}

async function loadExistingKeywordSet(params: {
  adGroupIds: number[]
  onlyNegative?: boolean
}): Promise<Set<string>> {
  const db = await getDatabase()
  const existingSet = new Set<string>()
  if (params.adGroupIds.length === 0) return existingSet

  const placeholders = params.adGroupIds.map(() => '?').join(', ')
  const whereNegative = params.onlyNegative === undefined
    ? ''
    : 'AND is_negative = ?'
  const queryParams: unknown[] = []
  if (params.onlyNegative !== undefined) {
    queryParams.push(boolParam(params.onlyNegative, db.type))
  }

  const existingRows = await db.query<{ ad_group_id: number; keyword_text: string }>(
    `
      SELECT ad_group_id, keyword_text
      FROM keywords
      WHERE ad_group_id IN (${placeholders})
      ${whereNegative}
    `,
    [...params.adGroupIds, ...queryParams]
  )

  for (const row of existingRows) {
    const key = normalizeTermKey(row.keyword_text)
    if (!key) continue
    existingSet.add(`${row.ad_group_id}:${key}`)
  }

  return existingSet
}

export function isDuplicateKeywordErrorMessage(message: string): boolean {
  const normalized = String(message || '').toLowerCase()
  if (!normalized) return false

  const duplicateSignals = [
    'already exists',
    'duplicate',
    'already added',
    'already in ad group',
  ]

  return duplicateSignals.some((signal) => normalized.includes(signal))
}

function isDuplicateKeywordError(error: unknown): boolean {
  const message = String((error as any)?.message || '')
  return isDuplicateKeywordErrorMessage(message)
}

export async function runSearchTermAutoNegatives(
  options: SearchTermAutoNegativeOptions = {}
): Promise<SearchTermAutoNegativeResult> {
  const lookbackDays = options.lookbackDays ?? NEGATIVE_DEFAULTS.lookbackDays
  const minClicks = options.minClicks ?? NEGATIVE_DEFAULTS.minClicks
  const minCost = options.minCost ?? NEGATIVE_DEFAULTS.minCost
  const maxPerAdGroup = options.maxPerAdGroup ?? NEGATIVE_DEFAULTS.maxPerAdGroup
  const maxPerUser = options.maxPerUser ?? NEGATIVE_DEFAULTS.maxPerUser
  const dryRun = options.dryRun === true

  const { rows } = await loadSearchTermAggregates({
    userId: options.userId,
    offerId: options.offerId,
    lookbackDays,
  })

  const adGroupIds = Array.from(
    new Set(
      rows
        .map((row) => Number(row.ad_group_id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  )

  const existingNegativeSet = await loadExistingKeywordSet({ adGroupIds, onlyNegative: true })

  const selectedActions: SearchTermAutoNegativeAction[] = []
  const selectedPerUser = new Map<number, number>()
  const selectedPerAdGroup = new Map<number, number>()
  const selectedSet = new Set<string>()
  let skippedExisting = 0

  for (const row of rows) {
    const parsedRow = parseAggregateSearchTermRow(row)
    if (!parsedRow) continue
    const { adGroupId, googleAdGroupId, searchTerm } = parsedRow

    const intentInfo = classifyKeywordIntent(searchTerm, {
      language: row.target_language || undefined,
    })
    if (!intentInfo.hardNegative) continue

    const clicks = toNumber(row.clicks)
    const conversions = toNumber(row.conversions)
    const cost = toNumber(row.cost)
    if (clicks < minClicks) continue
    if (conversions > 0) continue
    if (cost < minCost) continue

    const existingKey = `${adGroupId}:${normalizeTermKey(searchTerm)}`
    if (existingNegativeSet.has(existingKey)) {
      skippedExisting++
      continue
    }
    if (selectedSet.has(existingKey)) continue

    const userId = Number(row.user_id)
    const selectedUserCount = selectedPerUser.get(userId) || 0
    if (selectedUserCount >= maxPerUser) continue

    const selectedAdGroupCount = selectedPerAdGroup.get(adGroupId) || 0
    if (selectedAdGroupCount >= maxPerAdGroup) continue

    selectedActions.push({
      userId,
      adGroupId,
      googleAdGroupId,
      campaignId: Number(row.campaign_id),
      searchTerm,
      clicks,
      cost,
      googleAdsAccountId: Number(row.google_ads_account_id),
      customerId: String(row.customer_id || '').trim(),
      refreshToken: String(row.refresh_token || ''),
    })

    selectedPerUser.set(userId, selectedUserCount + 1)
    selectedPerAdGroup.set(adGroupId, selectedAdGroupCount + 1)
    selectedSet.add(existingKey)
  }

  const userStats = toUserStatsArray(selectedActions)

  if (dryRun || selectedActions.length === 0) {
    return {
      dryRun,
      lookbackDays,
      scannedRows: rows.length,
      selected: selectedActions.length,
      applied: 0,
      skippedExisting,
      skippedDuplicateRemote: 0,
      failed: 0,
      users: Array.from(userStats.values()),
    }
  }

  const db = await getDatabase()
  const authByUser = new Map<number, Awaited<ReturnType<typeof getUserAuthType>>>()
  const oauthCredentialsByUser = new Map<
    number,
    Awaited<ReturnType<typeof getGoogleAdsCredentials>> | null
  >()

  const getAuth = async (userId: number) => {
    if (authByUser.has(userId)) return authByUser.get(userId)!
    const auth = await getUserAuthType(userId)
    authByUser.set(userId, auth)
    return auth
  }

  const getOAuthCredentials = async (userId: number) => {
    if (oauthCredentialsByUser.has(userId)) {
      return oauthCredentialsByUser.get(userId) || null
    }
    const credentials = await getGoogleAdsCredentials(userId).catch(() => null)
    oauthCredentialsByUser.set(userId, credentials)
    return credentials
  }

  let applied = 0
  let failed = 0
  let skippedDuplicateRemote = 0

  for (const action of selectedActions) {
    const userSummary = userStats.get(action.userId)!
    const key = `${action.adGroupId}:${normalizeTermKey(action.searchTerm)}`

    try {
      const auth = await getAuth(action.userId)
      const oauthCredentials = await getOAuthCredentials(action.userId)
      const loginCustomerId = String(oauthCredentials?.login_customer_id || '').trim() || undefined
      const effectiveRefreshToken = String(
        action.refreshToken || oauthCredentials?.refresh_token || ''
      ).trim()

      if (auth.authType === 'oauth' && !effectiveRefreshToken) {
        throw new Error('missing_refresh_token_for_oauth')
      }

      const createResults = await createGoogleAdsKeywordsBatch({
        customerId: action.customerId,
        refreshToken: effectiveRefreshToken,
        adGroupId: action.googleAdGroupId,
        keywords: [{
          keywordText: action.searchTerm,
          matchType: 'EXACT',
          negativeKeywordMatchType: 'EXACT',
          status: 'ENABLED',
          isNegative: true,
        }],
        accountId: action.googleAdsAccountId,
        userId: action.userId,
        loginCustomerId,
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId,
      })

      const keywordId = createResults[0]?.keywordId || null
      await db.exec(
        `
          INSERT INTO keywords (
            user_id, ad_group_id, keyword_id, keyword_text, match_type, status,
            is_negative, ai_generated, generation_source, creation_status, creation_error, last_sync_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          action.userId,
          action.adGroupId,
          keywordId,
          action.searchTerm,
          'EXACT',
          'ENABLED',
          boolParam(true, db.type),
          boolParam(true, db.type),
          AUTO_NEGATIVE_SOURCE,
          'synced',
          null,
          new Date().toISOString(),
        ]
      )

      existingNegativeSet.add(key)
      applied++
      userSummary.applied++
    } catch (error) {
      if (isDuplicateKeywordError(error)) {
        skippedDuplicateRemote++
        existingNegativeSet.add(key)

        await db.exec(
          `
            INSERT INTO keywords (
              user_id, ad_group_id, keyword_id, keyword_text, match_type, status,
              is_negative, ai_generated, generation_source, creation_status, creation_error, last_sync_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            action.userId,
            action.adGroupId,
            null,
            action.searchTerm,
            'EXACT',
            'ENABLED',
            boolParam(true, db.type),
            boolParam(true, db.type),
            AUTO_NEGATIVE_SOURCE,
            'synced',
            'already_exists_in_google_ads',
            new Date().toISOString(),
          ]
        ).catch(() => undefined)

        continue
      }

      failed++
      userSummary.failed++
      console.warn(
        `[AutoNegative] failed user=${action.userId} campaign=${action.campaignId} adGroup=${action.adGroupId} term="${action.searchTerm}":`,
        error
      )
    }
  }

  return {
    dryRun: false,
    lookbackDays,
    scannedRows: rows.length,
    selected: selectedActions.length,
    applied,
    skippedExisting,
    skippedDuplicateRemote,
    failed,
    users: Array.from(userStats.values()),
  }
}

export async function runSearchTermAutoPositiveKeywords(
  options: SearchTermAutoPositiveOptions = {}
): Promise<SearchTermAutoPositiveResult> {
  const lookbackDays = options.lookbackDays ?? POSITIVE_DEFAULTS.lookbackDays
  const minClicks = options.minClicks ?? POSITIVE_DEFAULTS.minClicks
  const minConversions = options.minConversions ?? POSITIVE_DEFAULTS.minConversions
  const maxPerAdGroup = options.maxPerAdGroup ?? POSITIVE_DEFAULTS.maxPerAdGroup
  const maxPerUser = options.maxPerUser ?? POSITIVE_DEFAULTS.maxPerUser
  const dryRun = options.dryRun === true

  const { rows } = await loadSearchTermAggregates({
    userId: options.userId,
    offerId: options.offerId,
    lookbackDays,
  })

  const sortedRows = [...rows].sort((a, b) => {
    const conversionDiff = toNumber(b.conversions) - toNumber(a.conversions)
    if (conversionDiff !== 0) return conversionDiff

    const clickDiff = toNumber(b.clicks) - toNumber(a.clicks)
    if (clickDiff !== 0) return clickDiff

    return toNumber(a.cost) - toNumber(b.cost)
  })

  const adGroupIds = Array.from(
    new Set(
      sortedRows
        .map((row) => Number(row.ad_group_id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  )

  const existingKeywordSet = await loadExistingKeywordSet({ adGroupIds })

  const selectedActions: SearchTermAutoPositiveAction[] = []
  const selectedPerUser = new Map<number, number>()
  const selectedPerAdGroup = new Map<number, number>()
  const selectedSet = new Set<string>()
  let skippedExisting = 0
  let skippedLowIntent = 0

  for (const row of sortedRows) {
    const parsedRow = parseAggregateSearchTermRow(row)
    if (!parsedRow) continue
    const { adGroupId, googleAdGroupId, searchTerm } = parsedRow

    const intentInfo = classifyKeywordIntent(searchTerm, {
      language: row.target_language || undefined,
    })
    if (intentInfo.hardNegative) continue

    const isHighIntent = intentInfo.intent === 'TRANSACTIONAL' || intentInfo.intent === 'COMMERCIAL'
    if (!isHighIntent) {
      skippedLowIntent++
      continue
    }

    const clicks = toNumber(row.clicks)
    const conversions = toNumber(row.conversions)
    const cost = toNumber(row.cost)

    if (clicks < minClicks) continue
    if (conversions < minConversions) continue

    const existingKey = `${adGroupId}:${normalizeTermKey(searchTerm)}`
    if (existingKeywordSet.has(existingKey)) {
      skippedExisting++
      continue
    }
    if (selectedSet.has(existingKey)) continue

    const userId = Number(row.user_id)
    const selectedUserCount = selectedPerUser.get(userId) || 0
    if (selectedUserCount >= maxPerUser) continue

    const selectedAdGroupCount = selectedPerAdGroup.get(adGroupId) || 0
    if (selectedAdGroupCount >= maxPerAdGroup) continue

    const matchType = recommendMatchTypeForKeyword({
      keyword: searchTerm,
      brandName: row.brand || undefined,
      intent: intentInfo.intent,
    })

    selectedActions.push({
      userId,
      adGroupId,
      googleAdGroupId,
      campaignId: Number(row.campaign_id),
      searchTerm,
      clicks,
      conversions,
      cost,
      matchType,
      googleAdsAccountId: Number(row.google_ads_account_id),
      customerId: String(row.customer_id || '').trim(),
      refreshToken: String(row.refresh_token || ''),
    })

    selectedPerUser.set(userId, selectedUserCount + 1)
    selectedPerAdGroup.set(adGroupId, selectedAdGroupCount + 1)
    selectedSet.add(existingKey)
  }

  const userStats = toUserStatsArray(selectedActions)

  if (dryRun || selectedActions.length === 0) {
    return {
      dryRun,
      lookbackDays,
      scannedRows: rows.length,
      selected: selectedActions.length,
      applied: 0,
      skippedExisting,
      skippedDuplicateRemote: 0,
      skippedLowIntent,
      failed: 0,
      users: Array.from(userStats.values()),
    }
  }

  const db = await getDatabase()
  const authByUser = new Map<number, Awaited<ReturnType<typeof getUserAuthType>>>()
  const oauthCredentialsByUser = new Map<
    number,
    Awaited<ReturnType<typeof getGoogleAdsCredentials>> | null
  >()

  const getAuth = async (userId: number) => {
    if (authByUser.has(userId)) return authByUser.get(userId)!
    const auth = await getUserAuthType(userId)
    authByUser.set(userId, auth)
    return auth
  }

  const getOAuthCredentials = async (userId: number) => {
    if (oauthCredentialsByUser.has(userId)) {
      return oauthCredentialsByUser.get(userId) || null
    }
    const credentials = await getGoogleAdsCredentials(userId).catch(() => null)
    oauthCredentialsByUser.set(userId, credentials)
    return credentials
  }

  let applied = 0
  let failed = 0
  let skippedDuplicateRemote = 0

  for (const action of selectedActions) {
    const userSummary = userStats.get(action.userId)!
    const key = `${action.adGroupId}:${normalizeTermKey(action.searchTerm)}`

    try {
      const auth = await getAuth(action.userId)
      const oauthCredentials = await getOAuthCredentials(action.userId)
      const loginCustomerId = String(oauthCredentials?.login_customer_id || '').trim() || undefined
      const effectiveRefreshToken = String(
        action.refreshToken || oauthCredentials?.refresh_token || ''
      ).trim()

      if (auth.authType === 'oauth' && !effectiveRefreshToken) {
        throw new Error('missing_refresh_token_for_oauth')
      }

      const createResults = await createGoogleAdsKeywordsBatch({
        customerId: action.customerId,
        refreshToken: effectiveRefreshToken,
        adGroupId: action.googleAdGroupId,
        keywords: [{
          keywordText: action.searchTerm,
          matchType: action.matchType,
          status: 'ENABLED',
          isNegative: false,
        }],
        accountId: action.googleAdsAccountId,
        userId: action.userId,
        loginCustomerId,
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId,
      })

      const keywordId = createResults[0]?.keywordId || null
      await db.exec(
        `
          INSERT INTO keywords (
            user_id, ad_group_id, keyword_id, keyword_text, match_type, status,
            is_negative, ai_generated, generation_source, creation_status, creation_error, last_sync_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          action.userId,
          action.adGroupId,
          keywordId,
          action.searchTerm,
          action.matchType,
          'ENABLED',
          boolParam(false, db.type),
          boolParam(true, db.type),
          AUTO_POSITIVE_SOURCE,
          'synced',
          null,
          new Date().toISOString(),
        ]
      )

      existingKeywordSet.add(key)
      applied++
      userSummary.applied++
    } catch (error) {
      if (isDuplicateKeywordError(error)) {
        skippedDuplicateRemote++
        existingKeywordSet.add(key)

        await db.exec(
          `
            INSERT INTO keywords (
              user_id, ad_group_id, keyword_id, keyword_text, match_type, status,
              is_negative, ai_generated, generation_source, creation_status, creation_error, last_sync_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            action.userId,
            action.adGroupId,
            null,
            action.searchTerm,
            action.matchType,
            'ENABLED',
            boolParam(false, db.type),
            boolParam(true, db.type),
            AUTO_POSITIVE_SOURCE,
            'synced',
            'already_exists_in_google_ads',
            new Date().toISOString(),
          ]
        ).catch(() => undefined)

        continue
      }

      failed++
      userSummary.failed++
      console.warn(
        `[AutoPositive] failed user=${action.userId} campaign=${action.campaignId} adGroup=${action.adGroupId} term="${action.searchTerm}":`,
        error
      )
    }
  }

  return {
    dryRun: false,
    lookbackDays,
    scannedRows: rows.length,
    selected: selectedActions.length,
    applied,
    skippedExisting,
    skippedDuplicateRemote,
    skippedLowIntent,
    failed,
    users: Array.from(userStats.values()),
  }
}

export function getSearchTermAutoNegativeDefaults() {
  return { ...NEGATIVE_DEFAULTS }
}

export function getSearchTermAutoPositiveDefaults() {
  return { ...POSITIVE_DEFAULTS }
}

export function getSearchTermAutoNegativeConfigFromEnv() {
  return {
    enabled: process.env.AUTO_SEARCH_TERM_NEGATIVE_ENABLED !== 'false',
    lookbackDays: parsePositiveNumber(
      process.env.AUTO_SEARCH_TERM_NEGATIVE_LOOKBACK_DAYS,
      NEGATIVE_DEFAULTS.lookbackDays
    ),
    minClicks: parsePositiveNumber(
      process.env.AUTO_SEARCH_TERM_NEGATIVE_MIN_CLICKS,
      NEGATIVE_DEFAULTS.minClicks
    ),
    minCost: parsePositiveNumber(
      process.env.AUTO_SEARCH_TERM_NEGATIVE_MIN_COST,
      NEGATIVE_DEFAULTS.minCost
    ),
    maxPerAdGroup: parsePositiveNumber(
      process.env.AUTO_SEARCH_TERM_NEGATIVE_MAX_PER_ADGROUP,
      NEGATIVE_DEFAULTS.maxPerAdGroup
    ),
    maxPerUser: parsePositiveNumber(
      process.env.AUTO_SEARCH_TERM_NEGATIVE_MAX_PER_USER,
      NEGATIVE_DEFAULTS.maxPerUser
    ),
  }
}

export function getSearchTermAutoPositiveConfigFromEnv() {
  return {
    enabled: process.env.AUTO_SEARCH_TERM_POSITIVE_ENABLED !== 'false',
    lookbackDays: parsePositiveNumber(
      process.env.AUTO_SEARCH_TERM_POSITIVE_LOOKBACK_DAYS,
      POSITIVE_DEFAULTS.lookbackDays
    ),
    minClicks: parsePositiveNumber(
      process.env.AUTO_SEARCH_TERM_POSITIVE_MIN_CLICKS,
      POSITIVE_DEFAULTS.minClicks
    ),
    minConversions: parsePositiveNumber(
      process.env.AUTO_SEARCH_TERM_POSITIVE_MIN_CONVERSIONS,
      POSITIVE_DEFAULTS.minConversions
    ),
    maxPerAdGroup: parsePositiveNumber(
      process.env.AUTO_SEARCH_TERM_POSITIVE_MAX_PER_ADGROUP,
      POSITIVE_DEFAULTS.maxPerAdGroup
    ),
    maxPerUser: parsePositiveNumber(
      process.env.AUTO_SEARCH_TERM_POSITIVE_MAX_PER_USER,
      POSITIVE_DEFAULTS.maxPerUser
    ),
  }
}
