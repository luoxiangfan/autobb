import { NextRequest, NextResponse } from 'next/server'
import { withAuth, AuthenticatedHandler } from '@/lib/auth'
import {
  getActiveSessions,
  revokeSession,
  revokeAllSessions,
  getTrustedDevices,
  trustDevice,
  untrustDevice,
  getUserAlerts,
  resolveAlert
} from '@/lib/user-sessions'

/**
 * GET /api/auth/sessions
 * 获取当前用户的活跃会话和信任设备
 */
const getHandler: AuthenticatedHandler = async (request, user) => {
  const sessions = await getActiveSessions(user.userId)
  const trustedDevices = await getTrustedDevices(user.userId)
  const alerts = await getUserAlerts(user.userId, false)

  return NextResponse.json({
    sessions: sessions.map(s => ({
      id: s.id,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      deviceFingerprint: s.deviceFingerprint,
      isCurrent: s.isCurrent,
      isSuspicious: s.isSuspicious,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
      expiresAt: s.expiresAt,
    })),
    trustedDevices: trustedDevices.map(d => ({
      id: d.id,
      deviceFingerprint: d.deviceFingerprint,
      deviceName: d.deviceName,
      lastUsedAt: d.lastUsedAt,
    })),
    alerts: alerts.map(a => ({
      id: a.id,
      alertType: a.alertType,
      severity: a.severity,
      description: a.description,
      createdAt: a.createdAt,
    })),
  })
}

/**
 * DELETE /api/auth/sessions
 * 撤销当前会话或所有会话
 * Body: { sessionToken?: string, revokeAll?: boolean }
 */
const deleteHandler: AuthenticatedHandler = async (request, user) => {
  const body = await request.json()
  const { sessionToken, revokeAll } = body

  if (revokeAll) {
    // 撤销所有会话
    const count = await revokeAllSessions(user.userId)
    return NextResponse.json({
      success: true,
      message: `已撤销 ${count} 个会话`,
    })
  }

  if (sessionToken) {
    // 撤销特定会话
    const success = await revokeSession(sessionToken, user.userId)
    if (success) {
      return NextResponse.json({
        success: true,
        message: '会话已撤销',
      })
    }
    return NextResponse.json(
      { error: '会话不存在或已被撤销' },
      { status: 404 }
    )
  }

  return NextResponse.json(
    { error: '请提供 sessionToken 或 revokeAll=true' },
    { status: 400 }
  )
}

export const GET = withAuth(getHandler)
export const DELETE = withAuth(deleteHandler)
