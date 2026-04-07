import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/json-field'

/**
 * GET /api/admin/users/:id/login-history
 * 获取指定用户的登录历史记录
 */
export const GET = withAuth(
  async (request: NextRequest, user, context) => {
    try {
      const userId = parseInt(context?.params?.id || '0', 10)
      if (!userId) {
        return NextResponse.json({ error: '无效的用户ID' }, { status: 400 })
      }

      const db = getDatabase()

      // 获取登录尝试记录（成功和失败）
      const { searchParams } = new URL(request.url)
      const limit = parseInt(searchParams.get('limit') || '50', 10)
      const offset = parseInt(searchParams.get('offset') || '0', 10)

      // 获取用户信息
      const targetUser = await db.queryOne('SELECT username, email FROM users WHERE id = ?', [userId]) as { username: string; email: string } | undefined

      if (!targetUser) {
        return NextResponse.json({ error: '用户不存在' }, { status: 404 })
      }

      // 查询登录尝试记录（使用username或email匹配，包含设备信息）
      // P1修复：添加 success 条件来获取所有记录（成功和失败）
      // 之前缺少这个条件可能导致某些数据库行为不一致
      const loginAttempts = await db.query(`
        SELECT
          id,
          username_or_email,
          ip_address,
          user_agent,
          CAST(success AS INTEGER) as success,
          failure_reason,
          attempted_at,
          device_type,
          os,
          browser,
          browser_version
        FROM login_attempts
        WHERE username_or_email IN (?, ?)
        ORDER BY attempted_at DESC
        LIMIT ? OFFSET ?
      `, [targetUser.username, targetUser.email || targetUser.username, limit, offset]) as any[]

      // 获取总记录数
      const totalResult = await db.queryOne(`
        SELECT COUNT(*) as total
        FROM login_attempts
        WHERE username_or_email IN (?, ?)
      `, [targetUser.username, targetUser.email || targetUser.username]) as { total: number }

      // 获取审计日志中的登录成功记录
      const auditLogs = await db.query(`
        SELECT
          id,
          event_type,
          ip_address,
          user_agent,
          details,
          created_at
        FROM audit_logs
        WHERE user_id = ?
          AND event_type IN ('login_success', 'login_failed', 'account_locked')
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `, [userId, limit, offset]) as any[]

      // P1修复：确保 success 是布尔值类型，处理不同数据库返回的类型差异
      // SQLite可能返回整数/字符串，PostgreSQL可能返回布尔值
      const normalizedRecords = [
        ...loginAttempts.map(record => ({
          type: 'login_attempt',
          id: record.id,
          // 使用双重检查确保正确识别成功记录
          success: record.success === 1 || record.success === true || record.success === '1' || record.success === 'true',
          ipAddress: record.ip_address,
          userAgent: record.user_agent,
          failureReason: record.failure_reason,
          timestamp: record.attempted_at,
          deviceType: record.device_type,
          os: record.os,
          browser: record.browser,
          browserVersion: record.browser_version,
        })),
        ...auditLogs.map(log => ({
          type: 'audit_log',
          id: log.id,
          eventType: log.event_type,
          ipAddress: log.ip_address,
          userAgent: log.user_agent,
          details: parseJsonField(log.details, null),
          timestamp: log.created_at,
        }))
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

      return NextResponse.json({
        user: {
          id: userId,
          username: targetUser.username,
          email: targetUser.email,
        },
        records: normalizedRecords.slice(0, limit),
        pagination: {
          total: totalResult.total,
          limit,
          offset,
        }
      })
    } catch (error: any) {
      console.error('获取登录历史失败:', error)
      return NextResponse.json(
        { error: error.message || '获取登录历史失败' },
        { status: 500 }
      )
    }
  },
  { requireAdmin: true }
)
