import { NextRequest, NextResponse } from 'next/server'
import { withAuth, hash as bcryptHash } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import crypto from 'crypto'
import { logPasswordReset, UserManagementContext } from '@/lib/common/server'

// 获取客户端IP地址
function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }
  const realIP = request.headers.get('x-real-ip')
  if (realIP) {
    return realIP
  }
  return 'unknown'
}

// POST: Reset user password
export const POST = withAuth(
  async (request: NextRequest, operator, context) => {
    try {
      const userId = parseInt(context?.params?.id ?? '', 10)
      const db = getDatabase()

      const user = (await db.queryOne('SELECT id, username, role FROM users WHERE id = ?', [
        userId,
      ])) as { id: number; username: string; role: string } | undefined
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      const randomBytes = crypto.randomBytes(16)
      const newPassword = randomBytes.toString('base64').slice(0, 16)

      const hashedPassword = await bcryptHash(newPassword, 10)

      const shouldForceChange = user.role !== 'admin'
      const mustChangeValue = shouldForceChange
      const result = await db.exec(
        `
      UPDATE users
      SET password_hash = ?, must_change_password = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
        [hashedPassword, mustChangeValue, userId]
      )

      if (result.changes === 0) {
        return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 })
      }

      const operatorRow = (await db.queryOne('SELECT username FROM users WHERE id = ?', [
        operator.userId,
      ])) as { username: string } | undefined

      const auditContext: UserManagementContext = {
        operatorId: operator.userId,
        operatorUsername: operatorRow?.username || `user_${operator.userId}`,
        targetUserId: userId,
        targetUsername: user.username || `user_${userId}`,
        ipAddress: getClientIP(request),
        userAgent: request.headers.get('user-agent') || 'Unknown',
      }
      await logPasswordReset(auditContext, 'admin_reset')

      return NextResponse.json({
        success: true,
        username: user.username,
        newPassword,
      })
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  },
  { requireAdmin: true }
)
