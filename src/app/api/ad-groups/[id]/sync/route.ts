import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findAdGroupById, updateAdGroup } from '@/lib/ad-groups'
import { findCampaignById } from '@/lib/campaigns'
import { findGoogleAdsAccountById } from '@/lib/google-ads-accounts'
import { findKeywordsByAdGroupId, updateKeyword } from '@/lib/keywords'
import { createGoogleAdsAdGroup, createGoogleAdsKeywordsBatch } from '@/lib/google-ads-api'
import { prepareGoogleAdsAccountApiCall } from '@/lib/google-ads-accounts-auth'
import {
  googleAdsApiAuthValidationErrorMessage,
  resolveGoogleAdsApiAuthForAccount,
} from '@/lib/google-ads-auth-context'
import { runWithLoginCustomerFallbackForAccount } from '@/lib/google-ads-login-customer'

/**
 * POST /api/ad-groups/:id/sync
 * 同步Ad Group和Keywords到Google Ads
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    // 查找Ad Group
    const adGroup = await findAdGroupById(parseInt(id, 10), userId)
    if (!adGroup) {
      return NextResponse.json(
        {
          error: 'Ad Group不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 检查是否已经同步
    if (adGroup.adGroupId) {
      return NextResponse.json(
        {
          error: 'Ad Group已同步，不能重复同步',
        },
        { status: 400 }
      )
    }

    // 查找Campaign
    const campaign = await findCampaignById(adGroup.campaignId, userId)
    if (!campaign) {
      return NextResponse.json(
        {
          error: 'Campaign不存在',
        },
        { status: 404 }
      )
    }

    // 验证Campaign已同步
    if (!campaign.campaignId) {
      return NextResponse.json(
        {
          error: 'Campaign未同步到Google Ads，请先同步Campaign',
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
    const prepared = await prepareGoogleAdsAccountApiCall({
      authContext: authResolved.ctx,
      linkedServiceAccountId: googleAdsAccount.serviceAccountId,
    })
    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.message }, { status: 400 })
    }

    const { apiAuth, refreshToken, oauthCredentials, oauthLoginCustomerId } = prepared

    // 更新状态为pending
    await updateAdGroup(adGroup.id, userId, {
      creationStatus: 'pending',
      creationError: null,
    })

    try {
      const adGroupResult = await runWithLoginCustomerFallbackForAccount({
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
        actionName: '同步 Ad Group 到 Google Ads',
        callback: async (loginCustomerId) => {
          const created = await createGoogleAdsAdGroup({
            customerId: googleAdsAccount.customerId,
            refreshToken,
            campaignId: campaign.campaignId!,
            adGroupName: adGroup.adGroupName,
            cpcBidMicros: adGroup.cpcBidMicros || undefined,
            status: adGroup.status as 'ENABLED' | 'PAUSED',
            accountId: googleAdsAccount.id,
            userId,
            loginCustomerId,
            authType: apiAuth.authType,
            serviceAccountId: apiAuth.serviceAccountId,
            credentials: oauthCredentials,
          })

          const keywords = await findKeywordsByAdGroupId(adGroup.id, userId)
          let keywordResults: Awaited<ReturnType<typeof createGoogleAdsKeywordsBatch>> = []
          if (keywords.length > 0) {
            const keywordsBatch = keywords.map((kw) => ({
              keywordText: kw.keywordText,
              matchType: kw.matchType as 'BROAD' | 'PHRASE' | 'EXACT',
              negativeKeywordMatchType: kw.isNegative
                ? (kw.matchType as 'BROAD' | 'PHRASE' | 'EXACT')
                : undefined,
              status: kw.status as 'ENABLED' | 'PAUSED',
              finalUrl: kw.finalUrl || undefined,
              isNegative: kw.isNegative,
            }))

            keywordResults = await createGoogleAdsKeywordsBatch({
              customerId: googleAdsAccount.customerId,
              refreshToken,
              adGroupId: created.adGroupId,
              keywords: keywordsBatch,
              accountId: googleAdsAccount.id,
              userId,
              loginCustomerId,
              authType: apiAuth.authType,
              serviceAccountId: apiAuth.serviceAccountId,
              credentials: oauthCredentials,
            })
          }

          return { created, keywordResults }
        },
      })

      const { created: adGroupCreated, keywordResults } = adGroupResult

      await updateAdGroup(adGroup.id, userId, {
        adGroupId: adGroupCreated.adGroupId,
        creationStatus: 'synced',
        creationError: null,
        lastSyncAt: new Date().toISOString(),
      })

      const keywords = await findKeywordsByAdGroupId(adGroup.id, userId)

      let syncedKeywordsCount = 0

      if (keywords.length > 0) {
        for (let i = 0; i < keywordResults.length; i++) {
          const keywordResult = keywordResults[i]
          const keyword = keywords[i]

          await updateKeyword(keyword.id, userId, {
            keywordId: keywordResult.keywordId,
            creationStatus: 'synced',
            lastSyncAt: new Date().toISOString(),
          })

          syncedKeywordsCount++
        }
      }

      return NextResponse.json({
        success: true,
        adGroup: {
          ...adGroup,
          adGroupId: adGroupCreated.adGroupId,
          creationStatus: 'synced',
        },
        syncedKeywordsCount,
      })
    } catch (error: any) {
      // 同步失败，更新错误状态
      await updateAdGroup(adGroup.id, userId, {
        creationStatus: 'failed',
        creationError: error.message || '同步到Google Ads失败',
      })

      throw error
    }
  } catch (error: any) {
    console.error('同步Ad Group失败:', error)

    return NextResponse.json(
      {
        error: error.message || '同步Ad Group失败',
      },
      { status: 500 }
    )
  }
}
