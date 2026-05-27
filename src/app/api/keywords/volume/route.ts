/**
 * Keyword Search Volume API
 * GET /api/keywords/volume?keywords=kw1,kw2&country=US&language=en
 */
import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getKeywordSearchVolumes } from '@/lib/keyword-planner'
import {
  getGoogleAdsAuthContext,
  hasConfiguredGoogleAdsAuthFromContext,
} from '@/lib/google-ads-auth-context'
import { prepareGoogleAdsAccountApiCall } from '@/lib/google-ads-accounts-auth'

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

    const authContext = await getGoogleAdsAuthContext(userId)
    if (!hasConfiguredGoogleAdsAuthFromContext(authContext)) {
      return NextResponse.json(
        { error: 'Google Ads 认证未配置或已失效，请在设置中完成配置' },
        { status: 400 }
      )
    }
    const prepared = await prepareGoogleAdsAccountApiCall({
      authContext,
      linkedServiceAccountId: null,
    })
    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.message }, { status: 400 })
    }
    const volumes = await getKeywordSearchVolumes(
      keywords,
      country,
      language,
      userId,
      prepared.apiAuth.authType,
      prepared.apiAuth.serviceAccountId,
      undefined,
      {
        existingContext: authContext,
        healedOAuth: prepared.oauthCredentials
          ? {
              credentials: prepared.oauthCredentials,
              loginCustomerId: prepared.oauthLoginCustomerId,
              refreshToken: prepared.refreshToken,
            }
          : undefined,
      }
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
