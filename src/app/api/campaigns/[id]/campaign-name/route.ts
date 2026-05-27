import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findCampaignById, updateCampaign } from '@/lib/campaigns'
import { getDatabase } from '@/lib/db'
import { updateGoogleAdsCampaignName } from '@/lib/google-ads-api'
import {
  getGoogleAdsAuthContext,
  hasConfiguredGoogleAdsAuthFromContext,
} from '@/lib/google-ads-auth-context'
import { prepareGoogleAdsAccountApiCall } from '@/lib/google-ads-accounts-auth'
import { runWithLoginCustomerFallbackForAccount } from '@/lib/google-ads-login-customer'
import { invalidateDashboardCache } from '@/lib/api-cache'

const MAX_CAMPAIGN_NAME_LENGTH = 255

function normalizeGoogleCampaignId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  return /^\d+$/.test(raw) ? raw : null
}

function normalizeCampaignName(value: unknown): string | null {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_CAMPAIGN_NAME_LENGTH) {
    return null
  }
  return trimmed
}

/**
 * PUT /api/campaigns/:id/campaign-name
 * 更新广告系列名称（本地 + 已发布时同步 Google Ads）
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const campaignId = Number(params.id)
    if (!Number.isFinite(campaignId)) {
      return NextResponse.json({ error: '无效的 campaignId' }, { status: 400 })
    }

    const body = await request.json().catch(() => null) as { campaignName?: string } | null
    const campaignName = normalizeCampaignName(body?.campaignName)

    if (!campaignName) {
      return NextResponse.json(
        { error: '系列名称不能为空，且长度不能超过 255 个字符' },
        { status: 400 }
      )
    }

    const existing = await findCampaignById(campaignId, userId)
    if (!existing) {
      return NextResponse.json({ error: '广告系列不存在或无权访问' }, { status: 404 })
    }

    if (existing.campaignName === campaignName) {
      return NextResponse.json({ success: true, campaign: existing, syncedToGoogleAds: false })
    }

    const db = await getDatabase()
    const campaignRow = await db.queryOne(
      `
        SELECT
          id,
          campaign_id,
          google_campaign_id,
          google_ads_account_id,
          status,
          is_deleted
        FROM campaigns
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
      [campaignId, userId]
    ) as
      | {
          id: number
          campaign_id: string | null
          google_campaign_id: string | null
          google_ads_account_id: number | null
          status: string | null
          is_deleted: unknown
        }
      | undefined

    if (!campaignRow) {
      return NextResponse.json({ error: '广告系列不存在或无权访问' }, { status: 404 })
    }

    const isDeleted = campaignRow.is_deleted === true || campaignRow.is_deleted === 1
    if (isDeleted || String(campaignRow.status || '').toUpperCase() === 'REMOVED') {
      return NextResponse.json(
        { error: '该广告系列已删除/移除，无法修改名称' },
        { status: 400 }
      )
    }

    const googleCampaignId =
      normalizeGoogleCampaignId(campaignRow.google_campaign_id) ||
      normalizeGoogleCampaignId(campaignRow.campaign_id)

    let syncedToGoogleAds = false

    if (googleCampaignId && campaignRow.google_ads_account_id) {
      const adsAccountRow = await db.queryOne(
        `
          SELECT
            id,
            customer_id,
            parent_mcc_id,
            service_account_id,
            is_active,
            is_deleted,
            status
          FROM google_ads_accounts
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `,
        [campaignRow.google_ads_account_id, userId]
      ) as
        | {
            id: number
            customer_id: string
            parent_mcc_id: string | null
            service_account_id: string | null
            is_active: unknown
            is_deleted: unknown
            status: string | null
          }
        | undefined

      const isAccountActive = adsAccountRow?.is_active === true || adsAccountRow?.is_active === 1
      const isAccountDeleted = adsAccountRow?.is_deleted === true || adsAccountRow?.is_deleted === 1

      if (adsAccountRow && isAccountActive && !isAccountDeleted) {
        const accountStatus = String(adsAccountRow.status || 'UNKNOWN').toUpperCase()
        const isNotUsableStatus = [
          'CANCELED',
          'CANCELLED',
          'CLOSED',
          'SUSPENDED',
          'PAUSED',
          'DISABLED',
        ].includes(accountStatus)

        if (isNotUsableStatus) {
          return NextResponse.json(
            {
              error: `该 Google Ads 账号状态为 ${accountStatus}，无法同步系列名称`,
            },
            { status: 422 }
          )
        }

        const authContext = await getGoogleAdsAuthContext(userId)
        if (!hasConfiguredGoogleAdsAuthFromContext(authContext)) {
          return NextResponse.json(
            { error: 'Google Ads 认证未配置或已失效，请在设置中完成配置' },
            { status: 400 }
          )
        }

        const prepared = await prepareGoogleAdsAccountApiCall({
          authContext,
          linkedServiceAccountId: adsAccountRow.service_account_id,
        })
        if (!prepared.ok) {
          return NextResponse.json({ error: prepared.message }, { status: 400 })
        }

        const { apiAuth, refreshToken, oauthCredentials, oauthLoginCustomerId } = prepared

        await runWithLoginCustomerFallbackForAccount({
          adsAccount: {
            customer_id: adsAccountRow.customer_id,
            parent_mcc_id: adsAccountRow.parent_mcc_id,
            id: adsAccountRow.id,
          },
          refreshToken,
          authType: apiAuth.authType,
          serviceAccountId: apiAuth.serviceAccountId,
          serviceAccountMccId: apiAuth.serviceAccountMccId,
          oauthLoginCustomerId: oauthLoginCustomerId ?? apiAuth.oauthLoginCustomerId,
          actionName: '更新广告系列名称',
          callback: (loginCustomerId) =>
            updateGoogleAdsCampaignName({
              customerId: adsAccountRow.customer_id,
              refreshToken,
              campaignId: googleCampaignId,
              name: campaignName,
              accountId: adsAccountRow.id,
              userId,
              loginCustomerId,
              authType: apiAuth.authType,
              serviceAccountId: apiAuth.serviceAccountId,
              credentials: oauthCredentials,
              accountParentMccId: adsAccountRow.parent_mcc_id,
              oauthLoginCustomerIdHint: oauthLoginCustomerId ?? apiAuth.oauthLoginCustomerId,
            }),
        })
        syncedToGoogleAds = true
      }
    }

    const campaign = await updateCampaign(campaignId, userId, { campaignName })
    if (!campaign) {
      return NextResponse.json({ error: '广告系列不存在或无权访问' }, { status: 404 })
    }

    invalidateDashboardCache(userId)

    return NextResponse.json({
      success: true,
      campaign,
      syncedToGoogleAds,
    })
  } catch (error: unknown) {
    console.error('更新广告系列名称失败:', error)
    const message = error instanceof Error ? error.message : '更新广告系列名称失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
