import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { queryActiveCampaigns, pauseCampaigns } from '@/lib/active-campaigns-query'
import { recordOpenclawAction } from '@/lib/openclaw/action-logs'
import type { GoogleAdsCampaignInfo } from '@/lib/campaign-association'
import { applyCampaignTransitionByGoogleCampaignIds } from '@/lib/campaign-state-machine'
import { invalidateOfferCache } from '@/lib/api-cache'

export const dynamic = 'force-dynamic'

type CircuitBreakBody = {
  accountId?: number
  googleAdsAccountId?: number
  reason?: string
  source?: string
  dryRun?: boolean
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function dedupeEnabledCampaigns(campaigns: GoogleAdsCampaignInfo[]): GoogleAdsCampaignInfo[] {
  const map = new Map<string, GoogleAdsCampaignInfo>()
  for (const campaign of campaigns) {
    if (campaign.status !== 'ENABLED') continue
    const id = String(campaign.id || '').trim()
    if (!id) continue
    if (!map.has(id)) {
      map.set(id, campaign)
    }
  }
  return Array.from(map.values())
}

async function syncLocalCampaignStatus(params: {
  userId: number
  accountId: number
  campaigns: GoogleAdsCampaignInfo[]
}) {
  const googleCampaignIds = params.campaigns
    .map((campaign) => String(campaign.id || '').trim())
    .filter((id) => Boolean(id))

  if (googleCampaignIds.length === 0) {
    return { attempted: 0, updated: 0 }
  }

  const result = await applyCampaignTransitionByGoogleCampaignIds({
    userId: params.userId,
    googleAdsAccountId: params.accountId,
    googleCampaignIds,
    action: 'CIRCUIT_BREAK_PAUSE',
  })

  return {
    attempted: googleCampaignIds.length,
    updated: result.updatedCount,
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as CircuitBreakBody
    const userId = auth.user.userId
    const accountId = parsePositiveInteger(body.accountId ?? body.googleAdsAccountId)

    if (!accountId) {
      return NextResponse.json({ error: '缺少有效的 accountId' }, { status: 400 })
    }

    const reason = String(body.reason || 'manual_circuit_break').trim() || 'manual_circuit_break'
    const source = String(body.source || 'api').trim() || 'api'
    const dryRun = parseBoolean(body.dryRun, false)

    const snapshot = await queryActiveCampaigns(0, accountId, userId)
    const enabledCampaigns = dedupeEnabledCampaigns([
      ...snapshot.ownCampaigns,
      ...snapshot.manualCampaigns,
      ...snapshot.otherCampaigns,
    ])

    if (enabledCampaigns.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          accountId,
          reason,
          source,
          dryRun,
          summary: {
            enabledCampaigns: 0,
            ownCampaigns: snapshot.ownCampaigns.length,
            manualCampaigns: snapshot.manualCampaigns.length,
            otherCampaigns: snapshot.otherCampaigns.length,
          },
          result: {
            attemptedCount: 0,
            pausedCount: 0,
            failedCount: 0,
            failures: [],
          },
          localSync: { attempted: 0, updated: 0 },
        },
      })
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        data: {
          accountId,
          reason,
          source,
          dryRun: true,
          summary: {
            enabledCampaigns: enabledCampaigns.length,
            ownCampaigns: snapshot.ownCampaigns.length,
            manualCampaigns: snapshot.manualCampaigns.length,
            otherCampaigns: snapshot.otherCampaigns.length,
          },
          previewCampaigns: enabledCampaigns.map((campaign) => ({
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
          })),
        },
      })
    }

    const pauseResult = await pauseCampaigns(enabledCampaigns, accountId, userId)
    const localSync = await syncLocalCampaignStatus({
      userId,
      accountId,
      campaigns: enabledCampaigns,
    })
    invalidateOfferCache(userId)

    try {
      await recordOpenclawAction({
        userId,
        channel: 'api',
        action: 'POST /api/campaigns/circuit-break',
        targetType: 'ads-account',
        targetId: String(accountId),
        requestBody: JSON.stringify({ accountId, reason, source }),
        responseBody: JSON.stringify({
          attempted: pauseResult.attemptedCount,
          paused: pauseResult.pausedCount,
          failed: pauseResult.failedCount,
        }),
        status: pauseResult.failedCount > 0 ? 'error' : 'success',
        errorMessage: pauseResult.failedCount > 0
          ? pauseResult.failures.map((failure) => `${failure.id}:${failure.error}`).join('; ')
          : null,
      })
    } catch {
      // ignore audit log failure
    }

    return NextResponse.json({
      success: true,
      data: {
        accountId,
        reason,
        source,
        dryRun: false,
        summary: {
          enabledCampaigns: enabledCampaigns.length,
          ownCampaigns: snapshot.ownCampaigns.length,
          manualCampaigns: snapshot.manualCampaigns.length,
          otherCampaigns: snapshot.otherCampaigns.length,
        },
        result: pauseResult,
        localSync,
      },
    })
  } catch (error: any) {
    console.error('执行一键熔断失败:', error)
    return NextResponse.json(
      { error: error?.message || '执行一键熔断失败' },
      { status: 500 }
    )
  }
}
