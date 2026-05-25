import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findCampaignById, updateCampaign } from '@/lib/campaigns'
import { findGoogleAdsAccountById } from '@/lib/google-ads-accounts'
import { createGoogleAdsCampaign } from '@/lib/google-ads-api'
import {
  googleAdsApiAuthValidationErrorMessage,
  resolveGoogleAdsApiAuthForAccount,
} from '@/lib/google-ads-auth-context'
import { invalidateOfferCache } from '@/lib/api-cache'

/**
 * POST /api/campaigns/:id/sync
 * 同步广告系列到Google Ads
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    // 查找Campaign
    const campaign = await findCampaignById(parseInt(id, 10), userId)
    if (!campaign) {
      return NextResponse.json(
        {
          error: '广告系列不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 检查是否已经同步
    if (campaign.campaignId) {
      return NextResponse.json(
        {
          error: '广告系列已同步，不能重复同步',
        },
        { status: 400 }
      )
    }

    // 查找Google Ads账号
    const googleAdsAccount = await findGoogleAdsAccountById(
      campaign.googleAdsAccountId,
      userId
    )

    if (!googleAdsAccount) {
      return NextResponse.json(
        {
          error: 'Google Ads账号不存在或无权访问',
        },
        { status: 404 }
      )
    }

    const authResolved = await resolveGoogleAdsApiAuthForAccount(
      userId,
      googleAdsAccount.serviceAccountId
    )
    if (!authResolved.ok) {
      return NextResponse.json(
        { error: googleAdsApiAuthValidationErrorMessage(authResolved.reason) },
        { status: 400 }
      )
    }
    const { apiAuth } = authResolved

    // 更新状态为pending
    await updateCampaign(campaign.id, userId, {
      creationStatus: 'pending',
      creationError: null,
    })

    try {
      // 创建Google Ads广告系列
      const result = await createGoogleAdsCampaign({
        customerId: googleAdsAccount.customerId,
        refreshToken: googleAdsAccount.refreshToken || apiAuth.refreshToken,
        campaignName: campaign.campaignName,
        budgetAmount: campaign.budgetAmount,
        budgetType: campaign.budgetType as 'DAILY' | 'TOTAL',
        status: campaign.status as 'ENABLED' | 'PAUSED',
        startDate: campaign.startDate || undefined,
        endDate: campaign.endDate || undefined,
        accountId: googleAdsAccount.id,
        userId,
        authType: apiAuth.authType,
        serviceAccountId: apiAuth.serviceAccountId,
      })

      // 更新Campaign，标记为已同步
      const updatedCampaign = await updateCampaign(campaign.id, userId, {
        campaignId: result.campaignId,
        creationStatus: 'synced',
        creationError: null,
        lastSyncAt: new Date().toISOString(),
      })
      invalidateOfferCache(userId, campaign.offerId)

      return NextResponse.json({
        success: true,
        campaign: updatedCampaign,
        googleAdsCampaignId: result.campaignId,
      })
    } catch (error: any) {
      // 同步失败，更新错误状态
      await updateCampaign(campaign.id, userId, {
        creationStatus: 'failed',
        creationError: error.message || '同步到Google Ads失败',
      })
      invalidateOfferCache(userId, campaign.offerId)

      throw error
    }
  } catch (error: any) {
    console.error('同步广告系列失败:', error)

    return NextResponse.json(
      {
        error: error.message || '同步广告系列失败',
      },
      { status: 500 }
    )
  }
}
