import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/admin/user-mcc
 * 获取用户分配的 MCC 列表
 */
export const GET = withAuth(async (request: NextRequest, user) => {
  try {
    const userId = user.userId
    const { searchParams } = new URL(request.url)
    const targetUserId = searchParams.get('userId')

    const queryUserId = targetUserId && user.role === 'admin' ? parseInt(targetUserId, 10) : userId

    const db = await getDatabase()

    const assignments = (await db.query(
      `
      SELECT 
        uma.id,
        uma.user_id as assigned_to_user_id,
        uma.mcc_customer_id,
        uma.assigned_at,
        uma.assigned_by,
        u.username as assigned_by_username,
        gaa.account_name as mcc_account_name
      FROM user_mcc_assignments uma
      LEFT JOIN users u ON uma.assigned_by = u.id
      LEFT JOIN (
        SELECT customer_id, MAX(account_name) as account_name
        FROM google_ads_accounts
        WHERE is_manager_account = ${'TRUE'}
        GROUP BY customer_id
      ) gaa ON uma.mcc_customer_id = gaa.customer_id
      WHERE uma.user_id = ?
      ORDER BY uma.assigned_at DESC
    `,
      [queryUserId]
    )) as Array<{
      id: number
      mcc_customer_id: string
      assigned_at: string
      assigned_by: number | null
      assigned_by_username: string | null
      mcc_account_name: string | null
      assigned_to_user_id: number
    }>

    return NextResponse.json({
      success: true,
      assignments,
      count: assignments.length,
    })
  } catch (error: any) {
    console.error('获取用户 MCC 分配失败:', error)
    return NextResponse.json({ error: error.message || '获取失败' }, { status: 500 })
  }
})

/**
 * POST /api/admin/user-mcc
 * 为用户分配 MCC 账号
 */
export const POST = withAuth(
  async (request: NextRequest, user) => {
    try {
      const adminUserId = user.userId
      const body = await request.json()
      const { userId, mccCustomerIds } = body

      // 验证参数
      if (!userId || !mccCustomerIds || !Array.isArray(mccCustomerIds)) {
        return NextResponse.json({ error: '缺少 userId 或 mccCustomerIds 参数' }, { status: 400 })
      }

      if (mccCustomerIds.length === 0) {
        return NextResponse.json({ error: 'mccCustomerIds 不能为空' }, { status: 400 })
      }

      const db = await getDatabase()

      // 验证目标用户是否存在
      const targetUser = await db.queryOne(
        `
      SELECT id FROM users WHERE id = ?
    `,
        [userId]
      )

      if (!targetUser) {
        return NextResponse.json({ error: '目标用户不存在' }, { status: 404 })
      }

      // 验证 MCC 账号是否存在（必须是 is_manager_account = TRUE）
      const isManagerCondition = 'is_manager_account = TRUE'
      const mccAccounts = (await db.query(
        `
      SELECT customer_id, MAX(account_name) AS account_name
      FROM google_ads_accounts
      WHERE customer_id IN (${mccCustomerIds.map(() => '?').join(',')})
      AND ${isManagerCondition}
      GROUP BY customer_id
    `,
        mccCustomerIds
      )) as Array<{ customer_id: string; account_name: string }>

      if (mccAccounts.length !== mccCustomerIds.length) {
        const validIds = mccAccounts.map((a) => a.customer_id)
        const invalidIds = mccCustomerIds.filter((id) => !validIds.includes(id))
        return NextResponse.json(
          {
            error: '以下 MCC 账号不存在或不是经理账号',
            invalidIds,
            validAccounts: mccAccounts,
          },
          { status: 400 }
        )
      }

      // 🔧 检查 MCC 账号是否已被其他用户绑定（一个 MCC 只能绑定一个用户）
      const placeholders = mccCustomerIds.map(() => '?').join(',')
      const existingAssignments = (await db.query(
        `
      SELECT mcc_customer_id, user_id, u.username as assigned_to_username
      FROM user_mcc_assignments uma
      LEFT JOIN users u ON uma.user_id = u.id
      WHERE mcc_customer_id IN (${placeholders})
      AND user_id != ?
    `,
        [...mccCustomerIds, userId]
      )) as Array<{ mcc_customer_id: string; user_id: number; assigned_to_username: string | null }>

      if (existingAssignments.length > 0) {
        const conflicts = existingAssignments.map((a) => ({
          mccCustomerId: a.mcc_customer_id,
          assignedToUserId: a.user_id,
          assignedToUsername: a.assigned_to_username || `用户${a.user_id}`,
        }))
        return NextResponse.json(
          {
            error: '以下 MCC 账号已被其他用户绑定，一个 MCC 账号只能与一个用户绑定',
            conflicts,
          },
          { status: 409 }
        )
      }

      // 批量插入或忽略（ON CONFLICT DO NOTHING）
      const now = new Date().toISOString()
      const insertedCount = await (async () => {
        let count = 0
        for (const mccId of mccCustomerIds) {
          const result = await db.exec(
            `
            INSERT INTO user_mcc_assignments (user_id, mcc_customer_id, assigned_at, assigned_by)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (user_id, mcc_customer_id) DO NOTHING
          `,
            [userId, mccId, now, adminUserId]
          )
          count += result.changes || 0
        }
        return count
      })()

      return NextResponse.json({
        success: true,
        message: `成功分配 ${insertedCount} 个 MCC 账号`,
        assignedCount: insertedCount,
        mccCustomerIds,
      })
    } catch (error: any) {
      console.error('分配 MCC 账号失败:', error)
      return NextResponse.json({ error: error.message || '分配失败' }, { status: 500 })
    }
  },
  { requireAdmin: true }
)

/**
 * DELETE /api/admin/user-mcc
 * 移除用户的 MCC 分配
 */
export const DELETE = withAuth(
  async (request: NextRequest) => {
    try {
      const body = await request.json()
      const { userId, mccCustomerIds } = body

      // 验证参数
      if (!userId || !mccCustomerIds || !Array.isArray(mccCustomerIds)) {
        return NextResponse.json({ error: '缺少 userId 或 mccCustomerIds 参数' }, { status: 400 })
      }

      const db = await getDatabase()

      // 批量删除
      const placeholders = mccCustomerIds.map(() => '?').join(',')
      const result = await db.exec(
        `
      DELETE FROM user_mcc_assignments
      WHERE user_id = ? AND mcc_customer_id IN (${placeholders})
    `,
        [userId, ...mccCustomerIds]
      )

      return NextResponse.json({
        success: true,
        message: `成功移除 ${result.changes || 0} 个 MCC 分配`,
        removedCount: result.changes || 0,
        mccCustomerIds,
      })
    } catch (error: any) {
      console.error('移除 MCC 分配失败:', error)
      return NextResponse.json({ error: error.message || '移除失败' }, { status: 500 })
    }
  },
  { requireAdmin: true }
)
