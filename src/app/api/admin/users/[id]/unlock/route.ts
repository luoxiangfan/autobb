import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { unlockAccount } from '@/lib/auth-security'
import { logAuditEvent, AuditEventType } from '@/lib/audit-logger'

/**
 * POST /api/admin/users/:id/unlock
 * 管理员手动解锁被锁定的账户
 */
export const POST = withAuth(
  async (request: NextRequest, user, context) => {
    try {
      const userId = parseInt(context?.params?.id || '0', 10)
      if (!userId) {
        return NextResponse.json({ error: '无效的用户ID' }, { status: 400 })
      }

      // 执行解锁
      await unlockAccount(userId)

      // 记录审计日志
      const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      const userAgent = request.headers.get('user-agent') || 'unknown'

      await logAuditEvent({
        userId,
        eventType: AuditEventType.ACCOUNT_UNLOCKED,
        ipAddress,
        userAgent,
        details: {
          unlocked_by_admin: user.userId,
          unlocked_by_email: user.email,
          reason: 'manual_admin_unlock',
        },
      })

      return NextResponse.json({
        success: true,
        message: '账户已解锁',
      })
    } catch (error: any) {
      console.error('解锁账户失败:', error)
      return NextResponse.json(
        { error: error.message || '解锁失败' },
        { status: 500 }
      )
    }
  },
  { requireAdmin: true }
)
