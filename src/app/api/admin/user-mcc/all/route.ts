import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/admin/user-mcc/all
 * 获取所有 MCC 账号的分配情况（用于前端显示哪些 MCC 已被绑定）
 */
export const GET = withAuth(
  async () => {
    try {
      const db = await getDatabase()

      const assignments = (await db.query(`
      SELECT 
        uma.mcc_customer_id,
        uma.user_id,
        u.username,
        u.email,
        uma.assigned_at
      FROM user_mcc_assignments uma
      LEFT JOIN users u ON uma.user_id = u.id
      ORDER BY uma.assigned_at DESC
    `)) as Array<{
        mcc_customer_id: string
        user_id: number
        username: string | null
        email: string | null
        assigned_at: string
      }>

      return NextResponse.json({
        success: true,
        assignments,
        count: assignments.length,
      })
    } catch (error: any) {
      console.error('获取所有 MCC 分配失败:', error)
      return NextResponse.json({ error: error.message || '获取失败' }, { status: 500 })
    }
  },
  { requireAdmin: true }
)
