import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/json-field'

/**
 * GET /api/admin/audit-logs
 * 查询用户管理操作审计日志（管理员专用）
 */
export const GET = withAuth(
  async (request: NextRequest) => {
    try {
      const db = getDatabase()
      const { searchParams } = new URL(request.url)

      // 分页参数
      const page = parseInt(searchParams.get('page') || '1', 10)
      const limit = parseInt(searchParams.get('limit') || '50', 10)
      const offset = (page - 1) * limit

      // 过滤参数
      const operatorId = searchParams.get('operatorId')
      const targetUserId = searchParams.get('targetUserId')
      const eventType = searchParams.get('eventType')
      const status = searchParams.get('status')
      const startDate = searchParams.get('startDate')
      const endDate = searchParams.get('endDate')

      // 构建查询条件
      let query = `
        SELECT
          id,
          user_id,
          event_type,
          ip_address,
          user_agent,
          details,
          created_at,
          operator_id,
          operator_username,
          target_user_id,
          target_username,
          status,
          error_message
        FROM audit_logs
        WHERE event_type IN ('user_created', 'user_updated', 'user_disabled', 'user_enabled',
                             'user_deleted', 'user_password_reset', 'user_unlocked', 'user_role_changed')
      `
      const params: any[] = []

      if (operatorId) {
        query += ' AND operator_id = ?'
        params.push(parseInt(operatorId, 10))
      }

      if (targetUserId) {
        query += ' AND target_user_id = ?'
        params.push(parseInt(targetUserId, 10))
      }

      if (eventType && eventType !== 'all') {
        query += ' AND event_type = ?'
        params.push(eventType)
      }

      if (status && status !== 'all') {
        query += ' AND status = ?'
        params.push(status)
      }

      if (startDate) {
        query += ' AND created_at >= ?'
        params.push(startDate)
      }

      if (endDate) {
        query += ' AND created_at <= ?'
        params.push(endDate)
      }

      // 获取总数
      let countQuery = query.replace(/SELECT[\s\S]+FROM/, 'SELECT COUNT(*) as total FROM')
      const totalResult = await db.queryOne(countQuery, params) as { total: number }

      // 获取记录
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
      const records = await db.query(query, [...params, limit, offset]) as any[]

      // 解析details字段
      const formattedRecords = records.map(record => ({
        id: record.id,
        userId: record.user_id,
        eventType: record.event_type,
        ipAddress: record.ip_address,
        userAgent: record.user_agent,
        details: parseJsonField(record.details, null),
        createdAt: record.created_at,
        operatorId: record.operator_id,
        operatorUsername: record.operator_username,
        targetUserId: record.target_user_id,
        targetUsername: record.target_username,
        status: record.status,
        errorMessage: record.error_message,
      }))

      return NextResponse.json({
        records: formattedRecords,
        pagination: {
          total: totalResult.total,
          page,
          limit,
          totalPages: Math.ceil(totalResult.total / limit),
        }
      })
    } catch (error: any) {
      console.error('查询审计日志失败:', error)
      return NextResponse.json(
        { error: error.message || '查询审计日志失败' },
        { status: 500 }
      )
    }
  },
  { requireAdmin: true }
)
