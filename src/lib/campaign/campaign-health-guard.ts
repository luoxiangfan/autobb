import { getDatabase, type DatabaseAdapter } from '@/lib/db'

export const ENABLED_CAMPAIGN_REQUIRED_MESSAGE =
  '当前 Offer 没有可用的已启用 Campaign，请先发布并启用至少一个 Campaign 后再开启任务'

export const ENABLED_CAMPAIGN_REQUIRED_SUGGESTION =
  '请前往 Campaign 页面确认该 Offer 至少有一个状态为 ENABLED 的 Campaign'

/**
 * 判断 Offer 是否至少有一个 ENABLED 且未删除的 Campaign
 */
export async function hasEnabledCampaignForOffer(params: {
  userId: number
  offerId: number
  db?: DatabaseAdapter
}): Promise<boolean> {
  const db = params.db || (await getDatabase())

  const row = await db.queryOne(
    `SELECT c.id
     FROM campaigns c
     WHERE c.user_id = ?
       AND c.offer_id = ?
       AND c.status = 'ENABLED'
       AND (c.is_deleted = false OR c.is_deleted IS NULL)
     ORDER BY c.updated_at DESC
     LIMIT 1`,
    [params.userId, params.offerId]
  )

  return Boolean((row as { id?: number })?.id)
}
