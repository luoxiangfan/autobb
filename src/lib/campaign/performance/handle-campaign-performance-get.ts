import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { formatAsYmd, parseYmdQueryParam } from '@/lib/common/server'
import { buildAffiliateUnattributedFailureFilter } from '@/lib/openclaw/affiliate-commission/affiliate-attribution-failures'
import { matchesCampaignSearch } from '@/lib/campaign/server'
import {
  buildCampaignPerformanceCacheHash,
  getCachedCampaignPerformance,
  setCachedCampaignPerformance,
} from '@/lib/campaign/server'
import { getAffiliateDomainKeywords } from '@/lib/keywords/server'
import {
  buildCampaignAffiliateAlignedWhereClause,
  isCampaignAffiliateAlignedRow,
} from '@/lib/campaign/server'
import {
  BASE_CURRENCY,
  CAMPAIGN_SORT_FIELDS,
  calculateRoas,
  diffDaysInclusive,
  filterMapByCampaignIds,
  formatLocalYmd,
  getCampaignRoasValue,
  isCampaignRemovedOrDeleted,
  normalizeCurrency,
  parseOptionalBoolean,
  parseOptionalNonNegativeInt,
  parseOptionalPositiveInt,
  resolveConfiguredMaxCpc,
  roundTo2,
  shiftYmd,
  sumAmountsInCurrency,
  sumCommissionByCampaign,
  summarizeAggByCurrency,
  summarizeCommissionByCurrency,
  summarizeCostsByCurrency,
  convertToBase,
  type PerformanceAgg,
} from '@/lib/campaign/performance/campaign-performance-query-helpers'

export type CampaignPerformanceAuthUser = {
  userId: number
  role?: string
}

export async function handleCampaignPerformanceGet(
  request: Request,
  user: CampaignPerformanceAuthUser
) {
  try {
    const userId = user.userId
    const { searchParams } = new URL(request.url)
    const rawDaysBack = parseInt(searchParams.get('daysBack') || '7', 10)
    const daysBack = Number.isFinite(rawDaysBack) ? Math.min(Math.max(rawDaysBack, 1), 3650) : 7
    const startDateQuery = parseYmdQueryParam(searchParams.get('start_date'))
    const endDateQuery = parseYmdQueryParam(searchParams.get('end_date'))
    const hasCustomRangeQuery = searchParams.has('start_date') || searchParams.has('end_date')
    if (hasCustomRangeQuery) {
      if (!startDateQuery || !endDateQuery) {
        return NextResponse.json(
          { error: 'start_date 和 end_date 必须同时提供，且格式为 YYYY-MM-DD' },
          { status: 400 }
        )
      }
      if (startDateQuery > endDateQuery) {
        return NextResponse.json({ error: 'start_date 不能晚于 end_date' }, { status: 400 })
      }
    }
    const requestedCurrencyRaw = searchParams.get('currency')
    const requestedCurrency = requestedCurrencyRaw ? normalizeCurrency(requestedCurrencyRaw) : null
    const limit = parseOptionalPositiveInt(searchParams.get('limit'))
    const offset = parseOptionalNonNegativeInt(searchParams.get('offset'))
    const searchQuery = (searchParams.get('search') || '').trim().toLowerCase()
    const statusFilterRaw = (searchParams.get('status') || '').trim().toUpperCase()
    const statusFilter = ['ENABLED', 'PAUSED', 'REMOVED', 'ALL'].includes(statusFilterRaw)
      ? statusFilterRaw
      : ''
    const needsOfferCompletionFilter = (searchParams.get('needsOfferCompletion') || '')
      .trim()
      .toUpperCase()
    const statusCategoryFilter = (searchParams.get('statusCategory') || '').trim().toLowerCase()
    const showDeletedParam = parseOptionalBoolean(searchParams.get('showDeleted'))
    const refresh = parseOptionalBoolean(searchParams.get('refresh')) === true
    const noCache = parseOptionalBoolean(searchParams.get('noCache')) === true
    const shouldBypassReadCache = refresh || noCache
    const shouldWriteCache = !noCache
    const sortByParam = (searchParams.get('sortBy') || '').trim()
    const sortOrderParam = (searchParams.get('sortOrder') || '').trim().toLowerCase()
    const sortBy = CAMPAIGN_SORT_FIELDS.has(sortByParam) ? sortByParam : ''
    const sortOrder = sortOrderParam === 'asc' ? 'asc' : sortOrderParam === 'desc' ? 'desc' : null
    const idsParam = (searchParams.get('ids') || '').trim()
    const idsFilter = idsParam
      ? idsParam
          .split(',')
          .map((id) => Number.parseInt(id.trim(), 10))
          .filter((id) => Number.isFinite(id) && id > 0)
      : []
    // 按创建时间过滤（用于"最近 14 天新增"页面）
    const createdAtStartParam = searchParams.get('createdAtStart')
    const createdAtEndParam = searchParams.get('createdAtEnd')
    // 按用户筛选（管理员功能，支持多选）
    const userIdsParam = (searchParams.get('userIds') || '').trim()
    const requestedUserIds = userIdsParam
      ? Array.from(
          new Set(
            userIdsParam
              .split(',')
              .map((id) => Number.parseInt(id.trim(), 10))
              .filter((id) => Number.isFinite(id) && id > 0)
          )
        )
      : []
    // 向后兼容：仍支持旧的单选 userId 参数
    const userIdFilterParam = searchParams.get('userId')
    const userIdFilter = userIdFilterParam ? Number.parseInt(userIdFilterParam, 10) : null
    const isAdmin = user.role === 'admin'
    const effectiveUserIds: number[] | null = (() => {
      if (!isAdmin) return [userId]
      if (requestedUserIds.length > 0) return requestedUserIds
      if (
        userIdFilterParam &&
        userIdFilterParam !== 'all' &&
        userIdFilter &&
        Number.isFinite(userIdFilter)
      ) {
        return [userIdFilter]
      }
      return null
    })()
    // 按联盟筛选（affiliate platform）
    const affiliateFilterParam = searchParams.get('affiliate')
    let affiliateFilter: string | null = null
    if (affiliateFilterParam) {
      try {
        affiliateFilter = decodeURIComponent(affiliateFilterParam).trim() || null
      } catch {
        affiliateFilter = affiliateFilterParam.trim() || null
      }
    }
    // 将联盟平台名称映射到域名关键字（用于 LIKE 查询）
    const affiliateDomainKeywords = affiliateFilter
      ? getAffiliateDomainKeywords(affiliateFilter)
      : []
    const hasAffiliateListScope = Boolean(
      affiliateFilterParam && affiliateFilter && affiliateDomainKeywords.length > 0
    )
    const affiliateLikeBindValues = hasAffiliateListScope
      ? affiliateDomainKeywords.map((k) => `%${k}%`)
      : []
    let startDateStr = startDateQuery || ''
    let endDateStr = endDateQuery || ''
    let rangeDays = daysBack

    if (!startDateStr || !endDateStr) {
      const now = new Date()
      endDateStr = formatLocalYmd(now)
      const startDate = new Date(now)
      // daysBack=7 means "today + previous 6 days" (inclusive 7-day window).
      startDate.setDate(startDate.getDate() - daysBack + 1)
      startDateStr = formatLocalYmd(startDate)
      rangeDays = daysBack
    } else {
      rangeDays = diffDaysInclusive(startDateStr, endDateStr)
    }

    const prevEndDateStr = shiftYmd(startDateStr, -1)
    const prevStartDateStr = shiftYmd(prevEndDateStr, -(rangeDays - 1))
    const cacheHash = buildCampaignPerformanceCacheHash({
      startDate: startDateStr,
      endDate: endDateStr,
      currency: requestedCurrency,
      limit,
      offset,
      search: searchQuery,
      status: statusFilter || 'ALL',
      needsOfferCompletion: needsOfferCompletionFilter || 'ALL',
      statusCategory: statusCategoryFilter || 'all',
      showDeleted: showDeletedParam,
      sortBy,
      sortOrder,
      ids: idsFilter,
      userIds: effectiveUserIds ?? undefined,
      affiliate: affiliateFilter || undefined,
    })

    if (!shouldBypassReadCache) {
      const cached = await getCachedCampaignPerformance<any>(userId, cacheHash)
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    const db = await getDatabase()
    const affiliateAlignedWhereClause = hasAffiliateListScope
      ? buildCampaignAffiliateAlignedWhereClause('c', 'o')
      : ''
    const buildUserScopeClause = (column: string): string =>
      effectiveUserIds !== null
        ? `${column} IN (${effectiveUserIds.map(() => '?').join(',')})`
        : '1=1'
    const userScopeValues = effectiveUserIds ?? []
    const unattributedFailureFilter = buildAffiliateUnattributedFailureFilter({
      includePendingWithinGrace: true,
      includeAllFailures: true,
    })

    const queryCampaignRows = async (): Promise<any[]> =>
      (await db.query(
        `
        SELECT
          c.id,
          c.user_id,
          c.campaign_id,
          c.campaign_name,
          c.custom_name,
          c.offer_id,
          c.status,
          c.status_category,
          c.google_campaign_id,
          c.google_ads_account_id,
          c.budget_amount,
          c.budget_type,
          c.max_cpc,
          c.campaign_config,
          c.creation_status,
          c.creation_error,
          c.last_sync_at,
          c.created_at,
          c.published_at,
          c.is_deleted,
          c.deleted_at,
          gaa.id as ads_account_id,
          gaa.customer_id as ads_account_customer_id,
          gaa.account_name as ads_account_name,
          gaa.is_active as ads_account_is_active,
          gaa.is_deleted as ads_account_is_deleted,
          gaa.currency as ads_account_currency,
          o.brand as offer_brand,
          o.url as offer_url,
          o.is_deleted as offer_is_deleted,
          o.is_deleted as offer_is_deleted,
          o.needs_completion as offer_needs_completion,
          o.sync_source as offer_sync_source,
          o.google_ads_campaign_id as offer_google_ads_campaign_id,
          (SELECT status FROM click_farm_tasks WHERE offer_id = c.offer_id AND ${'is_deleted = false'} ORDER BY created_at DESC LIMIT 1) as click_farm_task_status,
          (SELECT status FROM url_swap_tasks WHERE offer_id = c.offer_id AND ${'is_deleted = false'} ORDER BY created_at DESC LIMIT 1) as url_swap_task_status
        FROM campaigns c
        LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
        LEFT JOIN offers o ON c.offer_id = o.id
        WHERE ${buildUserScopeClause('c.user_id')}
        ${
          hasAffiliateListScope
            ? `AND (
          ${affiliateDomainKeywords.map(() => `o.affiliate_link LIKE ?`).join(' OR ')}
        )`
            : ''
        }
        ${affiliateAlignedWhereClause}
        ${createdAtStartParam ? `AND c.created_at >= ?` : ''}
        ${createdAtEndParam ? `AND c.created_at <= ?` : ''}
        ORDER BY c.created_at DESC
      `,
        [
          ...userScopeValues,
          ...affiliateLikeBindValues,
          ...(createdAtStartParam ? [createdAtStartParam] : []),
          ...(createdAtEndParam ? [createdAtEndParam] : []),
        ]
      )) as any[]

    const aggregateByCampaignCurrency = async (params: {
      start: string
      end: string
    }): Promise<Map<number, Map<string, PerformanceAgg>>> => {
      const rows = (await db.query(
        `
        SELECT
          campaign_id,
          COALESCE(currency, 'USD') as currency,
          COALESCE(SUM(impressions), 0) as impressions,
          COALESCE(SUM(clicks), 0) as clicks,
          COALESCE(SUM(cost), 0) as cost
        FROM campaign_performance
        WHERE ${buildUserScopeClause('user_id')}
          AND date >= ?
          AND date <= ?
        GROUP BY campaign_id, COALESCE(currency, 'USD')
      `,
        [...userScopeValues, params.start, params.end]
      )) as any[]

      const map = new Map<number, Map<string, PerformanceAgg>>()
      for (const row of rows) {
        const campaignId = Number(row.campaign_id)
        if (!Number.isFinite(campaignId)) continue

        const currency = normalizeCurrency(row.currency)
        const agg: PerformanceAgg = {
          impressions: Number(row.impressions) || 0,
          clicks: Number(row.clicks) || 0,
          cost: Number(row.cost) || 0,
        }

        const byCurrency = map.get(campaignId) ?? new Map<string, PerformanceAgg>()
        byCurrency.set(currency, agg)
        map.set(campaignId, byCurrency)
      }
      return map
    }

    const queryCommissionByCampaignCurrency = async (params: {
      start: string
      end: string
      currency?: string
    }): Promise<Map<number, Map<string, number>>> => {
      const hasCurrencyFilter = Boolean(params.currency)
      const rows = await db.query<{ campaign_id: number; currency: string; commission: number }>(
        `
          SELECT
            a.campaign_id,
            COALESCE(a.currency, 'USD') as currency,
            COALESCE(SUM(a.commission_amount), 0) AS commission
          FROM affiliate_commission_attributions a
          INNER JOIN campaigns c ON a.campaign_id = c.id
          INNER JOIN offers o ON c.offer_id = o.id
          WHERE ${buildUserScopeClause('c.user_id')}
            AND a.report_date >= ?
            AND a.report_date <= ?
            ${
              affiliateFilterParam && affiliateFilter && affiliateDomainKeywords.length > 0
                ? `AND (${affiliateDomainKeywords
                    .map((_, _i) => `o.affiliate_link LIKE ?`)
                    .join(' OR ')})`
                : ''
            }
            ${hasCurrencyFilter ? "AND COALESCE(a.currency, 'USD') = ?" : ''}
            AND a.campaign_id IS NOT NULL
          GROUP BY a.campaign_id, COALESCE(a.currency, 'USD')
        `,
        hasCurrencyFilter
          ? [
              ...userScopeValues,
              params.start,
              params.end,
              ...affiliateLikeBindValues,
              String(params.currency),
            ]
          : [...userScopeValues, params.start, params.end, ...affiliateLikeBindValues]
      )

      const map = new Map<number, Map<string, number>>()
      for (const row of rows) {
        const campaignId = Number(row.campaign_id)
        if (!Number.isFinite(campaignId)) continue
        const currency = normalizeCurrency(row.currency)
        const commission = Number(row.commission) || 0
        const byCurrency = map.get(campaignId) ?? new Map<string, number>()
        byCurrency.set(currency, commission)
        map.set(campaignId, byCurrency)
      }
      return map
    }

    const queryUnattributedCommissionByCampaignCurrency = async (params: {
      start: string
      end: string
      currency?: string
    }): Promise<Map<number, Map<string, number>>> => {
      const hasCurrencyFilter = Boolean(params.currency)
      try {
        const rows = await db.query<{ campaign_id: number; currency: string; commission: number }>(
          `
          WITH scoped_campaigns AS (
            SELECT c.id, c.offer_id, c.user_id
            FROM campaigns c
            INNER JOIN offers o ON c.offer_id = o.id
            WHERE ${buildUserScopeClause('c.user_id')}
              AND c.offer_id IS NOT NULL
              ${
                affiliateFilterParam && affiliateFilter && affiliateDomainKeywords.length > 0
                  ? `AND (${affiliateDomainKeywords
                      .map(() => `o.affiliate_link LIKE ?`)
                      .join(' OR ')})`
                  : ''
              }
          ),
          offer_campaign_counts AS (
            SELECT offer_id, COUNT(*) AS campaign_count
            FROM scoped_campaigns
            GROUP BY offer_id
          )
          SELECT
            sc.id AS campaign_id,
            COALESCE(f.currency, 'USD') as currency,
            COALESCE(SUM(f.commission_amount / occ.campaign_count), 0) AS commission
          FROM openclaw_affiliate_attribution_failures f
          INNER JOIN scoped_campaigns sc ON f.offer_id = sc.offer_id
          INNER JOIN offer_campaign_counts occ ON sc.offer_id = occ.offer_id
          WHERE f.report_date >= ?
            AND f.report_date <= ?
            AND f.offer_id IS NOT NULL
            AND ${unattributedFailureFilter.sql}
            ${hasCurrencyFilter ? "AND COALESCE(f.currency, 'USD') = ?" : ''}
          GROUP BY sc.id, COALESCE(f.currency, 'USD')
        `,
          hasCurrencyFilter
            ? [
                ...userScopeValues,
                ...affiliateLikeBindValues,
                params.start,
                params.end,
                ...unattributedFailureFilter.values,
                String(params.currency),
              ]
            : [
                ...userScopeValues,
                ...affiliateLikeBindValues,
                params.start,
                params.end,
                ...unattributedFailureFilter.values,
              ]
        )

        const map = new Map<number, Map<string, number>>()
        for (const row of rows) {
          const campaignId = Number(row.campaign_id)
          if (!Number.isFinite(campaignId)) continue
          const currency = normalizeCurrency(row.currency)
          const commission = Number(row.commission) || 0
          const byCurrency = map.get(campaignId) ?? new Map<string, number>()
          byCurrency.set(currency, commission)
          map.set(campaignId, byCurrency)
        }
        return map
      } catch (error: any) {
        const message = String(error?.message || '')
        if (
          /openclaw_affiliate_attribution_failures/i.test(message) &&
          /(no such table|does not exist|no such column|column .* does not exist)/i.test(message)
        ) {
          return new Map<number, Map<string, number>>()
        }
        throw error
      }
    }

    let campaigns: any[]
    let currentPerformanceAggByCampaign: Map<number, Map<string, PerformanceAgg>>
    let currentCommissionByCampaign: Map<number, Map<string, number>>
    let currentUnattributedCommissionByCampaign: Map<number, Map<string, number>>
    ;[
      campaigns,
      currentPerformanceAggByCampaign,
      currentCommissionByCampaign,
      currentUnattributedCommissionByCampaign,
    ] = await Promise.all([
      queryCampaignRows(),
      aggregateByCampaignCurrency({
        start: startDateStr,
        end: endDateStr,
      }),
      queryCommissionByCampaignCurrency({
        start: startDateStr,
        end: endDateStr,
      }),
      queryUnattributedCommissionByCampaignCurrency({
        start: startDateStr,
        end: endDateStr,
      }),
    ])
    const costs = summarizeCostsByCurrency(currentPerformanceAggByCampaign)
    const costCurrencies = costs.map((row) => row.currency)
    const reportingCurrency =
      requestedCurrency && costCurrencies.includes(requestedCurrency) ? requestedCurrency : null

    const pickCampaignCurrency = (params: {
      accountCurrency: string
      currentPerformanceAgg?: Map<string, PerformanceAgg>
    }): string => {
      if (reportingCurrency) {
        return reportingCurrency
      }

      const accountCurrency = normalizeCurrency(params.accountCurrency)
      const currentPerformanceAgg = params.currentPerformanceAgg
      if (!currentPerformanceAgg || currentPerformanceAgg.size === 0) return accountCurrency

      const options = Array.from(currentPerformanceAgg.entries())
        .map(([currency, agg]) => ({
          currency: normalizeCurrency(currency),
          cost: Number(agg.cost) || 0,
        }))
        .sort((a, b) => b.cost - a.cost || a.currency.localeCompare(b.currency))

      const top = options[0]?.currency
      if (!top) return accountCurrency

      return top
    }

    const formattedCampaigns = campaigns.map((c) => {
      const hasLinkedAdsAccountId =
        c.google_ads_account_id !== null && c.google_ads_account_id !== undefined
      const hasAccountRow = c.ads_account_id !== null && c.ads_account_id !== undefined
      const adsAccountIsActive = c.ads_account_is_active === true || c.ads_account_is_active === 1
      const adsAccountIsDeleted =
        c.ads_account_is_deleted === true || c.ads_account_is_deleted === 1
      const adsAccountAvailable =
        hasLinkedAdsAccountId && hasAccountRow && adsAccountIsActive && !adsAccountIsDeleted

      const currentPerformanceAgg = currentPerformanceAggByCampaign.get(Number(c.id))
      const accountCurrency = normalizeCurrency(c.ads_account_currency)
      const selectedCurrency = pickCampaignCurrency({
        accountCurrency,
        currentPerformanceAgg,
      })

      const selectedCurrent = currentPerformanceAgg?.get(selectedCurrency)
      const impressions = Number(selectedCurrent?.impressions) || 0
      const clicks = Number(selectedCurrent?.clicks) || 0
      const cost = Number(selectedCurrent?.cost) || 0

      const commissionByCurrency = currentCommissionByCampaign.get(Number(c.id))
      const commission = reportingCurrency
        ? Number(commissionByCurrency?.get(selectedCurrency)) || 0
        : sumAmountsInCurrency(commissionByCurrency, selectedCurrency)
      const commissionPerClick = clicks > 0 ? commission / clicks : 0
      const costBase = convertToBase(cost, selectedCurrency)
      const commissionBase = convertToBase(commission, selectedCurrency)
      const cpcBase = clicks > 0 ? costBase / clicks : 0
      const configuredMaxCpc = resolveConfiguredMaxCpc(c.max_cpc, c.campaign_config)

      return {
        id: c.id,
        userId: c.user_id,
        campaignName: c.campaign_name,
        customName: c.custom_name ?? null,
        offerId: c.offer_id,
        offerBrand: c.offer_brand,
        offerUrl: c.offer_url,
        offerNeedsCompletion: c.offer_needs_completion,
        offerSyncSource: c.offer_sync_source,
        offerGoogleAdsCampaignId: c.offer_google_ads_campaign_id,
        clickFarmTaskStatus: c.click_farm_task_status ?? null,
        urlSwapTaskStatus: c.url_swap_task_status ?? null,
        status: c.status,
        statusCategory: c.status_category ?? 'pending',
        googleCampaignId: c.google_campaign_id,
        googleAdsAccountId: c.google_ads_account_id,
        adsAccountCustomerId: c.ads_account_customer_id ?? null,
        adsAccountName: c.ads_account_name ?? null,
        campaignId: c.campaign_id,
        creationStatus: c.creation_status,
        creationError: c.creation_error ?? null,
        servingStartDate: formatAsYmd(c.published_at ?? c.created_at),
        adsAccountAvailable,
        // 账号原始币种（用于预算展示与预算调整）
        adsAccountCurrency: accountCurrency,
        // 报表币种（用于花费/CPC/佣金展示，受 currency 筛选影响）
        performanceCurrency: selectedCurrency,
        budgetAmount: Number(c.budget_amount) || 0,
        budgetType: c.budget_type,
        configuredMaxCpc,
        lastSyncAt: c.last_sync_at,
        createdAt: c.created_at,
        isDeleted: c.is_deleted,
        deletedAt: c.deleted_at,
        offerIsDeleted: c.offer_is_deleted,
        performance: {
          impressions,
          clicks,
          conversions: roundTo2(commission),
          commission: roundTo2(commission),
          commissionBase: roundTo2(commissionBase),
          costLocal: cost,
          costUsd: cost,
          costBase: roundTo2(costBase),
          ctr: impressions > 0 ? Math.round((clicks * 10000) / impressions) / 100 : 0,
          cpcLocal: clicks > 0 ? Math.round((cost * 100) / clicks) / 100 : 0,
          cpcUsd: clicks > 0 ? Math.round((cost * 100) / clicks) / 100 : 0,
          cpcBase: roundTo2(cpcBase),
          conversionRate: roundTo2(commissionPerClick),
          commissionPerClick: roundTo2(commissionPerClick),
          dateRange: {
            start: startDateStr,
            end: endDateStr,
            days: rangeDays,
          },
        },
      }
    })

    let listCampaigns = formattedCampaigns

    if (idsFilter.length > 0) {
      const idsSet = new Set(idsFilter)
      listCampaigns = listCampaigns.filter((campaign) => idsSet.has(Number(campaign.id)))
    }

    if (showDeletedParam === false) {
      listCampaigns = listCampaigns.filter((campaign) => !isCampaignRemovedOrDeleted(campaign))
    }

    if (hasAffiliateListScope) {
      listCampaigns = listCampaigns.filter((campaign) =>
        isCampaignAffiliateAlignedRow({
          is_deleted: campaign.isDeleted,
          creation_status: campaign.creationStatus,
          status: campaign.status,
          offer_is_deleted: campaign.offerIsDeleted,
        })
      )
    }

    if (searchQuery) {
      listCampaigns = listCampaigns.filter((campaign) =>
        matchesCampaignSearch(searchQuery, campaign)
      )
    }

    if (statusFilter && statusFilter !== 'ALL') {
      listCampaigns = listCampaigns.filter(
        (campaign) => String(campaign.status || '').toUpperCase() === statusFilter
      )
    }

    if (needsOfferCompletionFilter && needsOfferCompletionFilter !== 'ALL') {
      listCampaigns = listCampaigns.filter(
        (campaign) =>
          String(campaign.offerNeedsCompletion || '').toUpperCase() === needsOfferCompletionFilter
      )
    }

    if (statusCategoryFilter && statusCategoryFilter !== 'all') {
      listCampaigns = listCampaigns.filter(
        (campaign) => (campaign.statusCategory || 'pending') === statusCategoryFilter
      )
    }

    if (sortBy && sortOrder) {
      const direction = sortOrder === 'asc' ? 1 : -1
      listCampaigns = [...listCampaigns].sort((a, b) => {
        if (sortBy === 'servingStartDate') {
          const aDate = a.servingStartDate
          const bDate = b.servingStartDate
          if (!aDate && !bDate) return 0
          if (!aDate) return 1
          if (!bDate) return -1
          return aDate < bDate ? -direction : aDate > bDate ? direction : 0
        }

        if (sortBy === 'roas') {
          const aRoas = getCampaignRoasValue(a)
          const bRoas = getCampaignRoasValue(b)
          if (aRoas === null && bRoas === null) return 0
          if (aRoas === null) return 1
          if (bRoas === null) return -1
          return (aRoas - bRoas) * direction
        }

        let aVal: string | number = 0
        let bVal: string | number = 0

        switch (sortBy) {
          case 'campaignName':
            aVal = String(a.campaignName || '').toLowerCase()
            bVal = String(b.campaignName || '').toLowerCase()
            break
          case 'budgetAmount':
            aVal = Number(a.budgetAmount) || 0
            bVal = Number(b.budgetAmount) || 0
            break
          case 'impressions':
            aVal = Number(a.performance?.impressions) || 0
            bVal = Number(b.performance?.impressions) || 0
            break
          case 'clicks':
            aVal = Number(a.performance?.clicks) || 0
            bVal = Number(b.performance?.clicks) || 0
            break
          case 'ctr':
            aVal = Number(a.performance?.ctr) || 0
            bVal = Number(b.performance?.ctr) || 0
            break
          case 'cpc':
            aVal =
              Number(a.performance?.cpcBase ?? a.performance?.cpcLocal ?? a.performance?.cpcUsd) ||
              0
            bVal =
              Number(b.performance?.cpcBase ?? b.performance?.cpcLocal ?? b.performance?.cpcUsd) ||
              0
            break
          case 'configuredMaxCpc':
            aVal = Number(a.configuredMaxCpc) || 0
            bVal = Number(b.configuredMaxCpc) || 0
            break
          case 'conversions':
            aVal =
              Number(
                a.performance?.commissionBase ??
                  a.performance?.commission ??
                  a.performance?.conversions
              ) || 0
            bVal =
              Number(
                b.performance?.commissionBase ??
                  b.performance?.commission ??
                  b.performance?.conversions
              ) || 0
            break
          case 'cost':
            aVal =
              Number(
                a.performance?.costBase ?? a.performance?.costLocal ?? a.performance?.costUsd
              ) || 0
            bVal =
              Number(
                b.performance?.costBase ?? b.performance?.costLocal ?? b.performance?.costUsd
              ) || 0
            break
          case 'status':
            aVal = String(a.status || '')
            bVal = String(b.status || '')
            break
          default:
            return 0
        }

        if (aVal < bVal) return -direction
        if (aVal > bVal) return direction
        return 0
      })
    }

    const summaryCampaigns = [...listCampaigns]
    const listTotal = listCampaigns.length
    const pagingOffset = offset ?? 0
    if (limit !== null || offset !== null) {
      const pagingLimit = limit ?? Math.max(listTotal - pagingOffset, 0)
      listCampaigns = listCampaigns.slice(pagingOffset, pagingOffset + pagingLimit)
    }

    const latestCampaignSyncFallback = formattedCampaigns.reduce<string | null>(
      (latest, campaign) => {
        const candidate = campaign.lastSyncAt
        if (!candidate) return latest

        const candidateTs = Date.parse(candidate)
        if (Number.isNaN(candidateTs)) return latest

        if (!latest) return candidate
        const latestTs = Date.parse(latest)
        if (Number.isNaN(latestTs) || candidateTs > latestTs) return candidate

        return latest
      },
      null
    )

    const latestSyncFromLogsPromise = db.queryOne<{ latest_sync_at: string | null }>(
      `
            SELECT MAX(
              COALESCE(
                NULLIF(completed_at, '')::timestamptz,
                NULLIF(started_at, '')::timestamptz,
                NULLIF(created_at, '')::timestamptz
              )
            )::text AS latest_sync_at
            FROM sync_logs
            WHERE ${buildUserScopeClause('user_id')}
          `,
      userScopeValues
    )

    const latestSyncFromLogsRow = await latestSyncFromLogsPromise

    const latestSyncAt = latestSyncFromLogsRow?.latest_sync_at || latestCampaignSyncFallback

    const queryPreviousSummary = async (params: {
      start: string
      end: string
      currency?: string
    }): Promise<{
      totals: PerformanceAgg
      attributedCommissionTotal: number
    }> => {
      const hasCurrencyFilter = Boolean(params.currency)
      const rows = await db.query<{
        summary_source: string
        currency: string | null
        impressions: number | null
        clicks: number | null
        amount: number | null
      }>(
        `
          SELECT
            'performance' AS summary_source,
            COALESCE(currency, 'USD') AS currency,
            COALESCE(SUM(impressions), 0) AS impressions,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(cost), 0) AS amount
          FROM campaign_performance
          WHERE ${buildUserScopeClause('user_id')}
            AND date >= ?
            AND date <= ?
            ${hasCurrencyFilter ? "AND COALESCE(currency, 'USD') = ?" : ''}
          GROUP BY 2
          UNION ALL
          SELECT
            'attributed' AS summary_source,
            COALESCE(a.currency, 'USD') AS currency,
            0 AS impressions,
            0 AS clicks,
            COALESCE(SUM(a.commission_amount), 0) AS amount
          FROM affiliate_commission_attributions a
          INNER JOIN campaigns c ON a.campaign_id = c.id
          INNER JOIN offers o ON c.offer_id = o.id
          WHERE ${buildUserScopeClause('c.user_id')}
            AND a.report_date >= ?
            AND a.report_date <= ?
            ${
              affiliateFilterParam && affiliateFilter && affiliateDomainKeywords.length > 0
                ? `AND (${affiliateDomainKeywords
                    .map((_, _i) => `o.affiliate_link LIKE ?`)
                    .join(' OR ')})`
                : ''
            }
            ${hasCurrencyFilter ? "AND COALESCE(a.currency, 'USD') = ?" : ''}
          GROUP BY 2
        `,
        hasCurrencyFilter
          ? [
              ...userScopeValues,
              params.start,
              params.end,
              String(params.currency),
              ...userScopeValues,
              params.start,
              params.end,
              ...affiliateLikeBindValues,
              String(params.currency),
            ]
          : [
              ...userScopeValues,
              params.start,
              params.end,
              ...userScopeValues,
              params.start,
              params.end,
              ...affiliateLikeBindValues,
            ]
      )

      const totals: PerformanceAgg = {
        impressions: 0,
        clicks: 0,
        cost: 0,
      }
      let attributedCommissionTotal = 0

      for (const row of rows) {
        const amount = Number(row.amount) || 0
        const currency = normalizeCurrency(row.currency)
        if (row.summary_source === 'performance') {
          totals.impressions += Number(row.impressions) || 0
          totals.clicks += Number(row.clicks) || 0
          totals.cost += hasCurrencyFilter ? amount : convertToBase(amount, currency)
          continue
        }

        if (row.summary_source === 'attributed') {
          attributedCommissionTotal += amount
        }
      }

      return {
        totals,
        attributedCommissionTotal,
      }
    }

    const queryUnattributedCommissionPeriods = async (params: {
      currentStart: string
      currentEnd: string
      previousStart: string
      previousEnd: string
      currency?: string
    }): Promise<{
      currentTotal: number
      previousTotal: number
      currentByCurrency: Array<{ currency: string; amount: number }>
    }> => {
      const hasCurrencyFilter = Boolean(params.currency)
      try {
        const queryParams = hasCurrencyFilter
          ? [
              ...userScopeValues,
              params.currentStart,
              params.currentEnd,
              ...unattributedFailureFilter.values,
              String(params.currency),
              ...userScopeValues,
              params.previousStart,
              params.previousEnd,
              ...unattributedFailureFilter.values,
              String(params.currency),
            ]
          : [
              ...userScopeValues,
              params.currentStart,
              params.currentEnd,
              ...unattributedFailureFilter.values,
              ...userScopeValues,
              params.previousStart,
              params.previousEnd,
              ...unattributedFailureFilter.values,
            ]
        const rows = await db.query<{
          period_label: string
          currency: string | null
          total_commission: number | null
        }>(
          `
            SELECT
              'current' AS period_label,
              COALESCE(currency, 'USD') AS currency,
              COALESCE(SUM(commission_amount), 0) AS total_commission
            FROM openclaw_affiliate_attribution_failures
            WHERE ${buildUserScopeClause('user_id')}
              AND report_date >= ?
              AND report_date <= ?
              AND ${unattributedFailureFilter.sql}
              ${hasCurrencyFilter ? "AND COALESCE(currency, 'USD') = ?" : ''}
            GROUP BY 2
            UNION ALL
            SELECT
              'previous' AS period_label,
              COALESCE(currency, 'USD') AS currency,
              COALESCE(SUM(commission_amount), 0) AS total_commission
            FROM openclaw_affiliate_attribution_failures
            WHERE ${buildUserScopeClause('user_id')}
              AND report_date >= ?
              AND report_date <= ?
              AND ${unattributedFailureFilter.sql}
              ${hasCurrencyFilter ? "AND COALESCE(currency, 'USD') = ?" : ''}
            GROUP BY 2
          `,
          queryParams
        )

        let currentTotal = 0
        let previousTotal = 0
        const currentByCurrency: Array<{ currency: string; amount: number }> = []

        for (const row of rows) {
          const amount = Number(row.total_commission) || 0
          const currency = normalizeCurrency(row.currency)
          if (row.period_label === 'current') {
            currentTotal += amount
            if (!hasCurrencyFilter && amount > 0) {
              currentByCurrency.push({
                currency,
                amount: roundTo2(amount),
              })
            }
            continue
          }

          if (row.period_label === 'previous') {
            previousTotal += amount
          }
        }

        return {
          currentTotal,
          previousTotal,
          currentByCurrency,
        }
      } catch (error: any) {
        const message = String(error?.message || '')
        if (
          /openclaw_affiliate_attribution_failures/i.test(message) &&
          /(no such table|does not exist)/i.test(message)
        ) {
          return {
            currentTotal: 0,
            previousTotal: 0,
            currentByCurrency: [],
          }
        }
        throw error
      }
    }

    const isFilteredByCurrency = Boolean(reportingCurrency)
    const summaryCampaignIds = new Set(
      summaryCampaigns.map((campaign) => Number(campaign.id)).filter((id) => Number.isFinite(id))
    )
    const summaryPerformanceAggByCampaign = filterMapByCampaignIds(
      currentPerformanceAggByCampaign,
      summaryCampaignIds
    )
    const summaryAttributedCommissionByCampaign = filterMapByCampaignIds(
      currentCommissionByCampaign,
      summaryCampaignIds
    )
    const summaryUnattributedCommissionByCampaign = filterMapByCampaignIds(
      currentUnattributedCommissionByCampaign,
      summaryCampaignIds
    )
    const summaryCostsDerived = summarizeCostsByCurrency(summaryPerformanceAggByCampaign)
    const currentTotalsDerived = summarizeAggByCurrency({
      byCampaign: summaryPerformanceAggByCampaign,
      reportingCurrency,
    })
    const currentAttributedCommissionByCurrencyDerived = summarizeCommissionByCurrency(
      summaryAttributedCommissionByCampaign
    )
    const currentUnattributedCommissionByCurrencyDerived = summarizeCommissionByCurrency(
      summaryUnattributedCommissionByCampaign
    )
    const currentAttributedCommissionTotalDerived = sumCommissionByCampaign(
      summaryAttributedCommissionByCampaign,
      reportingCurrency
    )
    const currentUnattributedCommissionTotalDerived = sumCommissionByCampaign(
      summaryUnattributedCommissionByCampaign,
      reportingCurrency
    )

    let currentTotals: PerformanceAgg
    let prevTotals: PerformanceAgg
    let currentAttributedCommissionTotal: number
    let prevAttributedCommissionTotal: number
    let currentUnattributedCommissionTotal: number
    let prevUnattributedCommissionTotal: number
    let currentAttributedCommissionByCurrency: Array<{ currency: string; amount: number }>
    let currentUnattributedCommissionByCurrency: Array<{ currency: string; amount: number }>
    let prevSummary: { totals: PerformanceAgg; attributedCommissionTotal: number }
    let unattributedSummary: {
      currentTotal: number
      previousTotal: number
      currentByCurrency: Array<{ currency: string; amount: number }>
    }
    ;[prevSummary, unattributedSummary] = await Promise.all([
      queryPreviousSummary({
        start: prevStartDateStr,
        end: prevEndDateStr,
        currency: reportingCurrency || undefined,
      }),
      queryUnattributedCommissionPeriods({
        currentStart: startDateStr,
        currentEnd: endDateStr,
        previousStart: prevStartDateStr,
        previousEnd: prevEndDateStr,
        currency: reportingCurrency || undefined,
      }),
    ])

    currentTotals = currentTotalsDerived
    prevTotals = prevSummary.totals
    currentAttributedCommissionTotal = currentAttributedCommissionTotalDerived
    prevAttributedCommissionTotal = prevSummary.attributedCommissionTotal
    currentUnattributedCommissionTotal = currentUnattributedCommissionTotalDerived
    prevUnattributedCommissionTotal = unattributedSummary.previousTotal
    currentAttributedCommissionByCurrency = isFilteredByCurrency
      ? []
      : currentAttributedCommissionByCurrencyDerived
    currentUnattributedCommissionByCurrency = isFilteredByCurrency
      ? []
      : currentUnattributedCommissionByCurrencyDerived
    const summaryCostCurrencies = summaryCostsDerived.map((row) => row.currency)
    const commissionCurrencies = Array.from(
      new Set([
        ...currentAttributedCommissionByCurrency.map((row) => normalizeCurrency(row.currency)),
        ...currentUnattributedCommissionByCurrency.map((row) => normalizeCurrency(row.currency)),
      ])
    )
    const summaryCurrencies = Array.from(
      new Set([...summaryCostCurrencies, ...commissionCurrencies])
    )
    const hasMixedCurrency = summaryCurrencies.length > 1
    const currentCommissionTotal =
      currentAttributedCommissionTotal + currentUnattributedCommissionTotal
    const prevCommissionTotal = prevAttributedCommissionTotal + prevUnattributedCommissionTotal

    const calcChange = (current: number, previous: number): number | null => {
      if (previous === 0) return current > 0 ? 100 : null
      return Math.round(((current - previous) / previous) * 10000) / 100
    }

    const changes = {
      impressions: calcChange(currentTotals.impressions, prevTotals.impressions),
      clicks: calcChange(currentTotals.clicks, prevTotals.clicks),
      conversions: calcChange(currentCommissionTotal, prevCommissionTotal),
      cost: isFilteredByCurrency ? calcChange(currentTotals.cost, prevTotals.cost) : null,
      roas: null as number | null,
      roasInfinite: false,
    }
    const hasCampaignScopeFilter =
      idsFilter.length > 0 ||
      showDeletedParam === false ||
      Boolean(searchQuery) ||
      (statusFilter && statusFilter !== 'ALL') ||
      (needsOfferCompletionFilter && needsOfferCompletionFilter !== 'ALL') ||
      (statusCategoryFilter && statusCategoryFilter !== 'all')
    if (hasCampaignScopeFilter) {
      changes.impressions = null
      changes.clicks = null
      changes.conversions = null
      changes.cost = null
      changes.roas = null
      changes.roasInfinite = false
    }

    const roasAvailable = isFilteredByCurrency || !hasMixedCurrency
    let totalRoas: number | null = null
    let totalRoasInfinite = false
    let prevRoas: number | null = null
    let prevRoasInfinite = false

    if (roasAvailable) {
      const currentRoas = calculateRoas(currentCommissionTotal, currentTotals.cost)
      const previousRoas = calculateRoas(prevCommissionTotal, prevTotals.cost)
      totalRoas = currentRoas.value
      totalRoasInfinite = currentRoas.infinite
      prevRoas = previousRoas.value
      prevRoasInfinite = previousRoas.infinite

      if (totalRoasInfinite) {
        changes.roasInfinite = true
      } else if (
        !prevRoasInfinite &&
        typeof prevRoas === 'number' &&
        prevRoas > 0 &&
        typeof totalRoas === 'number'
      ) {
        changes.roas = roundTo2(((totalRoas - prevRoas) / prevRoas) * 100)
      }
    }

    const statusDistribution = {
      enabled: summaryCampaigns.filter((c) => String(c.status || '').toUpperCase() === 'ENABLED')
        .length,
      paused: summaryCampaigns.filter((c) => String(c.status || '').toUpperCase() === 'PAUSED')
        .length,
      removed: summaryCampaigns.filter((c) => String(c.status || '').toUpperCase() === 'REMOVED')
        .length,
      total: summaryCampaigns.length,
    }

    const responsePayload = {
      success: true,
      campaigns: listCampaigns,
      total: listTotal,
      limit: limit ?? null,
      offset: pagingOffset,
      summary: {
        totalCampaigns: summaryCampaigns.length,
        activeCampaigns: summaryCampaigns.filter((c) => c.status === 'ENABLED').length,
        totalImpressions: currentTotals.impressions,
        totalClicks: currentTotals.clicks,
        totalConversions: roundTo2(currentCommissionTotal),
        totalCommission: roundTo2(currentCommissionTotal),
        attributedCommission: roundTo2(currentAttributedCommissionTotal),
        unattributedCommission: roundTo2(currentUnattributedCommissionTotal),
        totalCostUsd: currentTotals.cost,
        totalRoas: roasAvailable ? totalRoas : null,
        totalRoasInfinite: roasAvailable ? totalRoasInfinite : false,
        baseCurrency: BASE_CURRENCY,
        currency:
          hasMixedCurrency && !isFilteredByCurrency
            ? 'MIXED'
            : reportingCurrency || summaryCurrencies[0] || summaryCostCurrencies[0] || 'USD',
        currencies: summaryCostCurrencies,
        hasMixedCurrency,
        costs: hasMixedCurrency && !isFilteredByCurrency ? summaryCostsDerived : undefined,
        attributedCommissionsByCurrency: currentAttributedCommissionByCurrency,
        unattributedCommissionsByCurrency: currentUnattributedCommissionByCurrency,
        latestSyncAt,
        statusDistribution,
        changes: {
          impressions: changes.impressions,
          clicks: changes.clicks,
          conversions: changes.conversions,
          cost: changes.cost,
        },
        comparisonPeriod: {
          current: { start: startDateStr, end: endDateStr },
          previous: { start: prevStartDateStr, end: prevEndDateStr },
        },
      },
    }

    if (shouldWriteCache) {
      await setCachedCampaignPerformance(userId, cacheHash, responsePayload)
    }

    return NextResponse.json(responsePayload)
  } catch (error: any) {
    console.error('Get campaigns performance error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get performance data' },
      { status: 500 }
    )
  }
}
