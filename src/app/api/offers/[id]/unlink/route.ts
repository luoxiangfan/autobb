import { NextRequest, NextResponse } from 'next/server'
import { unlinkOfferFromAccount } from '@/lib/offers'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getGoogleAdsCredentials, getUserAuthType } from '@/lib/google-ads-oauth'
import { removeGoogleAdsCampaign, updateGoogleAdsCampaignStatus } from '@/lib/google-ads-api'

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
    const shouldRemoveGoogleAdsCampaigns = Boolean(removeGoogleAdsCampaigns)

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

    // 若账号不可用/缺少customer_id，则只能做本地解除关联
    const accountIsActive = adsAccount ? (adsAccount.is_active === true || adsAccount.is_active === 1) : false
    const accountIsDeleted = adsAccount ? (adsAccount.is_deleted === true || adsAccount.is_deleted === 1) : false

    // 先执行本地解除关联（核心业务动作），避免等待外部 Google Ads API 导致前端超时/取消请求（499）
    const result = await unlinkOfferFromAccount(offerId, googleAdsAccountId, userId)

    const shouldAttemptGoogleAds = Boolean(
      adsAccount?.customer_id &&
      accountIsActive &&
      !accountIsDeleted &&
      campaignsToUnlink.length > 0
    )

    if (shouldAttemptGoogleAds) {
      // 异步 best-effort：尽量在 Google Ads 端暂停已同步的 Campaign
      // 不阻塞当前 API 响应，避免 499（client closed request）
      void (async () => {
        const googleAdsRemoval = {
          attempted: 0,
          paused: 0,
          removed: 0,
          pausedFallback: 0,
          failed: 0,
          action: shouldRemoveGoogleAdsCampaigns ? 'REMOVE' : 'PAUSE',
          failures: [] as Array<{ campaignId: string; reason: string }>
        }

        try {
          const auth = await getUserAuthType(userId)
          const credentials = await getGoogleAdsCredentials(userId)
          const refreshToken = credentials?.refresh_token || ''

          let loginCustomerId: string | undefined = credentials?.login_customer_id
            ? String(credentials.login_customer_id)
            : undefined
          if (!loginCustomerId && adsAccount!.parent_mcc_id) {
            loginCustomerId = String(adsAccount!.parent_mcc_id)
          }

          for (const campaign of campaignsToUnlink) {
            const googleCampaignId = String(campaign.google_campaign_id)
            googleAdsRemoval.attempted++
            try {
              if (shouldRemoveGoogleAdsCampaigns) {
                await removeGoogleAdsCampaign({
                  customerId: adsAccount!.customer_id!,
                  refreshToken,
                  campaignId: googleCampaignId,
                  accountId: adsAccount!.id,
                  userId,
                  loginCustomerId,
                  authType: auth.authType,
                  serviceAccountId: auth.serviceAccountId
                })
                googleAdsRemoval.removed++
              } else {
                await updateGoogleAdsCampaignStatus({
                  customerId: adsAccount!.customer_id!,
                  refreshToken,
                  campaignId: googleCampaignId,
                  status: 'PAUSED',
                  accountId: adsAccount!.id,
                  userId,
                  loginCustomerId,
                  authType: auth.authType,
                  serviceAccountId: auth.serviceAccountId
                })
                googleAdsRemoval.paused++
              }
            } catch (err: any) {
              if (shouldRemoveGoogleAdsCampaigns) {
                try {
                  await updateGoogleAdsCampaignStatus({
                    customerId: adsAccount!.customer_id!,
                    refreshToken,
                    campaignId: googleCampaignId,
                    status: 'PAUSED',
                    accountId: adsAccount!.id,
                    userId,
                    loginCustomerId,
                    authType: auth.authType,
                    serviceAccountId: auth.serviceAccountId
                  })
                  googleAdsRemoval.pausedFallback++
                } catch (pauseErr: any) {
                  googleAdsRemoval.failed++
                  googleAdsRemoval.failures.push({
                    campaignId: googleCampaignId,
                    reason: String(pauseErr?.message || err?.message || 'UNKNOWN_ERROR')
                  })
                }
              } else {
                googleAdsRemoval.failed++
                googleAdsRemoval.failures.push({
                  campaignId: googleCampaignId,
                  reason: String(err?.message || 'UNKNOWN_ERROR')
                })
              }
            }
          }
        } catch (err: any) {
          console.error('[unlink] Google Ads best-effort removal failed:', err?.message || err)
        } finally {
          console.log('[unlink] Google Ads best-effort pause summary:', googleAdsRemoval)
        }
      })()
    }

    return NextResponse.json({
      success: true,
      message: '成功解除关联',
      data: {
        offerId,
        accountId: googleAdsAccountId,
        unlinkedCampaigns: result.unlinkedCount,
        googleAds: {
          queued: shouldAttemptGoogleAds,
          planned: campaignsToUnlink.length,
          action: shouldRemoveGoogleAdsCampaigns ? 'REMOVE' : 'PAUSE'
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
