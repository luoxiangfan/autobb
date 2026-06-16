import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  findGoogleAdsAccountById,
  updateGoogleAdsAccount,
  deleteGoogleAdsAccount,
} from '@/lib/google-ads/accounts/accounts'
import {
  listDeletableRemoteCampaignsForAccount,
  countDeletableRemoteCampaignsForAccount,
  limitDeletableRemoteCampaigns,
} from '@/lib/google-ads/account-delete'
import { getGoogleAdsAccountDeleteRemoteConfig } from '@/lib/google-ads/account-delete'
import { executeGoogleAdsCampaignRemoteActions } from '@/lib/google-ads/campaign/remote-actions'
import { parseDeleteGoogleAdsAccountRequest } from '@/lib/google-ads/account-delete'
import { buildDeleteAccountApiWarnings } from '@/lib/google-ads/account-delete'
import { parseTruthyFlag } from '@/lib/common/server'
import type { GoogleAdsCampaignRemoteActionSummary } from '@/lib/google-ads/campaign/remote-actions'

function emptyGoogleAdsRemoteSummary(): GoogleAdsCampaignRemoteActionSummary {
  const config = getGoogleAdsAccountDeleteRemoteConfig()
  return {
    planned: 0,
    attempted: 0,
    paused: 0,
    removed: 0,
    pausedFallback: 0,
    failed: 0,
    action: 'NONE',
    executed: false,
    failures: [],
    truncated: 0,
    maxCampaigns: config.maxCampaigns,
    timedOut: false,
    concurrency: config.concurrency,
  }
}

/**
 * GET /api/google-ads-accounts/:id
 * 获取单个Google Ads账号详情
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const { id } = params

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const accountId = parseInt(id, 10)
    const numericUserId = userId
    const account = await findGoogleAdsAccountById(accountId, numericUserId)

    if (!account) {
      return NextResponse.json(
        {
          error: '账号不存在或无权访问',
        },
        { status: 404 }
      )
    }

    const includeDeletableCampaignCount = parseTruthyFlag(
      request.nextUrl.searchParams.get('deletableCampaignCount')
    )

    if (!includeDeletableCampaignCount) {
      return NextResponse.json({
        success: true,
        account,
      })
    }

    const remoteConfig = getGoogleAdsAccountDeleteRemoteConfig()
    const totalCount = await countDeletableRemoteCampaignsForAccount(accountId, numericUserId)

    return NextResponse.json({
      success: true,
      account,
      deletableRemoteCampaignCount: totalCount,
      remoteDeleteMaxCampaigns: remoteConfig.maxCampaigns,
      remoteDeleteWillTruncate: totalCount > remoteConfig.maxCampaigns,
    })
  } catch (error: any) {
    console.error('获取Google Ads账号详情失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取账号详情失败',
      },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/google-ads-accounts/:id
 * 更新Google Ads账号
 */
export async function PUT(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const { id } = params

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const body = await request.json()
    const {
      accountName,
      currency,
      timezone,
      isActive,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      lastSyncAt,
    } = body

    // 验证账号存在且属于当前用户
    const existingAccount = await findGoogleAdsAccountById(parseInt(id, 10), userId)

    if (!existingAccount) {
      return NextResponse.json(
        {
          error: '账号不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 准备更新数据
    const updates: any = {}
    if (accountName !== undefined) updates.accountName = accountName
    if (currency !== undefined) updates.currency = currency
    if (timezone !== undefined) updates.timezone = timezone
    if (isActive !== undefined) updates.isActive = isActive
    if (accessToken !== undefined) updates.accessToken = accessToken
    if (refreshToken !== undefined) updates.refreshToken = refreshToken
    if (tokenExpiresAt !== undefined) updates.tokenExpiresAt = tokenExpiresAt
    if (lastSyncAt !== undefined) updates.lastSyncAt = lastSyncAt

    // 更新账号
    const updatedAccount = await updateGoogleAdsAccount(parseInt(id, 10), userId, updates)

    return NextResponse.json({
      success: true,
      account: updatedAccount,
    })
  } catch (error: any) {
    console.error('更新Google Ads账号失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新账号失败',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/google-ads-accounts/:id
 * 删除Google Ads账号
 *
 * 可选参数 removeGoogleAdsCampaigns（query 或 JSON body，body 可无 Content-Type）：
 * 为 true 时，同步 best-effort 在 Google Ads 远端删除该账号下已同步的 Campaign，并在响应中返回结果
 */
export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const { id } = params

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const accountId = parseInt(id, 10)
    const numericUserId = userId
    if (!Number.isFinite(accountId) || !Number.isFinite(numericUserId)) {
      return NextResponse.json({ error: '无效的账号或用户 ID' }, { status: 400 })
    }

    const { removeGoogleAdsCampaigns: shouldRemoveGoogleAdsCampaigns } =
      await parseDeleteGoogleAdsAccountRequest(request)

    // 验证账号存在且属于当前用户
    const existingAccount = await findGoogleAdsAccountById(accountId, numericUserId)

    if (!existingAccount) {
      return NextResponse.json(
        {
          error: '账号不存在或无权访问',
        },
        { status: 404 }
      )
    }

    const remoteConfig = getGoogleAdsAccountDeleteRemoteConfig()
    const allDeletableCampaigns = shouldRemoveGoogleAdsCampaigns
      ? await listDeletableRemoteCampaignsForAccount(accountId, numericUserId)
      : []
    const {
      selected: campaignsToRemove,
      truncated,
      maxCampaigns,
    } = limitDeletableRemoteCampaigns(allDeletableCampaigns, remoteConfig.maxCampaigns)

    const adsAccountSnapshot = {
      id: existingAccount.id,
      customer_id: existingAccount.customerId,
      parent_mcc_id: existingAccount.parentMccId ?? null,
      service_account_id: existingAccount.serviceAccountId ?? null,
      is_active: existingAccount.isActive ? 1 : 0,
      is_deleted: 0,
    }

    // 先执行远端删除（使用删除前快照），再删本地，避免本地已删但远端仍投放
    const googleAdsRemote = shouldRemoveGoogleAdsCampaigns
      ? await executeGoogleAdsCampaignRemoteActions({
          userId: numericUserId,
          adsAccount: adsAccountSnapshot,
          campaigns: campaignsToRemove.map((campaign) => ({
            google_campaign_id: String(campaign.google_campaign_id),
          })),
          shouldRemove: true,
          logPrefix: 'delete-account',
          skipAccountEligibilityCheck: true,
          limitMeta: { truncated, maxCampaigns },
          remoteConfig,
        })
      : emptyGoogleAdsRemoteSummary()

    const deleted = await deleteGoogleAdsAccount(accountId, numericUserId)
    if (!deleted) {
      return NextResponse.json(
        {
          error: '删除账号失败',
          data: {
            accountId,
            localDeleted: false,
            googleAds: googleAdsRemote,
            warnings: buildDeleteAccountApiWarnings(
              shouldRemoveGoogleAdsCampaigns,
              googleAdsRemote,
              {
                localDeleted: false,
              }
            ),
          },
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: '账号删除成功',
      data: {
        accountId,
        localDeleted: true,
        googleAds: googleAdsRemote,
        warnings: buildDeleteAccountApiWarnings(shouldRemoveGoogleAdsCampaigns, googleAdsRemote, {
          localDeleted: true,
        }),
      },
    })
  } catch (error: any) {
    console.error('删除Google Ads账号失败:', error)

    return NextResponse.json(
      {
        error: error.message || '删除账号失败',
      },
      { status: 500 }
    )
  }
}
