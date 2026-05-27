/**
 * Keyword Search Volume API
 * GET /api/keywords/volume?keywords=kw1,kw2&country=US&language=en
 * Optional: offerId, googleAdsAccountId (for linked service_account_id)
 */
import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getKeywordSearchVolumes } from '@/lib/keyword-planner'
import { loadKeywordPlannerVolumeAuthForContext } from '@/lib/google-ads-accounts-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const searchParams = request.nextUrl.searchParams
    const keywordsParam = searchParams.get('keywords')
    const country = searchParams.get('country') || 'US'
    const language = searchParams.get('language') || 'en'
    const offerIdParam = searchParams.get('offerId')
    const googleAdsAccountIdParam = searchParams.get('googleAdsAccountId')

    if (!keywordsParam) {
      return NextResponse.json({ error: 'keywords parameter required' }, { status: 400 })
    }

    const keywords = keywordsParam.split(',').map(k => k.trim()).filter(Boolean)
    if (keywords.length === 0) {
      return NextResponse.json({ error: 'No valid keywords provided' }, { status: 400 })
    }

    if (keywords.length > 100) {
      return NextResponse.json({ error: 'Maximum 100 keywords per request' }, { status: 400 })
    }

    const offerId = offerIdParam ? parseInt(offerIdParam, 10) : undefined
    const googleAdsAccountId = googleAdsAccountIdParam
      ? parseInt(googleAdsAccountIdParam, 10)
      : undefined

    const loaded = await loadKeywordPlannerVolumeAuthForContext({
      userId,
      offerId: Number.isFinite(offerId) && offerId! > 0 ? offerId : undefined,
      googleAdsAccountId:
        Number.isFinite(googleAdsAccountId) && googleAdsAccountId! > 0
          ? googleAdsAccountId
          : undefined,
    })

    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.message }, { status: 400 })
    }
    const { volumeAuth } = loaded
    const volumes = await getKeywordSearchVolumes(
      keywords,
      country,
      language,
      userId,
      volumeAuth.authType,
      volumeAuth.serviceAccountId,
      undefined,
      volumeAuth.plannerAuth
    )

    return NextResponse.json({
      success: true,
      country,
      language,
      keywords: volumes.map(v => ({
        keyword: v.keyword,
        searchVolume: v.avgMonthlySearches,
        competition: v.competition,
        competitionIndex: v.competitionIndex,
        lowBid: v.lowTopPageBid,
        highBid: v.highTopPageBid,
      })),
    })
  } catch (error: any) {
    console.error('[KeywordsVolume] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch keyword volumes' }, { status: 500 })
  }
}
