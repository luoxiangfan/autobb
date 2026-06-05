import { getDatabase } from './db'

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
  const isDeletedFalse = db.type === 'postgres' ? 'FALSE' : '0'

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
