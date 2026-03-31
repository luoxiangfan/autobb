import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, createUser, generateUniqueUsername } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logUserCreated, UserManagementContext } from '@/lib/audit-logger'
import { buildAdminUsersOrderBy } from '@/lib/admin/users-query'
import { isExpiredOverDays } from '@/lib/user-execution-eligibility'

// 获取客户端IP地址
function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }
  const realIP = request.headers.get('x-real-ip')
  if (realIP) {
    return realIP
  }
  return 'unknown'
}

/**
 * 🔧 修复(2025-12-11): 转换数据库字段名为 camelCase
 * 🔧 修复(2025-12-30): 统一isActive为boolean类型（兼容PostgreSQL和SQLite）
 * 规范: API响应使用 camelCase，数据库字段使用 snake_case
 */
function transformUserToApiResponse(user: any, now: Date) {
  const isActive = user.is_active === true || user.is_active === 1
  const disableSuggested = isActive && isExpiredOverDays(user.package_expires_at, 30, now)

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    packageType: user.package_type,
    packageExpiresAt: user.package_expires_at,
    // PostgreSQL返回boolean，SQLite返回0/1，统一转为boolean
    isActive,
    openclawEnabled: user.openclaw_enabled === true || user.openclaw_enabled === 1,
    productManagementEnabled: user.product_management_enabled === true || user.product_management_enabled === 1,
    strategyCenterEnabled: user.strategy_center_enabled === true || user.strategy_center_enabled === 1,
    disableSuggested,
    disableSuggestedReason: disableSuggested ? 'expired_over_30d' : null,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
    lockedUntil: user.locked_until,
    failedLoginCount: user.failed_login_count
  }
}

// GET: List all users (paginated)
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const offset = (page - 1) * limit

    const db = getDatabase()
    const likeOperator = db.type === 'postgres' ? 'ILIKE' : 'LIKE'

    const sortBy = (searchParams.get('sortBy') || 'createdAt') as string
    const sortOrderRaw = (searchParams.get('sortOrder') || 'desc').toLowerCase()
    const sortOrder = sortOrderRaw === 'asc' ? 'ASC' : 'DESC'

    let query = `
      SELECT
        id,
        username,
        email,
        display_name,
        role,
        package_type,
        package_expires_at,
        is_active,
        openclaw_enabled,
        product_management_enabled,
        strategy_center_enabled,
        last_login_at,
        created_at,
        locked_until,
        failed_login_count
      FROM users
      WHERE 1=1
    `
    let countQuery = `SELECT COUNT(*) as count FROM users WHERE 1=1`
    const params: any[] = []

    // Search filter
    const search = (searchParams.get('search') || '').trim()
    if (search) {
      const searchCondition = ` AND (username ${likeOperator} ? OR email ${likeOperator} ?)`
      query += searchCondition
      countQuery += searchCondition
      params.push(`%${search}%`, `%${search}%`)
    }

    // Role filter
    const role = searchParams.get('role')
    if (role && role !== 'all') {
      const roleCondition = ` AND role = ?`
      query += roleCondition
      countQuery += roleCondition
      params.push(role)
    }

    // Status filter
    const status = searchParams.get('status')
    if (status && status !== 'all') {
      const statusCondition = ` AND is_active = ?`
      query += statusCondition
      countQuery += statusCondition
      // 🔧 修复(2025-12-30): PostgreSQL兼容性 - 发送boolean值
      params.push(db.type === 'postgres' ? (status === 'active') : (status === 'active' ? 1 : 0))
    }

    // Package type filter
    const packageType = searchParams.get('package')
    if (packageType && packageType !== 'all') {
      const packageCondition = ` AND package_type = ?`
      query += packageCondition
      countQuery += packageCondition
      params.push(packageType)
    }

    const orderBy = buildAdminUsersOrderBy({
      sortBy,
      sortOrder,
      dbType: db.type,
    })

    // Pagination + sorting (ORDER BY validated above)
    query += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`

    // Get total count
    const total = await db.queryOne(countQuery, [...params]) as { count: number }

    // Get users
    const users = await db.query(query, [...params, limit, offset])

    const now = new Date()

    return NextResponse.json({
      users: users.map((user) => transformUserToApiResponse(user, now)),
      pagination: {
        total: total.count,
        page,
        limit,
        totalPages: Math.ceil(total.count / limit)
      }
    })
  } catch (error: any) {
    console.error('[admin/users] list users failed', {
      message: error?.message || String(error),
      stack: error?.stack,
    })
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 })
  }
}

// POST: Create new user
export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      username,
      displayName,
      email,
      packageType,
      packageExpiresAt,
      validUntil, // 前端可能发送此字段
      role
    } = body

    // 支持前端发送 validUntil 或 packageExpiresAt
    const expiresAt = packageExpiresAt || validUntil

    if (!expiresAt) {
      return NextResponse.json({ error: 'Package expiry date is required' }, { status: 400 })
    }

    // Default password: auto11@20ads
    const defaultPassword = 'auto11@20ads'

    // 如果提供了username，检查是否已存在
    if (username) {
      const db = getDatabase()
      const existingUser = await db.queryOne('SELECT id FROM users WHERE username = ?', [username])
      if (existingUser) {
        return NextResponse.json({ error: '用户名已存在，请重新生成' }, { status: 400 })
      }
    }

    const newUser = await createUser({
      username: username || undefined, // 让createUser自动生成
      displayName: displayName || undefined,
      email: email || undefined, // 可选字段
      password: defaultPassword,
      role: role || 'user',
      packageType: packageType || 'trial',
      packageExpiresAt: expiresAt,
      mustChangePassword: 1 // Force password change
    })

    // 获取操作者的username（从数据库查询）
    const db = getDatabase()
    const operator = await db.queryOne('SELECT username FROM users WHERE id = ?', [auth.user!.userId]) as { username: string } | undefined

    // 记录审计日志
    const auditContext: UserManagementContext = {
      operatorId: auth.user!.userId,
      operatorUsername: operator?.username || `user_${auth.user!.userId}`,
      targetUserId: newUser.id,
      targetUsername: newUser.username || `user_${newUser.id}`,
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent') || 'Unknown',
    }
    await logUserCreated(auditContext, {
      id: newUser.id,
      username: newUser.username,
      email: newUser.email,
      display_name: newUser.display_name, // 使用snake_case字段名
      role: newUser.role,
      package_type: newUser.package_type, // 使用snake_case字段名
      package_expires_at: newUser.package_expires_at, // 使用snake_case字段名
    })

    return NextResponse.json({
      success: true,
      data: {
        user: newUser,
        defaultPassword // Return this so admin can share it with the user
      }
    })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
