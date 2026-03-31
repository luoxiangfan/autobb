import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { hash as bcryptHash } from '@/lib/bcrypt'
import crypto from 'crypto'
import { logPasswordReset, UserManagementContext } from '@/lib/audit-logger'

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
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = parseInt(params.id)
    const db = getDatabase()

    // Check if user exists
    const user = await db.queryOne('SELECT id, username, role FROM users WHERE id = ?', [userId]) as { id: number; username: string; role: string } | undefined
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // 🔧 修复(2025-12-30): 使用crypto.randomBytes生成密码学安全的随机密码
    // 生成16字节随机数，转为base64编码，取前16个字符
    const randomBytes = crypto.randomBytes(16)
    const newPassword = randomBytes.toString('base64').slice(0, 16)

    // Hash password
    const hashedPassword = await bcryptHash(newPassword, 10)

    // Update user password and set must_change_password flag
    // 🔧 修复(2025-12-30): PostgreSQL兼容性
    // PostgreSQL的must_change_password可能是BOOLEAN类型，需要根据数据库类型传值
    // 管理员账号不强制修改密码（避免管理员被锁死在改密流程）
    const shouldForceChange = user.role !== 'admin'
    const mustChangeValue = db.type === 'postgres' ? shouldForceChange : (shouldForceChange ? 1 : 0)
    const result = await db.exec(`
      UPDATE users
      SET password_hash = ?, must_change_password = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [hashedPassword, mustChangeValue, userId])

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 })
    }

    // 获取操作者的username（从数据库查询）
    const operator = await db.queryOne('SELECT username FROM users WHERE id = ?', [auth.user!.userId]) as { username: string } | undefined

    // 记录审计日志
    const auditContext: UserManagementContext = {
      operatorId: auth.user!.userId,
      operatorUsername: operator?.username || `user_${auth.user!.userId}`,
      targetUserId: userId,
      targetUsername: user.username || `user_${userId}`,
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent') || 'Unknown',
    }
    await logPasswordReset(auditContext, 'admin_reset')

    return NextResponse.json({
      success: true,
      username: user.username,
      newPassword
    })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
