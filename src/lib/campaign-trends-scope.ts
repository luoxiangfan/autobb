import type { DatabaseAdapter } from '@/lib/db'
import { matchesCampaignSearch } from '@/lib/campaign-search'
import { getAffiliateDomainKeywords } from '@/lib/affiliate-platform-domain-keywords'
import { buildCampaignAffiliateAlignedWhereClause } from '@/lib/campaign-affiliate-scope'

export type CampaignTrendsScopeAuth = {
  userId: number
  role: string
}

export function resolveEffectiveUserIdsForCampaignScope(params: {
  authUserId: number
  isAdmin: boolean
  requestedUserIds: number[]
  userIdFilterParam: string | null
  userIdFilter: number | null
}): number[] | null {
  const { authUserId, isAdmin, requestedUserIds, userIdFilterParam, userIdFilter } = params
  if (!isAdmin) return [authUserId]
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
}

export function buildUserScopeClause(column: string, effectiveUserIds: number[] | null): string {
  return effectiveUserIds !== null
    ? `${column} IN (${effectiveUserIds.map(() => '?').join(',')})`
    : '1=1'
}

type CampaignRowForScope = {
  id: number
  status: string | null
  status_category: string | null
  offer_needs_completion: unknown
  is_deleted: unknown
  campaign_name: string | null
  custom_name: string | null
  campaign_id: string | null
  ads_account_name: string | null
  ads_account_customer_id: string | null
  google_ads_account_id: string | number | null
}

function isCampaignRemovedOrDeleted(campaign: { is_deleted?: unknown }): boolean {
  const deletedFlag = campaign?.is_deleted === true || campaign?.is_deleted === 1
  return deletedFlag
}

export async function queryCampaignRowsForTrendsScope(
  db: DatabaseAdapter,
  params: {
    effectiveUserIds: number[] | null
    affiliateDomainKeywords: string[]
    createdAtStartParam: string | null
    createdAtEndParam: string | null
  }
): Promise<CampaignRowForScope[]> {
  const { effectiveUserIds, affiliateDomainKeywords, createdAtStartParam, createdAtEndParam } =
    params
  const userScopeClause = buildUserScopeClause('c.user_id', effectiveUserIds)
  const userScopeValues = effectiveUserIds ?? []
  const hasAffiliate = affiliateDomainKeywords.length > 0
  const affiliateClause = hasAffiliate
    ? `AND (${affiliateDomainKeywords.map(() => `o.affiliate_link LIKE ?`).join(' OR ')})`
    : ''
  const affiliateAlignedClause = hasAffiliate
    ? buildCampaignAffiliateAlignedWhereClause('c', 'o')
    : ''
  const affiliateBinds = hasAffiliate ? affiliateDomainKeywords.map((k) => `%${k}%`) : []

  const rows = (await db.query(
    `
        SELECT
          c.id,
          c.status,
          c.status_category,
          c.campaign_id,
          c.campaign_name,
          c.custom_name,
          c.google_ads_account_id,
          c.is_deleted,
          gaa.account_name as ads_account_name,
          gaa.customer_id as ads_account_customer_id,
          o.needs_completion as offer_needs_completion
        FROM campaigns c
        LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
        LEFT JOIN offers o ON c.offer_id = o.id
        WHERE ${userScopeClause}
        ${affiliateClause}
        ${affiliateAlignedClause}
        ${createdAtStartParam ? `AND c.created_at >= ?` : ''}
        ${createdAtEndParam ? `AND c.created_at <= ?` : ''}
        ORDER BY c.created_at DESC
      `,
    [
      ...userScopeValues,
      ...affiliateBinds,
      ...(createdAtStartParam ? [createdAtStartParam] : []),
      ...(createdAtEndParam ? [createdAtEndParam] : []),
    ]
  )) as CampaignRowForScope[]

  return Array.isArray(rows) ? rows : []
}

export function filterCampaignRowIdsForTrendsScope(
  rows: CampaignRowForScope[],
  filters: {
    searchQuery: string
    statusFilter: string
    needsOfferCompletionFilter: string
    statusCategoryFilter: string
    showDeletedParam: boolean | null
    idsFilter: number[]
  }
): number[] {
  const {
    searchQuery,
    statusFilter,
    needsOfferCompletionFilter,
    statusCategoryFilter,
    showDeletedParam,
    idsFilter,
  } = filters

  let list = rows

  if (idsFilter.length > 0) {
    const idsSet = new Set(idsFilter)
    list = list.filter((row) => idsSet.has(Number(row.id)))
  }

  if (showDeletedParam === false) {
    list = list.filter((row) => !isCampaignRemovedOrDeleted(row))
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase()
    list = list.filter((row) =>
      matchesCampaignSearch(q, {
        campaignName: row.campaign_name,
        customName: row.custom_name,
        campaignId: row.campaign_id,
        adsAccountName: row.ads_account_name,
        adsAccountCustomerId: row.ads_account_customer_id,
        googleAdsAccountId: row.google_ads_account_id,
      })
    )
  }

  if (statusFilter && statusFilter !== 'ALL') {
    list = list.filter((row) => String(row.status || '').toUpperCase() === statusFilter)
  }

  if (needsOfferCompletionFilter && needsOfferCompletionFilter !== 'ALL') {
    list = list.filter(
      (row) => String(row.offer_needs_completion || '').toUpperCase() === needsOfferCompletionFilter
    )
  }

  if (statusCategoryFilter && statusCategoryFilter !== 'all') {
    list = list.filter((row) => (row.status_category || 'pending') === statusCategoryFilter)
  }

  return list.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0)
}

export function parseAffiliateTrendsParam(affiliateFilterParam: string | null): {
  affiliateFilter: string | null
  affiliateDomainKeywords: string[]
} {
  if (!affiliateFilterParam) {
    return { affiliateFilter: null, affiliateDomainKeywords: [] }
  }
  try {
    const affiliateFilter = decodeURIComponent(affiliateFilterParam).trim() || null
    const affiliateDomainKeywords = affiliateFilter
      ? getAffiliateDomainKeywords(affiliateFilter)
      : []
    return { affiliateFilter, affiliateDomainKeywords }
  } catch {
    const affiliateFilter = affiliateFilterParam.trim() || null
    const affiliateDomainKeywords = affiliateFilter
      ? getAffiliateDomainKeywords(affiliateFilter)
      : []
    return { affiliateFilter, affiliateDomainKeywords }
  }
}
