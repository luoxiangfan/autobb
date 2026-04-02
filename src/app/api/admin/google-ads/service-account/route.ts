import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { getUserIdFromRequest, findUserById } from '@/lib/auth'
import { parseServiceAccountJson } from '@/lib/google-ads-service-account'

/**
 * 管理员端：服务账号管理
 * 
 * 功能：
 * - 创建共享服务账号配置
 * - 将服务账号绑定到用户
 * - 查看绑定状态
 */

async function getAdminUser(request: NextRequest) {
  const userId = getUserIdFromRequest(request)
  if (!userId) return null
  
  const user = await findUserById(userId)
  // TODO: 添加管理员权限检查
  // if (!user?.is_admin) return null
  
  return user
}

/**
 * POST /api/admin/google-ads/service-account
 * 创建共享服务账号配置
 */
export async function POST(req: NextRequest) {
  const admin = await getAdminUser(req)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { name, description, mcc_customer_id, developer_token, service_account_json } = body

    // 验证必填字段
    if (!name || !mcc_customer_id || !developer_token || !service_account_json) {
      return NextResponse.json({ 
        error: '缺少必填字段',
        required: ['name', 'mcc_customer_id', 'developer_token', 'service_account_json']
      }, { status: 400 })
    }

    // 解析服务账号 JSON
    const { clientEmail, privateKey, projectId } = parseServiceAccountJson(service_account_json)
    const encryptedPrivateKey = encrypt(privateKey)
    const encryptedDeveloperToken = encrypt(developer_token)

    const db = getDatabase()
    const id = crypto.randomUUID()
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    await db.exec(`
      INSERT INTO google_ads_service_accounts (
        id, user_id, name, description, mcc_customer_id, developer_token,
        service_account_email, private_key, project_id, is_shared, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ${nowFunc}, ${nowFunc})
    `, [
      id, admin.id, name, description || null, mcc_customer_id, 
      encryptedDeveloperToken, clientEmail, encryptedPrivateKey, projectId
    ])

    console.log(`[Admin Service Account] 管理员 ${admin.id} 创建了服务账号：${id}`)

    return NextResponse.json({ 
      success: true,
      data: { id, name, mcc_customer_id, service_account_email: clientEmail }
    })
  } catch (error: any) {
    console.error('[Admin Service Account POST] Error:', error)
    return NextResponse.json({ 
      error: '创建服务账号失败',
      message: error.message 
    }, { status: 500 })
  }
}

/**
 * GET /api/admin/google-ads/service-account
 * 获取所有共享服务账号列表
 */
export async function GET(req: NextRequest) {
  const admin = await getAdminUser(req)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 401 })
  }

  try {
    const db = getDatabase()
    const accounts = await db.query(`
      SELECT 
        sa.id,
        sa.name,
        sa.description,
        sa.mcc_customer_id,
        sa.service_account_email,
        sa.is_shared,
        sa.is_active,
        sa.created_at,
        sa.updated_at,
        COUNT(DISTINCT b.user_id) as bound_users_count
      FROM google_ads_service_accounts sa
      LEFT JOIN google_ads_user_sa_bindings b ON sa.id = b.service_account_id AND b.is_active = 1
      WHERE sa.is_shared = 1
      GROUP BY sa.id
      ORDER BY sa.created_at DESC
    `, [])

    return NextResponse.json({ 
      success: true,
      data: { accounts }
    })
  } catch (error: any) {
    console.error('[Admin Service Account GET] Error:', error)
    return NextResponse.json({ 
      error: '获取服务账号列表失败',
      message: error.message 
    }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/google-ads/service-account/:id
 * 删除服务账号（软删除）
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminUser(req)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 401 })
  }

  try {
    const serviceAccountId = params.id
    const db = getDatabase()

    // 检查是否有活跃的用户绑定
    const bindings = await db.queryOne(`
      SELECT COUNT(*) as count FROM google_ads_user_sa_bindings 
      WHERE service_account_id = ? AND is_active = 1
    `, [serviceAccountId])

    if (bindings && (bindings as any).count > 0) {
      return NextResponse.json({ 
        error: `无法删除服务账号，仍有 ${(bindings as any).count} 个用户绑定`,
        code: 'HAS_ACTIVE_BINDINGS'
      }, { status: 400 })
    }

    // 软删除
    await db.exec(`
      UPDATE google_ads_service_accounts 
      SET is_active = 0, is_shared = 0, updated_at = ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"}
      WHERE id = ?
    `, [serviceAccountId])

    console.log(`[Admin Service Account] 管理员 ${admin.id} 删除了服务账号：${serviceAccountId}`)

    return NextResponse.json({ 
      success: true,
      data: { id: serviceAccountId }
    })
  } catch (error: any) {
    console.error('[Admin Service Account DELETE] Error:', error)
    return NextResponse.json({ 
      error: '删除服务账号失败',
      message: error.message 
    }, { status: 500 })
  }
}
