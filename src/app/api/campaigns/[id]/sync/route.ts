import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findCampaignById, updateCampaign } from '@/lib/campaign/server'
import { findGoogleAdsAccountById } from '@/lib/google-ads/accounts/accounts'
import { createGoogleAdsCampaign } from '@/lib/google-ads/api/api'
import {
  prepareGoogleAdsApiCallForLinkedAccount,
  preparedAuthContextField,
} from '@/lib/google-ads/accounts/auth/index'
import { runWithLoginCustomerFallbackForAccount } from '@/lib/google-ads/oauth/login-customer'
import { invalidateOfferCache } from '@/lib/common/server'

/**
 * POST /api/campaigns/:id/sync
 * 同步广告系列到Google Ads
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const { id } = params

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const campaign = await findCampaignById(parseInt(id, 10), userId)
    if (!campaign) {
      return NextResponse.json({ error: '广告系列不存在或无权访问' }, { status: 404 })
    }

    if (campaign.campaignId) {
      return NextResponse.json({ error: '广告系列已同步，不能重复同步' }, { status: 400 })
    }

    const googleAdsAccount = await findGoogleAdsAccountById(campaign.googleAdsAccountId, userId)

    if (!googleAdsAccount) {
      return NextResponse.json({ error: 'Google Ads账号不存在或无权访问' }, { status: 404 })
    }

    const prepared = await prepareGoogleAdsApiCallForLinkedAccount(
      userId,
      googleAdsAccount.serviceAccountId
    )
    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.message }, { status: 400 })
    }

    const { apiAuth, refreshToken, oauthCredentials, oauthLoginCustomerId } = prepared

    await updateCampaign(campaign.id, userId, {
      creationStatus: 'pending',
      creationError: null,
    })

    try {
      const result = await runWithLoginCustomerFallbackForAccount({
        adsAccount: {
          customer_id: googleAdsAccount.customerId,
          parent_mcc_id: googleAdsAccount.parentMccId,
          id: googleAdsAccount.id,
        },
        refreshToken,
        authType: apiAuth.authType,
        serviceAccountId: apiAuth.serviceAccountId,
        serviceAccountMccId: apiAuth.serviceAccountMccId,
        oauthLoginCustomerId: oauthLoginCustomerId ?? apiAuth.oauthLoginCustomerId,
        actionName: '同步广告系列到 Google Ads',
        callback: (loginCustomerId) =>
          createGoogleAdsCampaign({
            customerId: googleAdsAccount.customerId,
            refreshToken,
            campaignName: campaign.campaignName,
            budgetAmount: campaign.budgetAmount,
            budgetType: campaign.budgetType as 'DAILY' | 'TOTAL',
            status: campaign.status as 'ENABLED' | 'PAUSED',
            startDate: campaign.startDate || undefined,
            endDate: campaign.endDate || undefined,
            accountId: googleAdsAccount.id,
            userId,
            loginCustomerId,
            authType: apiAuth.authType,
            serviceAccountId: apiAuth.serviceAccountId,
            credentials: oauthCredentials,
            ...preparedAuthContextField(prepared),
          }),
      })

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
      await updateCampaign(campaign.id, userId, {
        creationStatus: 'failed',
        creationError: error.message || '同步到Google Ads失败',
      })
      invalidateOfferCache(userId, campaign.offerId)

      throw error
    }
  } catch (error: any) {
    console.error('同步广告系列失败:', error)

    return NextResponse.json({ error: error.message || '同步广告系列失败' }, { status: 500 })
  }
}
