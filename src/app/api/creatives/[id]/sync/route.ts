import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findAdCreativeById, updateAdCreative } from '@/lib/ad-creative'
import { findAdGroupById } from '@/lib/ad-groups'
import { findCampaignById } from '@/lib/campaigns'
import { findGoogleAdsAccountById } from '@/lib/google-ads-accounts'
import { createGoogleAdsResponsiveSearchAd } from '@/lib/google-ads-api'
import { prepareGoogleAdsApiCallForLinkedAccount, preparedAuthContextField } from '@/lib/google-ads-accounts-auth'
import { runWithLoginCustomerFallbackForAccount } from '@/lib/google-ads-login-customer'

/**
 * POST /api/creatives/:id/sync
 * 同步Creative到Google Ads (创建Responsive Search Ad)
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { id } = params

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const creative = await findAdCreativeById(parseInt(id, 10), userId)
    if (!creative) {
      return NextResponse.json(
        { error: 'Creative不存在或无权访问' },
        { status: 404 }
      )
    }

    if (creative.ad_id) {
      return NextResponse.json(
        { error: 'Creative已同步，不能重复同步' },
        { status: 400 }
      )
    }

    if (!creative.ad_group_id) {
      return NextResponse.json(
        { error: '请先将Creative关联到Ad Group' },
        { status: 400 }
      )
    }

    const adGroup = await findAdGroupById(creative.ad_group_id, userId)
    if (!adGroup) {
      return NextResponse.json(
        { error: 'Ad Group不存在' },
        { status: 404 }
      )
    }

    if (!adGroup.adGroupId) {
      return NextResponse.json(
        { error: 'Ad Group未同步到Google Ads，请先同步Ad Group' },
        { status: 400 }
      )
    }

    const campaign = await findCampaignById(adGroup.campaignId, userId)
    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign不存在' },
        { status: 404 }
      )
    }

    const googleAdsAccount = await findGoogleAdsAccountById(
      campaign.googleAdsAccountId,
      userId
    )

    if (!googleAdsAccount) {
      return NextResponse.json(
        { error: 'Google Ads账号不存在或无权访问' },
        { status: 404 }
      )
    }

    const prepared = await prepareGoogleAdsApiCallForLinkedAccount(
      userId,
      googleAdsAccount.serviceAccountId
    )
    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.message }, { status: 400 })
    }

    const { apiAuth, refreshToken, oauthCredentials, oauthLoginCustomerId } = prepared

    updateAdCreative(creative.id, userId, {
      creation_status: 'pending',
      creation_error: undefined,
    })

    try {
      const headlines = creative.headlines.slice(0, 15)
      if (headlines.length < 3) {
        throw new Error(`Responsive Search Ad需要至少3个标题，当前只有${headlines.length}个`)
      }

      const descriptions = creative.descriptions.slice(0, 4)
      if (descriptions.length < 2) {
        throw new Error(
          `Responsive Search Ad需要至少2个描述，当前只有${descriptions.length}个`
        )
      }

      const finalUrls = [creative.final_url]

      const adResult = await runWithLoginCustomerFallbackForAccount({
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
        actionName: '同步 Creative 到 Google Ads',
        callback: (loginCustomerId) =>
          createGoogleAdsResponsiveSearchAd({
            customerId: googleAdsAccount.customerId,
            refreshToken,
            adGroupId: adGroup.adGroupId!,
            headlines,
            descriptions,
            finalUrls,
            path1: creative.path_1 || undefined,
            path2: creative.path_2 || undefined,
            accountId: googleAdsAccount.id,
            userId,
            loginCustomerId,
            authType: apiAuth.authType,
            serviceAccountId: apiAuth.serviceAccountId,
            credentials: oauthCredentials,
            ...preparedAuthContextField(prepared),
          }),
      })

      updateAdCreative(creative.id, userId, {
        ad_id: adResult.adId,
        creation_status: 'synced',
        creation_error: undefined,
        last_sync_at: new Date().toISOString(),
      })

      return NextResponse.json({
        success: true,
        creative: {
          ...creative,
          adId: adResult.adId,
          creationStatus: 'synced',
        },
        adResourceName: adResult.resourceName,
      })
    } catch (error: any) {
      updateAdCreative(creative.id, userId, {
        creation_status: 'failed',
        creation_error: error.message || '同步到Google Ads失败',
      })

      throw error
    }
  } catch (error: any) {
    console.error('同步Creative失败:', error)

    return NextResponse.json(
      { error: error.message || '同步Creative失败' },
      { status: 500 }
    )
  }
}
