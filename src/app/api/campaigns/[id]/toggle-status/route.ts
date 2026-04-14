import { NextRequest, NextResponse } from 'next/server'

import { getDatabase } from '@/lib/db'
import { findCampaignById } from '@/lib/campaigns'
import { updateGoogleAdsCampaignStatus, getGoogleAdsCredentialsFromDB } from '@/lib/google-ads-api'
import { getServiceAccountConfig } from '@/lib/google-ads-service-account'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { applyCampaignTransition } from '@/lib/campaign-state-machine'
import { invalidateDashboardCache } from '@/lib/api-cache'
import { pauseOfferTasks } from '@/lib/campaign-offer-tasks'

type ToggleStatusBody = {
  status?: string
}

function normalizeGoogleCampaignId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  return /^\d+$/.test(raw) ? raw : null
}

/**
 * PUT /api/campaigns/:id/toggle-status
 * 用户手动暂停/启用广告系列（同时更新 Google Ads 和本地数据库）
 *
 * - :id 为本地 campaigns.id（不是 google_campaign_id）
 * - body: { status: 'PAUSED' | 'ENABLED' }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userIdHeader = request.headers.get('x-user-id')
    if (!userIdHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = Number(userIdHeader)
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const campaignId = Number(params.id)
    if (!Number.isFinite(campaignId)) {
      return NextResponse.json({ error: '无效的campaignId' }, { status: 400 })
    }

    const body = (await request.json().catch(() => null)) as ToggleStatusBody | null
    const nextStatus = String(body?.status || '').trim().toUpperCase()

    if (nextStatus !== 'PAUSED' && nextStatus !== 'ENABLED') {
      return NextResponse.json(
        { error: '无效的状态，只支持 PAUSED / ENABLED' },
        { status: 400 }
      )
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
          is_deleted: any
        }
      | undefined

    if (!campaignRow) {
      return NextResponse.json(
        { error: '广告系列不存在或无权访问' },
        { status: 404 }
      )
    }

    const isDeleted = campaignRow.is_deleted === true || campaignRow.is_deleted === 1
    if (isDeleted || String(campaignRow.status || '').toUpperCase() === 'REMOVED') {
      return NextResponse.json(
        { error: '该广告系列已删除/移除，无法暂停或启用' },
        { status: 400 }
      )
    }

    const googleCampaignId =
      normalizeGoogleCampaignId(campaignRow.google_campaign_id) ||
      normalizeGoogleCampaignId(campaignRow.campaign_id)

    if (!googleCampaignId) {
      return NextResponse.json(
        { error: '该广告系列尚未发布到Google Ads，无法暂停或启用' },
        { status: 400 }
      )
    }

    if (!campaignRow.google_ads_account_id) {
      return NextResponse.json(
        { error: '未找到关联的Ads账号，无法暂停或启用' },
        { status: 400 }
      )
    }

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
          is_active: any
          is_deleted: any
          status: string | null
        }
      | undefined

    const isAccountActive = adsAccountRow?.is_active === true || adsAccountRow?.is_active === 1
    const isAccountDeleted = adsAccountRow?.is_deleted === true || adsAccountRow?.is_deleted === 1

    if (!adsAccountRow || !isAccountActive || isAccountDeleted) {
      return NextResponse.json(
        { error: '关联的Ads账号不可用（可能已解除关联或停用），无法暂停/启用' },
        { status: 400 }
      )
    }

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
          action: 'ACCOUNT_STATUS_NOT_USABLE',
          message: `该 Google Ads 账号状态为 ${accountStatus}，无法执行暂停/启用操作。请先在 Google Ads 后台恢复账号状态或更换其他账号。`,
          details: { accountStatus },
        },
        { status: 422 }
      )
    }

    const linkedServiceAccountId =
      typeof adsAccountRow.service_account_id === 'string'
        ? adsAccountRow.service_account_id.trim()
        : ''
    const useServiceAccount = linkedServiceAccountId.length > 0

    let credentials: Awaited<ReturnType<typeof getGoogleAdsCredentialsFromDB>> | null = null

    let authType: 'oauth' | 'service_account' = 'oauth'
    let refreshToken = ''
    let serviceAccountId: string | undefined
    let serviceAccountMccId: string | undefined

    if (useServiceAccount) {
      authType = 'service_account'
      const config = await getServiceAccountConfig(userId, linkedServiceAccountId)
      if (!config) {
        return NextResponse.json(
          { error: '未找到服务账号配置' },
          { status: 400 }
        )
      }
      serviceAccountId = config.id
      serviceAccountMccId = config.mccCustomerId ? String(config.mccCustomerId) : undefined
    } else {
      // OAuth 路径才读取基础凭证，避免服务账号模式触发 OAuth 必填项校验
      try {
        credentials = await getGoogleAdsCredentialsFromDB(userId)
      } catch (e: any) {
        return NextResponse.json(
          { error: e?.message || 'Google Ads 凭证未配置或不可用' },
          { status: 400 }
        )
      }

      authType = 'oauth'
      const oauthCredentials = await getGoogleAdsCredentials(userId)
      refreshToken = oauthCredentials?.refresh_token || ''
      if (!refreshToken) {
        return NextResponse.json(
          { error: 'Google Ads OAuth未授权或已过期', needsReauth: true },
          { status: 400 }
        )
      }
    }

    let loginCustomerId: string | undefined
    if (authType === 'service_account') {
      loginCustomerId = serviceAccountMccId
    } else {
      loginCustomerId = credentials?.login_customer_id
        ? String(credentials.login_customer_id)
        : undefined
    }
    if (!loginCustomerId && adsAccountRow.parent_mcc_id) {
      loginCustomerId = String(adsAccountRow.parent_mcc_id)
    }

    // 先更新 Google Ads 状态
    await updateGoogleAdsCampaignStatus({
      customerId: adsAccountRow.customer_id,
      refreshToken,
      campaignId: googleCampaignId,
      status: nextStatus as 'PAUSED' | 'ENABLED',
      accountId: adsAccountRow.id,
      userId,
      loginCustomerId,
      authType,
      serviceAccountId,
    })

    // 再更新本地数据库状态
    await applyCampaignTransition({
      userId,
      campaignId,
      action: 'TOGGLE_STATUS',
      payload: { status: nextStatus as 'PAUSED' | 'ENABLED' },
    })

    // 如果是暂停操作，同时暂停关联 offer 的补点击和换链接任务
    if (nextStatus === 'PAUSED') {
      try {
        const campaignData = await db.queryOne<any>(`
          SELECT offer_id FROM campaigns WHERE id = ? AND user_id = ?
        `, [campaignId, userId])

        if (campaignData?.offer_id) {
          await pauseOfferTasks(
            campaignData.offer_id,
            userId,
            'campaign_paused',
            '广告系列已暂停，自动暂停任务'
          )
        }
      } catch (taskError: any) {
        // 任务暂停失败不影响主流程，仅记录日志
        console.error('[toggle-status] 暂停关联 offer 任务失败:', taskError)
      }
    }

    invalidateDashboardCache(userId)

    const updated = await findCampaignById(campaignId, userId)

    return NextResponse.json({
      success: true,
      status: nextStatus,
      campaign: updated,
    })
  } catch (error: any) {
    console.error('更新广告系列状态失败:', error)
    return NextResponse.json(
      { error: error?.message || '更新广告系列状态失败' },
      { status: 500 }
    )
  }
}
