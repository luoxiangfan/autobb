import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/crypto'
import { getUserIdFromRequest, findUserById } from '@/lib/auth'

/**
 * 管理员端：Google Ads 共享 OAuth 配置管理
 * 
 * 功能：
 * - 创建、读取、更新、删除 OAuth 配置
 * - 将配置绑定到用户
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
 * GET /api/admin/google-ads/oauth-config
 * 获取所有共享 OAuth 配置列表
 */
export async function GET(req: NextRequest) {
  const admin = await getAdminUser(req)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 401 })
  }

  try {
    const db = getDatabase()
    const configs = await db.query(`
      SELECT 
        c.id,
        c.name,
        c.description,
        c.client_id,
        c.login_customer_id,
        c.is_active,
        c.version,
        c.created_by,
        c.created_at,
        c.updated_at,
        COUNT(DISTINCT b.user_id) as bound_users_count
      FROM google_ads_shared_oauth_configs c
      LEFT JOIN google_ads_user_oauth_bindings b ON c.id = b.oauth_config_id AND b.is_active = 1
      WHERE c.is_active = 1 OR c.is_active = 0
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `, [])

    return NextResponse.json({ 
      success: true,
      data: { configs }
    })
  } catch (error: any) {
    console.error('[Admin OAuth Config GET] Error:', error)
    return NextResponse.json({ 
      error: '获取配置列表失败',
      message: error.message 
    }, { status: 500 })
  }
}

/**
 * POST /api/admin/google-ads/oauth-config
 * 创建新的共享 OAuth 配置
 */
export async function POST(req: NextRequest) {
  const admin = await getAdminUser(req)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { name, description, client_id, client_secret, developer_token, login_customer_id } = body

    // 验证必填字段
    if (!name || !client_id || !client_secret || !developer_token || !login_customer_id) {
      return NextResponse.json({ 
        error: '缺少必填字段',
        required: ['name', 'client_id', 'client_secret', 'developer_token', 'login_customer_id']
      }, { status: 400 })
    }

    // 验证 Login Customer ID 格式（10 位数字）
    const loginCustomerIdRegex = /^\d{10}$/
    if (!loginCustomerIdRegex.test(login_customer_id.replace(/-/g, ''))) {
      return NextResponse.json({ 
        error: 'Login Customer ID 格式不正确，应为 10 位数字'
      }, { status: 400 })
    }

    const db = getDatabase()
    const id = crypto.randomUUID()
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    
    // 加密敏感信息
    const encryptedClientSecret = encrypt(client_secret)
    const encryptedDeveloperToken = encrypt(developer_token)

    await db.exec(`
      INSERT INTO google_ads_shared_oauth_configs (
        id, name, description, client_id, client_secret, developer_token, 
        login_customer_id, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})
    `, [id, name, description || null, client_id, encryptedClientSecret, 
        encryptedDeveloperToken, login_customer_id.replace(/-/g, ''), admin.id])

    console.log(`[Admin OAuth Config] 管理员 ${admin.id} 创建了 OAuth 配置：${id}`)

    return NextResponse.json({ 
      success: true,
      data: { id, name, client_id, login_customer_id }
    })
  } catch (error: any) {
    console.error('[Admin OAuth Config POST] Error:', error)
    return NextResponse.json({ 
      error: '创建配置失败',
      message: error.message 
    }, { status: 500 })
  }
}

/**
 * PUT /api/admin/google-ads/oauth-config/:id
 * 更新现有的 OAuth 配置
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminUser(req)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 401 })
  }

  try {
    const configId = params.id
    const body = await req.json()
    const { name, description, client_id, client_secret, developer_token, login_customer_id } = body

    const db = getDatabase()
    
    // 检查配置是否存在
    const existingConfig = await db.queryOne(`
      SELECT * FROM google_ads_shared_oauth_configs WHERE id = ?
    `, [configId])

    if (!existingConfig) {
      return NextResponse.json({ error: '配置不存在' }, { status: 404 })
    }

    // 构建更新字段
    const updateFields: string[] = []
    const updateValues: any[] = []

    if (name !== undefined) {
      updateFields.push('name = ?')
      updateValues.push(name)
    }
    if (description !== undefined) {
      updateFields.push('description = ?')
      updateValues.push(description)
    }
    if (client_id !== undefined) {
      updateFields.push('client_id = ?')
      updateValues.push(client_id)
    }
    if (client_secret !== undefined) {
      updateFields.push('client_secret = ?')
      updateValues.push(encrypt(client_secret))
    }
    if (developer_token !== undefined) {
      updateFields.push('developer_token = ?')
      updateValues.push(encrypt(developer_token))
    }
    if (login_customer_id !== undefined) {
      const loginCustomerId = login_customer_id.replace(/-/g, '')
      // 验证格式
      const loginCustomerIdRegex = /^\d{10}$/
      if (!loginCustomerIdRegex.test(loginCustomerId)) {
        return NextResponse.json({ 
          error: 'Login Customer ID 格式不正确，应为 10 位数字'
        }, { status: 400 })
      }
      updateFields.push('login_customer_id = ?')
      updateValues.push(loginCustomerId)
    }

    // 如果修改了关键配置（client_id, client_secret, developer_token），需要标记用户重新授权
    const needsReauth = (client_id !== undefined || client_secret !== undefined || developer_token !== undefined)
    
    if (needsReauth) {
      updateFields.push('version = version + 1')
    }

    updateFields.push('last_modified_at = ' + (db.type === 'postgres' ? 'NOW()' : "datetime('now')"))
    updateFields.push('updated_at = ' + (db.type === 'postgres' ? 'NOW()' : "datetime('now')"))

    if (updateFields.length === 0) {
      return NextResponse.json({ error: '没有要更新的字段' }, { status: 400 })
    }

    updateValues.push(configId)

    await db.exec(`
      UPDATE google_ads_shared_oauth_configs 
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `, updateValues)

    // 如果需要重新授权，更新所有绑定用户的 needs_reauth 标志
    if (needsReauth) {
      await db.exec(`
        UPDATE google_ads_user_oauth_bindings 
        SET needs_reauth = 1, updated_at = ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"}
        WHERE oauth_config_id = ? AND is_active = 1
      `, [configId])
      
      console.log(`[Admin OAuth Config] 配置 ${configId} 已更新，标记所有绑定用户需要重新授权`)
    }

    console.log(`[Admin OAuth Config] 管理员 ${admin.id} 更新了 OAuth 配置：${configId}`)

    return NextResponse.json({ 
      success: true,
      data: { id: configId, needs_reauth: needsReauth }
    })
  } catch (error: any) {
    console.error('[Admin OAuth Config PUT] Error:', error)
    return NextResponse.json({ 
      error: '更新配置失败',
      message: error.message 
    }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/google-ads/oauth-config/:id
 * 删除 OAuth 配置（软删除，设置 is_active = 0）
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminUser(req)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 401 })
  }

  try {
    const configId = params.id
    const db = getDatabase()

    // 检查是否有活跃的用户绑定
    const bindings = await db.queryOne(`
      SELECT COUNT(*) as count FROM google_ads_user_oauth_bindings 
      WHERE oauth_config_id = ? AND is_active = 1
    `, [configId])

    if (bindings && (bindings as any).count > 0) {
      return NextResponse.json({ 
        error: `无法删除配置，仍有 ${(bindings as any).count} 个用户绑定`,
        code: 'HAS_ACTIVE_BINDINGS'
      }, { status: 400 })
    }

    // 软删除
    await db.exec(`
      UPDATE google_ads_shared_oauth_configs 
      SET is_active = 0, updated_at = ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"}
      WHERE id = ?
    `, [configId])

    console.log(`[Admin OAuth Config] 管理员 ${admin.id} 删除了 OAuth 配置：${configId}`)

    return NextResponse.json({ 
      success: true,
      data: { id: configId }
    })
  } catch (error: any) {
    console.error('[Admin OAuth Config DELETE] Error:', error)
    return NextResponse.json({ 
      error: '删除配置失败',
      message: error.message 
    }, { status: 500 })
  }
}
