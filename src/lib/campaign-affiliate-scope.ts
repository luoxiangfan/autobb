import { offerOccupyingCampaignFilterSql } from '@/lib/campaign-offer-constraint'

/** 与 affiliate-platforms 计数、performance/trends 联盟筛选共用的 Offer 未删除条件 */
function offerNotDeletedSql(offerAlias = 'o'): string {
  return `${offerAlias}.is_deleted = FALSE`
}

/**
 * Campaign 列表与联盟下拉计数对齐：占用槽位 + Offer 未删。
 * 用于 SQL WHERE（要求已 JOIN offers）。
 */
export function campaignAffiliateAlignedFilterSql(campaignAlias = 'c', offerAlias = 'o'): string {
  return [offerNotDeletedSql(offerAlias), offerOccupyingCampaignFilterSql(campaignAlias)].join(
    ' AND '
  )
}

export function buildCampaignAffiliateAlignedWhereClause(
  campaignAlias = 'c',
  offerAlias = 'o'
): string {
  return `AND ${campaignAffiliateAlignedFilterSql(campaignAlias, offerAlias)}`
}

type CampaignAffiliateScopeRow = {
  is_deleted?: unknown
  creation_status?: string | null
  status?: string | null
  offer_is_deleted?: unknown
}

/** 内存过滤：与 campaignAffiliateAlignedFilterSql 语义一致 */
export function isCampaignAffiliateAlignedRow(row: CampaignAffiliateScopeRow): boolean {
  const offerDeleted = row.offer_is_deleted === true || row.offer_is_deleted === 1
  if (offerDeleted) return false

  const campaignDeleted = row.is_deleted === true || row.is_deleted === 1
  if (campaignDeleted) return false

  if (String(row.creation_status || '').toLowerCase() === 'failed') return false

  if (String(row.status || '').toUpperCase() === 'REMOVED') return false

  return true
}
