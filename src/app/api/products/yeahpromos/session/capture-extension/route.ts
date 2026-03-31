import { NextRequest, NextResponse } from 'next/server'
import { verifyProductManagementSessionAuth } from '@/lib/openclaw/request-auth'
import {
  getYeahPromosSessionState,
  maskSessionId,
  saveYeahPromosSessionCookie,
} from '@/lib/yeahpromos-session'

const MAX_CAPTURE_COOKIE_LENGTH = 16000

function parseCookieFromBody(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const payload = body as Record<string, unknown>
  return String(payload.cookie || '').trim()
}

export async function POST(request: NextRequest) {
  const auth = await verifyProductManagementSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const cookie = parseCookieFromBody(body)

    if (!cookie) {
      return NextResponse.json(
        { success: false, error: '缺少 cookie，请先在 YeahPromos 页面执行扩展采集' },
        { status: 400 }
      )
    }
    if (cookie.length > MAX_CAPTURE_COOKIE_LENGTH) {
      return NextResponse.json(
        { success: false, error: 'cookie 长度异常，请重新登录后重试' },
        { status: 400 }
      )
    }

    await saveYeahPromosSessionCookie({
      userId: auth.user.userId,
      rawCookie: cookie,
    })

    const session = await getYeahPromosSessionState(auth.user.userId)
    return NextResponse.json({
      success: true,
      session: {
        hasSession: session.hasSession,
        isExpired: session.isExpired,
        capturedAt: session.capturedAt,
        expiresAt: session.expiresAt,
        maskedPhpSessionId: maskSessionId(session.phpSessionId),
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || '扩展回传登录态失败' },
      { status: 500 }
    )
  }
}
