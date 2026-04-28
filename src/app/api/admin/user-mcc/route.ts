import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/admin/user-mcc
 * 获取用户分配的 MCC 列表
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)
    const targetUserId = searchParams.get('userId')

    // 如果是管理员查询其他用户
    const queryUserId = targetUserId && authResult.user.role === 'admin' 
      ? parseInt(targetUserId, 10) 
      : userId

    const db = await getDatabase()

    const assignments = await db.query(`
      SELECT 
        uma.id,
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
        WHERE is_manager_account = ${db.type === 'postgres' ? 'TRUE' : '1'}
        GROUP BY customer_id
      ) gaa ON uma.mcc_customer_id = gaa.customer_id
      WHERE uma.user_id = ?
      ORDER BY uma.assigned_at DESC
    `, [queryUserId]) as Array<{
      id: number
      mcc_customer_id: string
      assigned_at: string
      assigned_by: number | null
      assigned_by_username: string | null
      mcc_account_name: string | null
    }>

    return NextResponse.json({
      success: true,
      assignments,
      count: assignments.length,
    })
  } catch (error: any) {
    console.error('获取用户 MCC 分配失败:', error)
    return NextResponse.json(
      { error: error.message || '获取失败' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/user-mcc
 * 为用户分配 MCC 账号
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 🔧 验证管理员权限
    if (authResult.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const adminUserId = authResult.user.userId
    const body = await request.json()
    const { userId, mccCustomerIds } = body

    // 验证参数
    if (!userId || !mccCustomerIds || !Array.isArray(mccCustomerIds)) {
      return NextResponse.json(
        { error: '缺少 userId 或 mccCustomerIds 参数' },
        { status: 400 }
      )
    }

    if (mccCustomerIds.length === 0) {
      return NextResponse.json(
        { error: 'mccCustomerIds 不能为空' },
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 验证目标用户是否存在
    const targetUser = await db.queryOne(`
      SELECT id FROM users WHERE id = ?
    `, [userId])

    if (!targetUser) {
      return NextResponse.json(
        { error: '目标用户不存在' },
        { status: 404 }
      )
    }

    // 验证 MCC 账号是否存在（必须是 is_manager_account = TRUE）
    const isManagerCondition = db.type === 'postgres' ? 'is_manager_account = TRUE' : 'is_manager_account = 1'
    const mccAccounts = await db.query(`
      SELECT customer_id, MAX(account_name) AS account_name
      FROM google_ads_accounts
      WHERE customer_id IN (${mccCustomerIds.map(() => '?').join(',')})
      AND ${isManagerCondition}
      GROUP BY customer_id
    `, mccCustomerIds) as Array<{ customer_id: string; account_name: string }>

    if (mccAccounts.length !== mccCustomerIds.length) {
      const validIds = mccAccounts.map(a => a.customer_id)
      const invalidIds = mccCustomerIds.filter(id => !validIds.includes(id))
      return NextResponse.json(
        { 
          error: '以下 MCC 账号不存在或不是经理账号',
          invalidIds,
          validAccounts: mccAccounts,
        },
        { status: 400 }
      )
    }

    // 批量插入或忽略（SQLite）/ ON CONFLICT DO NOTHING（PostgreSQL）
    const now = new Date().toISOString()
    const insertedCount = await (async () => {
      if (db.type === 'postgres') {
        // PostgreSQL: 使用 ON CONFLICT
        let count = 0
        for (const mccId of mccCustomerIds) {
          const result = await db.exec(`
            INSERT INTO user_mcc_assignments (user_id, mcc_customer_id, assigned_at, assigned_by)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (user_id, mcc_customer_id) DO NOTHING
          `, [userId, mccId, now, adminUserId])
          count += result.changes || 0
        }
        return count
      } else {
        // SQLite: 使用 INSERT OR IGNORE
        const values = mccCustomerIds.map(id => `(?, ?, ?, ?)`).join(',')
        const params = mccCustomerIds.flatMap(id => [userId, id, now, adminUserId])
        const result = await db.exec(`
          INSERT OR IGNORE INTO user_mcc_assignments (user_id, mcc_customer_id, assigned_at, assigned_by)
          VALUES ${values}
        `, params)
        return result.changes || 0
      }
    })()

    return NextResponse.json({
      success: true,
      message: `成功分配 ${insertedCount} 个 MCC 账号`,
      assignedCount: insertedCount,
      mccCustomerIds,
    })
  } catch (error: any) {
    console.error('分配 MCC 账号失败:', error)
    return NextResponse.json(
      { error: error.message || '分配失败' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/user-mcc
 * 移除用户的 MCC 分配
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 🔧 验证管理员权限
    if (authResult.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const body = await request.json()
    const { userId, mccCustomerIds } = body

    // 验证参数
    if (!userId || !mccCustomerIds || !Array.isArray(mccCustomerIds)) {
      return NextResponse.json(
        { error: '缺少 userId 或 mccCustomerIds 参数' },
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 批量删除
    const placeholders = mccCustomerIds.map(() => '?').join(',')
    const result = await db.exec(`
      DELETE FROM user_mcc_assignments
      WHERE user_id = ? AND mcc_customer_id IN (${placeholders})
    `, [userId, ...mccCustomerIds])

    return NextResponse.json({
      success: true,
      message: `成功移除 ${result.changes || 0} 个 MCC 分配`,
      removedCount: result.changes || 0,
      mccCustomerIds,
    })
  } catch (error: any) {
    console.error('移除 MCC 分配失败:', error)
    return NextResponse.json(
      { error: error.message || '移除失败' },
      { status: 500 }
    )
  }
}
