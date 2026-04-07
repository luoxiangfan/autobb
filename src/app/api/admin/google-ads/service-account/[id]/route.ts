import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getUserIdFromRequest, findUserById } from '@/lib/auth'

/**
 * 管理员端：服务账号用户绑定管理
 */

async function getAdminUser(request: NextRequest) {
  const userId = getUserIdFromRequest(request)
  if (!userId) return null
  
  const user = await findUserById(userId)
  
  // 管理员权限检查
  if (user.role !== 'admin') {
    return null
  }
  
  return user
}

/**
 * POST /api/admin/google-ads/service-account/:id/bind-user
 * 将服务账号绑定到用户
 */
export async function POST(
  req: NextRequest, 
  { params }: { params: { id: string } }
) {
  const admin = await getAdminUser(req)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 401 })
  }

  try {
    const serviceAccountId = params.id
    const body = await req.json()
    const { user_id } = body

    if (!user_id) {
      return NextResponse.json({ error: '缺少 user_id 字段' }, { status: 400 })
    }

    const db = getDatabase()

    // 检查服务账号是否存在
    const serviceAccount = await db.queryOne(`
      SELECT * FROM google_ads_service_accounts 
      WHERE id = ? AND is_shared = 1 AND is_active = 1
    `, [serviceAccountId])

    if (!serviceAccount) {
      return NextResponse.json({ error: '服务账号不存在或已禁用' }, { status: 404 })
    }

    // 检查用户是否存在
    const user = await db.queryOne('SELECT id FROM users WHERE id = ?', [user_id])
    if (!user) {
      return NextResponse.json({ error: `用户 ${user_id} 不存在` }, { status: 404 })
    }

    // 检查是否已经绑定
    const existingBinding = await db.queryOne(`
      SELECT * FROM google_ads_user_sa_bindings 
      WHERE user_id = ? AND service_account_id = ?
    `, [user_id, serviceAccountId])

    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    const bindingId = crypto.randomUUID()

    if (existingBinding) {
      // 更新现有绑定
      await db.exec(`
        UPDATE google_ads_user_sa_bindings 
        SET is_active = 1, updated_at = ${nowFunc}
        WHERE id = ?
      `, [existingBinding.id])
      
      return NextResponse.json({ 
        success: true,
        data: { binding_id: existingBinding.id, action: 'updated' }
      })
    } else {
      // 创建新绑定
      await db.exec(`
        INSERT INTO google_ads_user_sa_bindings (
          id, user_id, service_account_id, bound_by, is_active, bound_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ${nowFunc}, ${nowFunc}, ${nowFunc})
      `, [bindingId, user_id, serviceAccountId, admin.id])

      return NextResponse.json({ 
        success: true,
        data: { binding_id: bindingId, action: 'created' }
      })
    }
  } catch (error: any) {
    console.error('[Admin SA Bind User] Error:', error)
    return NextResponse.json({ 
      error: '绑定用户失败',
      message: error.message 
    }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/google-ads/service-account/:id/unbind-user/:userId
 * 解除用户与服务账号的绑定
 */
export async function DELETE(
  req: NextRequest, 
  { params }: { params: { id: string; userId: string } }
) {
  const admin = await getAdminUser(req)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 401 })
  }

  try {
    const serviceAccountId = params.id
    const userId = params.userId
    const db = getDatabase()

    await db.exec(`
      UPDATE google_ads_user_sa_bindings 
      SET is_active = 0, updated_at = ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"}
      WHERE service_account_id = ? AND user_id = ?
    `, [serviceAccountId, userId])

    return NextResponse.json({ 
      success: true,
      data: { service_account_id: serviceAccountId, user_id: userId }
    })
  } catch (error: any) {
    console.error('[Admin SA Unbind User] Error:', error)
    return NextResponse.json({ 
      error: '解除绑定失败',
      message: error.message 
    }, { status: 500 })
  }
}

/**
 * GET /api/admin/google-ads/service-account/:id/bindings
 * 获取服务账号的所有用户绑定
 */
export async function GET(
  req: NextRequest, 
  { params }: { params: { id: string } }
) {
  const admin = await getAdminUser(req)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 401 })
  }

  try {
    const serviceAccountId = params.id
    const db = getDatabase()

    const bindings = await db.query(`
      SELECT 
        b.id,
        b.user_id,
        u.email as user_email,
        b.bound_by,
        b.is_active,
        b.bound_at,
        b.created_at,
        b.updated_at
      FROM google_ads_user_sa_bindings b
      LEFT JOIN users u ON b.user_id = u.id
      WHERE b.service_account_id = ?
      ORDER BY b.bound_at DESC
    `, [serviceAccountId])

    return NextResponse.json({ 
      success: true,
      data: { 
        service_account_id: serviceAccountId,
        bindings,
        total: bindings.length,
        active: bindings.filter((b: any) => b.is_active).length
      }
    })
  } catch (error: any) {
    console.error('[Admin SA Bindings GET] Error:', error)
    return NextResponse.json({ 
      error: '获取绑定列表失败',
      message: error.message 
    }, { status: 500 })
  }
}
