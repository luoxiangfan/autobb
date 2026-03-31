import { NextRequest, NextResponse } from 'next/server'
import { verifyProductManagementSessionAuth } from '@/lib/openclaw/request-auth'
import {
  getYeahPromosSessionState,
  isYeahPromosManualSyncOnly,
  maskSessionId,
} from '@/lib/yeahpromos-session'

// 使用了 request.cookies（经由 verifyAuth），必须强制动态渲染避免静态构建阶段报 DYNAMIC_SERVER_USAGE
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await verifyProductManagementSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const [session, manualOnly] = await Promise.all([
    getYeahPromosSessionState(auth.user.userId),
    isYeahPromosManualSyncOnly(auth.user.userId),
  ])

  return NextResponse.json({
    success: true,
    session: {
      hasSession: session.hasSession,
      isExpired: session.isExpired,
      capturedAt: session.capturedAt,
      expiresAt: session.expiresAt,
      maskedPhpSessionId: maskSessionId(session.phpSessionId),
    },
    manualOnly,
  })
}
