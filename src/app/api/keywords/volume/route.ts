/**
 * Keyword Search Volume API
 * GET /api/keywords/volume?keywords=kw1,kw2&country=US&language=en
 * Optional: offerId, googleAdsAccountId (for linked service_account_id)
 */
import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getKeywordSearchVolumesForPlannerContext } from '@/lib/google-ads/accounts/auth/index'
import { parsePositiveIntegerOfferId } from '@/lib/offers'

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

    const keywords = keywordsParam
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
    if (keywords.length === 0) {
      return NextResponse.json({ error: 'No valid keywords provided' }, { status: 400 })
    }

    if (keywords.length > 100) {
      return NextResponse.json({ error: 'Maximum 100 keywords per request' }, { status: 400 })
    }

    const offerId = offerIdParam ? parsePositiveIntegerOfferId(offerIdParam) : undefined
    const googleAdsAccountId = googleAdsAccountIdParam
      ? parseInt(googleAdsAccountIdParam, 10)
      : undefined

    const volumeResult = await getKeywordSearchVolumesForPlannerContext({
      userId,
      offerId,
      googleAdsAccountId:
        Number.isFinite(googleAdsAccountId) && googleAdsAccountId! > 0
          ? googleAdsAccountId
          : undefined,
      keywords,
      country,
      language,
    })

    if (!volumeResult.ok) {
      return NextResponse.json({ error: volumeResult.message }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      country,
      language,
      keywords: volumeResult.volumes.map((v) => ({
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
