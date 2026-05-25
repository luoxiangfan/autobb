import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/auth/google-ads/callback
 * 遗留 OAuth 回调：请改用 /api/google-ads/oauth/callback（与设置页授权一致）。
 */
export const dynamic = 'force-dynamic'

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(
      `${getBaseUrl()}/settings?error=${encodeURIComponent(error)}&category=google_ads`
    )
  }

  return NextResponse.redirect(
    `${getBaseUrl()}/settings?error=legacy_oauth_callback_uri&category=google_ads`
  )
}
