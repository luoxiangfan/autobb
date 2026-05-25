import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findAdCreativeById, updateAdCreative } from '@/lib/ad-creative'
import { findAdGroupById } from '@/lib/ad-groups'
import { findCampaignById } from '@/lib/campaigns'
import { findGoogleAdsAccountById } from '@/lib/google-ads-accounts'
import { createGoogleAdsResponsiveSearchAd } from '@/lib/google-ads-api'
import {
  googleAdsApiAuthValidationErrorMessage,
  resolveGoogleAdsApiAuthForAccount,
} from '@/lib/google-ads-auth-context'

/**
 * POST /api/creatives/:id/sync
 * 同步Creative到Google Ads (创建Responsive Search Ad)
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    // 查找Creative
    const creative = await findAdCreativeById(parseInt(id, 10), userId)
    if (!creative) {
      return NextResponse.json(
        {
          error: 'Creative不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 检查是否已经同步
    if (creative.ad_id) {
      return NextResponse.json(
        {
          error: 'Creative已同步，不能重复同步',
        },
        { status: 400 }
      )
    }

    // 检查是否已关联Ad Group
    if (!creative.ad_group_id) {
      return NextResponse.json(
        {
          error: '请先将Creative关联到Ad Group',
        },
        { status: 400 }
      )
    }

    // 查找Ad Group
    const adGroup = await findAdGroupById(creative.ad_group_id, userId)
    if (!adGroup) {
      return NextResponse.json(
        {
          error: 'Ad Group不存在',
        },
        { status: 404 }
      )
    }

    // 验证Ad Group已同步
    if (!adGroup.adGroupId) {
      return NextResponse.json(
        {
          error: 'Ad Group未同步到Google Ads，请先同步Ad Group',
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
    updateAdCreative(creative.id, userId, {
      creation_status: 'pending',
      creation_error: undefined,
    })

    try {
      // 准备Headlines (最多15个，最少3个)
      const headlines = creative.headlines.slice(0, 15)

      // 如果不足3个标题，返回错误
      if (headlines.length < 3) {
        throw new Error('Responsive Search Ad需要至少3个标题，当前只有' + headlines.length + '个')
      }

      // 准备Descriptions (最多4个，最少2个)
      const descriptions = creative.descriptions.slice(0, 4)

      // 如果不足2个描述，返回错误
      if (descriptions.length < 2) {
        throw new Error(
          'Responsive Search Ad需要至少2个描述，当前只有' + descriptions.length + '个'
        )
      }

      // 准备Final URLs
      const finalUrls = [creative.final_url]

      // 创建Google Ads Responsive Search Ad
      const adResult = await createGoogleAdsResponsiveSearchAd({
        customerId: googleAdsAccount.customerId,
        refreshToken: googleAdsAccount.refreshToken || apiAuth.refreshToken,
        adGroupId: adGroup.adGroupId,
        headlines,
        descriptions,
        finalUrls,
        path1: creative.path_1 || undefined,
        path2: creative.path_2 || undefined,
        accountId: googleAdsAccount.id,
        userId: userId,
        authType: apiAuth.authType,
        serviceAccountId: apiAuth.serviceAccountId,
      })

      // 更新Creative，标记为已同步
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
      // 同步失败，更新错误状态
      updateAdCreative(creative.id, userId, {
        creation_status: 'failed',
        creation_error: error.message || '同步到Google Ads失败',
      })

      throw error
    }
  } catch (error: any) {
    console.error('同步Creative失败:', error)

    return NextResponse.json(
      {
        error: error.message || '同步Creative失败',
      },
      { status: 500 }
    )
  }
}
