import { NextRequest, NextResponse } from 'next/server'
import { verifyProductManagementSessionAuth } from '@/lib/openclaw/request-auth'
import {
  buildYeahPromosCaptureBookmarklet,
  createYeahPromosCaptureChallenge,
} from '@/lib/yeahpromos-session'

function normalizeHost(rawHost: string | null | undefined): string | null {
  const host = String(rawHost || '').trim()
  if (!host) return null
  const first = host.split(',')[0]?.trim()
  if (!first) return null
  return first
}

function normalizeProto(rawProto: string | null | undefined): 'http' | 'https' | null {
  const proto = String(rawProto || '').trim().toLowerCase().split(',')[0]?.trim()
  if (proto === 'http' || proto === 'https') return proto
  return null
}

function isNonPublicHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return true
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '0.0.0.0'
    || normalized === '::1'
}

function parsePublicOriginFromUrl(rawUrl: string | null | undefined): string | null {
  const value = String(rawUrl || '').trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (isNonPublicHost(url.hostname)) return null
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

function resolveCaptureOrigin(request: NextRequest): string {
  const forwardedHost = normalizeHost(request.headers.get('x-forwarded-host'))
  if (forwardedHost) {
    const forwardedProto = normalizeProto(request.headers.get('x-forwarded-proto')) || 'https'
    const forwardedOrigin = parsePublicOriginFromUrl(`${forwardedProto}://${forwardedHost}`)
    if (forwardedOrigin) return forwardedOrigin
  }

  const host = normalizeHost(request.headers.get('host'))
  if (host) {
    const directProto = normalizeProto(request.headers.get('x-forwarded-proto'))
      || normalizeProto(request.nextUrl.protocol.replace(':', ''))
      || 'https'
    const directOrigin = parsePublicOriginFromUrl(`${directProto}://${host}`)
    if (directOrigin) return directOrigin
  }

  const envOrigin = parsePublicOriginFromUrl(process.env.NEXT_PUBLIC_APP_URL)
    || parsePublicOriginFromUrl(process.env.APP_URL)
    || parsePublicOriginFromUrl(process.env.PUBLIC_APP_URL)
  if (envOrigin) return envOrigin

  return request.nextUrl.origin
}

export async function POST(request: NextRequest) {
  const auth = await verifyProductManagementSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const challenge = await createYeahPromosCaptureChallenge(auth.user.userId)
  const origin = resolveCaptureOrigin(request)
  const captureUrl = `${origin}/api/products/yeahpromos/session/capture`
  const loginUrl = 'https://yeahpromos.com/index/login/login'
  const productsUrl = 'https://yeahpromos.com/index/offer/products'

  return NextResponse.json({
    success: true,
    loginUrl,
    productsUrl,
    captureUrl,
    captureTokenExpiresAt: challenge.expiresAt,
    bookmarklet: buildYeahPromosCaptureBookmarklet({
      captureUrl,
      captureToken: challenge.captureToken,
    }),
  })
}
