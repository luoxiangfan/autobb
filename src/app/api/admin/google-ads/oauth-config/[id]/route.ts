import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getUserIdFromRequest, findUserById } from '@/lib/auth'

/**
 * 管理员端：用户绑定管理
 * 
 * 功能：
 * - 将 OAuth 配置绑定到用户
 * - 将服务账号绑定到用户
 * - 查看用户的绑定状态
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
 * POST /api/admin/google-ads/oauth-config/:id/bind-user
 * 将 OAuth 配置绑定到用户
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
    const configId = params.id
    const body = await req.json()
    const { user_id } = body

    if (!user_id) {
      return NextResponse.json({ error: '缺少 user_id 字段' }, { status: 400 })
    }

    const db = getDatabase()

    // 检查 OAuth 配置是否存在
    const config = await db.queryOne(`
      SELECT * FROM google_ads_shared_oauth_configs 
      WHERE id = ? AND is_active = 1
    `, [configId])

    if (!config) {
      return NextResponse.json({ error: 'OAuth 配置不存在或已禁用' }, { status: 404 })
    }

    // 检查用户是否存在
    const user = await db.queryOne('SELECT id FROM users WHERE id = ?', [user_id])
    if (!user) {
      return NextResponse.json({ error: `用户 ${user_id} 不存在` }, { status: 404 })
    }

    // 检查是否已经绑定
    const existingBinding = await db.queryOne(`
      SELECT * FROM google_ads_user_oauth_bindings 
      WHERE user_id = ? AND oauth_config_id = ?
    `, [user_id, configId])

    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    const bindingId = crypto.randomUUID()

    if (existingBinding) {
      // 更新现有绑定
      await db.exec(`
        UPDATE google_ads_user_oauth_bindings 
        SET is_active = 1, needs_reauth = 1, updated_at = ${nowFunc}
        WHERE id = ?
      `, [existingBinding.id])
      
      return NextResponse.json({ 
        success: true,
        data: { 
          binding_id: existingBinding.id, 
          action: 'updated',
          needs_reauth: true 
        }
      })
    } else {
      // 创建新绑定
      await db.exec(`
        INSERT INTO google_ads_user_oauth_bindings (
          id, user_id, oauth_config_id, needs_reauth, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, 1, 1, ${nowFunc}, ${nowFunc})
      `, [bindingId, user_id, configId])

      return NextResponse.json({ 
        success: true,
        data: { 
          binding_id: bindingId,
          action: 'created',
          needs_reauth: true 
        }
      })
    }
  } catch (error: any) {
    console.error('[Admin OAuth Bind User] Error:', error)
    return NextResponse.json({ 
      error: '绑定用户失败',
      message: error.message 
    }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/google-ads/oauth-config/:id/unbind-user/:userId
 * 解除用户与 OAuth 配置的绑定
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
    const configId = params.id
    const userId = params.userId
    const db = getDatabase()

    await db.exec(`
      UPDATE google_ads_user_oauth_bindings 
      SET is_active = 0, updated_at = ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"}
      WHERE oauth_config_id = ? AND user_id = ?
    `, [configId, userId])

    return NextResponse.json({ 
      success: true,
      data: { config_id: configId, user_id: userId }
    })
  } catch (error: any) {
    console.error('[Admin OAuth Unbind User] Error:', error)
    return NextResponse.json({ 
      error: '解除绑定失败',
      message: error.message 
    }, { status: 500 })
  }
}

/**
 * GET /api/admin/google-ads/oauth-config/:id/bindings
 * 获取 OAuth 配置的所有用户绑定
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
    const configId = params.id
    const db = getDatabase()

    const bindings = await db.query(`
      SELECT 
        b.id,
        b.user_id,
        u.email as user_email,
        b.authorized_at,
        b.needs_reauth,
        b.is_active,
        b.created_at,
        b.updated_at
      FROM google_ads_user_oauth_bindings b
      LEFT JOIN users u ON b.user_id = u.id
      WHERE b.oauth_config_id = ?
      ORDER BY b.created_at DESC
    `, [configId])

    return NextResponse.json({ 
      success: true,
      data: { 
        config_id: configId,
        bindings,
        total: bindings.length,
        authorized: bindings.filter((b: any) => b.authorized_at).length,
        needs_reauth: bindings.filter((b: any) => b.needs_reauth && !b.authorized_at).length
      }
    })
  } catch (error: any) {
    console.error('[Admin OAuth Bindings GET] Error:', error)
    return NextResponse.json({ 
      error: '获取绑定列表失败',
      message: error.message 
    }, { status: 500 })
  }
}
