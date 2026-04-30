import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/admin/user-mcc/all
 * 获取所有 MCC 账号的分配情况（用于前端显示哪些 MCC 已被绑定）
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 🔧 验证管理员权限
    if (authResult.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const db = await getDatabase()

    // 获取所有 MCC 分配及其对应用户
    const assignments = await db.query(`
      SELECT 
        uma.mcc_customer_id,
        uma.user_id,
        u.username,
        u.email,
        uma.assigned_at
      FROM user_mcc_assignments uma
      LEFT JOIN users u ON uma.user_id = u.id
      ORDER BY uma.assigned_at DESC
    `) as Array<{
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
    return NextResponse.json(
      { error: error.message || '获取失败' },
      { status: 500 }
    )
  }
}
