import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { updateGoogleAdsCampaignBudget } from '@/lib/google-ads-api'
import { getGoogleAdsCredentials, getUserAuthType } from '@/lib/google-ads-oauth'
import { invalidateDashboardCache, invalidateOfferCache } from '@/lib/api-cache'
import {
  isGoogleAdsAccountAccessError,
  resolveLoginCustomerCandidates,
  resolveLoginCustomerId,
} from '@/lib/google-ads-login-customer'

function normalizeGoogleCampaignId(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  return /^\d+$/.test(text) ? text : null
}

function normalizeBudgetType(value: unknown): 'DAILY' | 'TOTAL' {
  const text = String(value || '').trim().toUpperCase()
  return text === 'TOTAL' ? 'TOTAL' : 'DAILY'
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * PUT /api/campaigns/:id/update-budget
 * 更新广告系列预算
 *
 * - :id 必须是 Google Ads campaign id（google_campaign_id）
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = auth.user.userId
    const campaignIdInPath = String(params.id || '').trim()
    const googleCampaignId = normalizeGoogleCampaignId(campaignIdInPath)
    if (!googleCampaignId) {
      return NextResponse.json({ error: '路由参数错误：:id 必须是 Google Campaign ID' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({})) as {
      budgetAmount?: number
      budgetType?: 'DAILY' | 'TOTAL'
    }
    const budgetAmount = Number(body?.budgetAmount)
    if (!Number.isFinite(budgetAmount) || budgetAmount <= 0) {
      return NextResponse.json({ error: '请提供有效的 budgetAmount（>0）' }, { status: 400 })
    }
    const normalizedBudgetAmount = roundTo2(budgetAmount)
    const budgetType = normalizeBudgetType(body?.budgetType)

    const db = await getDatabase()
    const linked = await db.queryOne(
      `
        SELECT
          c.id AS local_campaign_id,
          c.google_ads_account_id,
          c.offer_id,
          c.status,
          c.is_deleted,
          gaa.customer_id,
          gaa.parent_mcc_id,
          gaa.is_active AS account_is_active,
          gaa.is_deleted AS account_is_deleted
        FROM campaigns c
        LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
        WHERE c.user_id = ?
          AND c.status != 'REMOVED'
          AND c.google_campaign_id = ?
          AND c.google_ads_account_id IS NOT NULL
        ORDER BY c.created_at DESC
        LIMIT 1
      `,
      [userId, googleCampaignId]
    ) as
      | {
          local_campaign_id: number
          google_ads_account_id: number
          offer_id: number | null
          status: string | null
          is_deleted: any
          customer_id: string | null
          parent_mcc_id: string | null
          account_is_active: any
          account_is_deleted: any
        }
      | undefined

    if (!linked?.google_ads_account_id || !linked.customer_id) {
      // 语义校验：:id 不接受本地 campaign.id
      const localCampaignId = Number(campaignIdInPath)
      if (Number.isFinite(localCampaignId)) {
        const localCampaign = await db.queryOne(
          `
            SELECT id, campaign_id, google_campaign_id, status, is_deleted
            FROM campaigns
            WHERE user_id = ?
              AND id = ?
            LIMIT 1
          `,
          [userId, localCampaignId]
        ) as
          | {
              id: number
              campaign_id: string | null
              google_campaign_id: string | null
              status: string | null
              is_deleted: any
            }
          | undefined

        if (localCampaign) {
          const expectedGoogleCampaignId =
            normalizeGoogleCampaignId(localCampaign.google_campaign_id)
            || normalizeGoogleCampaignId(localCampaign.campaign_id)

          if (expectedGoogleCampaignId && expectedGoogleCampaignId !== campaignIdInPath) {
            return NextResponse.json(
              {
                error: `路由参数语义错误：update-budget 的 :id 必须是 googleCampaignId，收到本地 campaign.id=${localCampaignId}`,
                action: 'USE_GOOGLE_CAMPAIGN_ID',
                localCampaignId,
                googleCampaignId: expectedGoogleCampaignId,
                expectedPath: `/api/campaigns/${expectedGoogleCampaignId}/update-budget`,
              },
              { status: 422 }
            )
          }
        }
      }

      return NextResponse.json({ error: '未找到该广告系列对应的Ads账号或Customer ID' }, { status: 404 })
    }

    const accountIsActive = linked.account_is_active === true || linked.account_is_active === 1
    const accountIsDeleted = linked.account_is_deleted === true || linked.account_is_deleted === 1
    if (!accountIsActive || accountIsDeleted) {
      return NextResponse.json({ error: '关联的Ads账号不可用（已停用或已删除）' }, { status: 400 })
    }

    const { authType, serviceAccountId } = await getUserAuthType(userId)
    let refreshToken = ''
    let oauthLoginCustomerId: string | undefined
    if (authType === 'oauth') {
      const oauthCredentials = await getGoogleAdsCredentials(userId)
      if (!oauthCredentials?.refresh_token) {
        return NextResponse.json({ error: 'Google Ads OAuth refresh_token 不存在或已过期' }, { status: 400 })
      }
      refreshToken = oauthCredentials.refresh_token
      oauthLoginCustomerId = oauthCredentials.login_customer_id
    }

    const runUpdateBudget = async (loginCustomerId?: string) => {
      await updateGoogleAdsCampaignBudget({
        customerId: String(linked.customer_id),
        refreshToken,
        campaignId: googleCampaignId,
        budgetAmount: normalizedBudgetAmount,
        budgetType,
        accountId: Number(linked.google_ads_account_id),
        userId,
        loginCustomerId,
        authType,
        serviceAccountId,
      })
    }

    if (authType === 'oauth') {
      const loginCustomerIdCandidates = resolveLoginCustomerCandidates({
        authType: 'oauth',
        accountParentMccId: linked.parent_mcc_id,
        oauthLoginCustomerId,
        targetCustomerId: linked.customer_id,
      })

      let lastError: unknown = null
      for (let i = 0; i < loginCustomerIdCandidates.length; i += 1) {
        const loginCustomerId = loginCustomerIdCandidates[i]
        try {
          await runUpdateBudget(loginCustomerId)
          lastError = null
          break
        } catch (error) {
          lastError = error
          const hasNextCandidate = i < loginCustomerIdCandidates.length - 1
          if (hasNextCandidate && isGoogleAdsAccountAccessError(error)) {
            continue
          }
          throw error
        }
      }

      if (lastError) {
        throw lastError
      }
    } else {
      const loginCustomerId = resolveLoginCustomerId({
        authType,
        accountParentMccId: linked.parent_mcc_id,
      })
      await runUpdateBudget(loginCustomerId)
    }

    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    await db.exec(
      `
        UPDATE campaigns
        SET budget_amount = ?,
            budget_type = ?,
            updated_at = ${nowFunc}
        WHERE user_id = ?
          AND status != 'REMOVED'
          AND (google_campaign_id = ? OR campaign_id = ?)
      `,
      [normalizedBudgetAmount, budgetType, userId, googleCampaignId, googleCampaignId]
    )

    const offerId = Number(linked.offer_id)
    if (Number.isFinite(offerId) && offerId > 0) {
      invalidateOfferCache(userId, offerId)
    } else {
      invalidateDashboardCache(userId)
    }

    return NextResponse.json({
      success: true,
      googleCampaignId,
      budgetAmount: normalizedBudgetAmount,
      budgetType,
      message: '预算已更新',
    })
  } catch (error: any) {
    console.error('更新Campaign预算失败:', error)
    return NextResponse.json(
      { error: error?.message || '更新Campaign预算失败' },
      { status: 500 }
    )
  }
}
