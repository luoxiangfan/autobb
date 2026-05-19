import { NextRequest, NextResponse } from 'next/server'
import { unlinkOfferFromAccount } from '@/lib/offers'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { queueGoogleAdsCampaignRemoteActions } from '@/lib/google-ads-campaign-remote-actions'
import { parseTruthyFlag } from '@/lib/parse-truthy-flag'

/**
 * POST /api/offers/:id/unlink
 * 手动解除Offer与Ads账号的关联
 * 需求25: 增加Offer手动解除与已关联的Ads账号解除关联的功能
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 统一鉴权：避免仅依赖可伪造的 x-user-id
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    // 从请求体获取要解除关联的Ads账号ID
    const body = await request.json()
    const { accountId, removeGoogleAdsCampaigns } = body
    const shouldRemoveGoogleAdsCampaigns = parseTruthyFlag(removeGoogleAdsCampaigns)

    if (!accountId) {
      return NextResponse.json({ error: '缺少accountId参数' }, { status: 400 })
    }

    const offerId = parseInt(id, 10)
    const googleAdsAccountId = parseInt(accountId, 10)
    const db = await getDatabase()

    // 先读取该 Offer 在该账号下“已同步”的所有 Campaign（用于后续 best-effort 的 Google Ads 远端暂停）
    const campaignsToUnlink = await db.query(`
      SELECT id, google_campaign_id, campaign_name, status
      FROM campaigns
      WHERE offer_id = ?
        AND google_ads_account_id = ?
        AND user_id = ?
        AND status != 'REMOVED'
        AND google_campaign_id IS NOT NULL
        AND google_campaign_id != ''
    `, [offerId, googleAdsAccountId, userId]) as Array<{
      id: number
      google_campaign_id: string | null
      campaign_name: string | null
      status: string | null
    }>

    // 查询账号信息（用于 customer_id / login_customer_id）
    const adsAccount = await db.queryOne(`
      SELECT id, customer_id, parent_mcc_id, is_active, is_deleted
      FROM google_ads_accounts
      WHERE id = ? AND user_id = ?
    `, [googleAdsAccountId, userId]) as {
      id: number
      customer_id: string | null
      parent_mcc_id: string | null
      is_active: any
      is_deleted: any
    } | null

    // 先执行本地解除关联（核心业务动作），避免等待外部 Google Ads API 导致前端超时/取消请求（499）
    const result = await unlinkOfferFromAccount(offerId, googleAdsAccountId, userId)

    const googleAdsRemote = adsAccount
      ? queueGoogleAdsCampaignRemoteActions({
          userId,
          adsAccount,
          campaigns: campaignsToUnlink.map((campaign) => ({
            google_campaign_id: String(campaign.google_campaign_id),
          })),
          shouldRemove: shouldRemoveGoogleAdsCampaigns,
          logPrefix: 'unlink',
        })
      : { queued: false, planned: campaignsToUnlink.length, action: 'NONE' as const }

    return NextResponse.json({
      success: true,
      message: '成功解除关联',
      data: {
        offerId,
        accountId: googleAdsAccountId,
        unlinkedCampaigns: result.unlinkedCount,
        googleAds: {
          queued: googleAdsRemote.queued,
          planned: googleAdsRemote.planned,
          action: googleAdsRemote.action,
        }
      },
    })
  } catch (error: any) {
    console.error('解除关联失败:', error)

    return NextResponse.json(
      {
        error: error.message || '解除关联失败',
      },
      { status: 500 }
    )
  }
}
