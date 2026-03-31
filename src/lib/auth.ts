import { NextRequest } from 'next/server'
import { getDatabase } from './db'
import { hashPassword, verifyPassword } from './crypto'
import { generateToken, JWTPayload, verifyToken } from './jwt'
import { getInsertedId } from './db-helpers'
import {
  recordFailedLogin,
  resetFailedAttempts,
  logLoginAttempt,
} from './auth-security'

export interface User {
  id: number
  username: string | null
  email: string
  password_hash: string | null
  display_name: string | null
  google_id: string | null
  profile_picture: string | null
  role: string
  package_type: string
  package_expires_at: string | null
  must_change_password: number
  is_active: number
  openclaw_enabled: number | boolean
  product_management_enabled?: number | boolean
  strategy_center_enabled?: number | boolean
  last_login_at: string | null
  created_at: string
  updated_at: string
  // P0安全增强字段
  failed_login_count: number
  locked_until: string | null
  last_failed_login: string | null
}

export interface CreateUserInput {
  username?: string
  email?: string // 可选，支持无邮箱的用户创建
  password?: string
  displayName?: string
  googleId?: string
  profilePicture?: string
  role?: string
  packageType?: string
  packageExpiresAt?: string
  mustChangePassword?: number
}

export interface LoginResponse {
  token: string
  user: {
    id: number
    username: string | null
    email: string
    displayName: string | null
    role: string
    packageType: string
    packageExpiresAt: string | null
  }
  mustChangePassword?: boolean
}

/**
 * 通过邮箱查找用户
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const db = await getDatabase()
  const user = await db.queryOne<User>('SELECT * FROM users WHERE email = ?', [email])
  return user || null
}

/**
 * 通过用户名查找用户
 */
export async function findUserByUsername(username: string): Promise<User | null> {
  const db = await getDatabase()
  const user = await db.queryOne<User>('SELECT * FROM users WHERE username = ?', [username])
  return user || null
}

/**
 * 通过用户名或邮箱查找用户
 */
export async function findUserByUsernameOrEmail(usernameOrEmail: string): Promise<User | null> {
  const db = await getDatabase()
  const user = await db.queryOne<User>('SELECT * FROM users WHERE username = ? OR email = ?', [usernameOrEmail, usernameOrEmail])
  return user || null
}

/**
 * 通过Google ID查找用户
 */
export async function findUserByGoogleId(googleId: string): Promise<User | null> {
  const db = await getDatabase()
  const user = await db.queryOne<User>('SELECT * FROM users WHERE google_id = ?', [googleId])
  return user || null
}

/**
 * 通过ID查找用户
 */
export async function findUserById(id: number): Promise<User | null> {
  const db = await getDatabase()
  const user = await db.queryOne<User>('SELECT * FROM users WHERE id = ?', [id])
  return user || null
}

/**
 * 生成唯一的动物用户名 (8-12位)
 */
export async function generateUniqueUsername(): Promise<string> {
  const animals = ['panda', 'tiger', 'lion', 'eagle', 'shark', 'wolf', 'bear', 'hawk', 'fox', 'owl', 'deer', 'cat', 'dog', 'fish']
  const adjectives = ['fast', 'brave', 'wise', 'calm', 'wild', 'cool', 'kind', 'bold', 'epic', 'rare']

  let username = ''
  let isUnique = false
  const db = await getDatabase()

  while (!isUnique) {
    const animal = animals[Math.floor(Math.random() * animals.length)]
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)]
    const num = Math.floor(Math.random() * 1000).toString().padStart(3, '0')

    // 组合: adj + animal + num (e.g., wiseowl123)
    // 确保长度在 8-12 之间
    let temp = `${adjective}${animal}${num}`
    if (temp.length > 12) {
      temp = `${animal}${num}` // fallback
    }
    if (temp.length < 8) {
      temp = `${adjective}${animal}${num}9` // padding
    }

    username = temp.substring(0, 12) // truncate to max 12

    const existing = await db.queryOne('SELECT id FROM users WHERE username = ?', [username])
    if (!existing) {
      isUnique = true
    }
  }
  return username
}

/**
 * 创建新用户
 */
export async function createUser(input: CreateUserInput): Promise<User> {
  const db = await getDatabase()

  // 如果提供了邮箱，检查是否已存在
  if (input.email) {
    const existingUser = await findUserByEmail(input.email)
    if (existingUser) {
      throw new Error('该邮箱已被注册')
    }
  }

  // 如果提供了密码，进行哈希处理
  let passwordHash: string | null = null
  if (input.password) {
    passwordHash = await hashPassword(input.password)
  }

  // 如果没有提供用户名，自动生成
  const username = input.username || await generateUniqueUsername()
  const role = input.role || 'user'
  const shouldEnableOpenclaw = role === 'admin'
  const shouldEnableProducts = role === 'admin'
  const shouldEnableStrategyCenter = role === 'admin'
  const openclawEnabledValue = db.type === 'postgres'
    ? shouldEnableOpenclaw
    : (shouldEnableOpenclaw ? 1 : 0)
  const productManagementEnabledValue = db.type === 'postgres'
    ? shouldEnableProducts
    : (shouldEnableProducts ? 1 : 0)
  const strategyCenterEnabledValue = db.type === 'postgres'
    ? shouldEnableStrategyCenter
    : (shouldEnableStrategyCenter ? 1 : 0)

  const result = await db.exec(`
    INSERT INTO users (
      username, email, password_hash, display_name, google_id, profile_picture, role, package_type, package_expires_at, must_change_password, openclaw_enabled, product_management_enabled, strategy_center_enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    username,
    input.email || null, // email 可以为 null
    passwordHash,
    input.displayName || null,
    input.googleId || null,
    input.profilePicture || null,
    role,
    input.packageType || 'trial',
    input.packageExpiresAt || null,
    input.mustChangePassword !== undefined ? input.mustChangePassword : 1,
    openclawEnabledValue,
    productManagementEnabledValue,
    strategyCenterEnabledValue,
  ])

  // 从INSERT结果中提取ID（兼容PostgreSQL和SQLite）
  const insertedId = getInsertedId(result, db.type)

  const user = await findUserById(insertedId)
  if (!user) {
    throw new Error('用户创建失败')
  }

  return user
}

/**
 * 更新用户最后登录时间
 */
export async function updateLastLogin(userId: number): Promise<void> {
  const db = await getDatabase()
  const db_type = db.type
  const nowFunc = db_type === 'postgres' ? 'NOW()' : 'datetime(\'now\')'
  await db.exec(`UPDATE users SET last_login_at = ${nowFunc} WHERE id = ?`, [userId])
}

/**
 * 用户名/邮箱密码登录（增强安全版本）
 *
 * @param usernameOrEmail 用户名或邮箱
 * @param password 密码
 * @param ipAddress 客户端IP地址（用于日志记录）
 * @param userAgent 客户端User-Agent（用于日志记录）
 */
export async function loginWithPassword(
  usernameOrEmail: string,
  password: string,
  ipAddress: string = 'unknown',
  userAgent: string = 'unknown'
): Promise<LoginResponse> {
  const user = await findUserByUsernameOrEmail(usernameOrEmail)

  // P1修复：统一错误消息，防止账户枚举
  if (!user) {
    await logLoginAttempt(usernameOrEmail, ipAddress, userAgent, false, '用户不存在')
    throw new Error('用户名或密码错误')
  }

  // 检查账户是否被禁用（3次登录失败会禁用账户）
  if (!user.is_active) {
    await logLoginAttempt(usernameOrEmail, ipAddress, userAgent, false, '账户已禁用')
    throw new Error('账户已被禁用，请联系管理员启用')
  }

  if (!user.password_hash) {
    await logLoginAttempt(usernameOrEmail, ipAddress, userAgent, false, '未设置密码')
    throw new Error('该账户未设置密码')
  }

  // 检查套餐有效期
  if (user.package_expires_at) {
    const expiryDate = new Date(user.package_expires_at)
    if (expiryDate < new Date()) {
      await logLoginAttempt(usernameOrEmail, ipAddress, userAgent, false, '套餐已过期')
      throw new Error('套餐已过期，请购买或升级套餐')
    }
  }

  // 验证密码
  const isValid = await verifyPassword(password, user.password_hash)
  if (!isValid) {
    // P0：记录失败登录，并在达到阈值时锁定账户
    await recordFailedLogin(user.id, ipAddress, userAgent)
    await logLoginAttempt(usernameOrEmail, ipAddress, userAgent, false, '密码错误')
    // P1修复：统一错误消息
    throw new Error('用户名或密码错误')
  }

  // 登录成功 - P0：重置失败计数
  await resetFailedAttempts(user.id)
  await logLoginAttempt(usernameOrEmail, ipAddress, userAgent, true)

  // 更新最后登录时间
  await updateLastLogin(user.id)

  // 管理员账号不强制修改密码（避免开发/运维默认管理员被锁死在改密流程）
  const mustChangePassword = user.role !== 'admin' && !!user.must_change_password

  // 生成JWT token (包含强制修改密码标志)
  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    packageType: user.package_type,
    mustChangePassword,
  })

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      packageType: user.package_type,
      packageExpiresAt: user.package_expires_at
    },
    mustChangePassword,
  }
}

/**
 * Google OAuth登录或注册
 */
export async function loginWithGoogle(googleProfile: {
  id: string
  email: string
  name?: string
  picture?: string
}): Promise<LoginResponse> {
  let user = await findUserByGoogleId(googleProfile.id)

  // 如果用户不存在，创建新用户
  if (!user) {
    // 检查邮箱是否已被其他账户使用
    const existingUser = await findUserByEmail(googleProfile.email)
    if (existingUser) {
      // 绑定Google ID到现有账户
      const db = await getDatabase()
      const db_type = db.type
      const nowFunc = db_type === 'postgres' ? 'NOW()' : 'datetime(\'now\')'
      await db.exec(`
        UPDATE users
        SET google_id = ?, profile_picture = ?, updated_at = ${nowFunc}
        WHERE id = ?
      `, [googleProfile.id, googleProfile.picture || null, existingUser.id])

      user = await findUserById(existingUser.id)
    } else {
      // 创建新用户
      user = await createUser({
        email: googleProfile.email,
        googleId: googleProfile.id,
        displayName: googleProfile.name,
        profilePicture: googleProfile.picture,
        mustChangePassword: 0 // Google login doesn't need password change
      })
    }
  }

  if (!user) {
    throw new Error('登录失败')
  }

  if (!user.is_active) {
    throw new Error('账户已被禁用')
  }

  // 检查套餐有效期
  if (user.package_expires_at) {
    const expiryDate = new Date(user.package_expires_at)
    if (expiryDate < new Date()) {
      throw new Error('套餐已过期，请购买或升级套餐')
    }
  }

  // 更新最后登录时间
  await updateLastLogin(user.id)

  // 管理员账号不强制修改密码（与用户名密码登录保持一致）
  const mustChangePassword = user.role !== 'admin' && !!user.must_change_password

  // 生成JWT token (包含强制修改密码标志)
  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    packageType: user.package_type,
    mustChangePassword,
  })

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      packageType: user.package_type,
      packageExpiresAt: user.package_expires_at
    },
    mustChangePassword,
  }
}

/**
 * 验证用户套餐权限
 */
export function checkPackageAccess(user: User, requiredPackage: string): boolean {
  const packageLevels = {
    trial: 0,
    annual: 1,
    lifetime: 2,
    enterprise: 3,
  }

  const userLevel = packageLevels[user.package_type as keyof typeof packageLevels] || 0
  const requiredLevel = packageLevels[requiredPackage as keyof typeof packageLevels] || 0

  // 检查套餐是否过期
  if (user.package_expires_at) {
    const expiryDate = new Date(user.package_expires_at)
    if (expiryDate < new Date()) {
      return false
    }
  }

  return userLevel >= requiredLevel
}

/**
 * 验证API请求的认证状态
 */
export interface AuthResult {
  authenticated: boolean
  user: {
    userId: number
    email: string
    role: string
    packageType: string
  } | null
  error?: string
}

export async function verifyAuth(request: NextRequest): Promise<AuthResult> {
  try {
    // 从Cookie读取token（HttpOnly Cookie方式）
    const token = request.cookies.get('auth_token')?.value

    if (!token) {
      return {
        authenticated: false,
        user: null,
        error: '未提供认证token',
      }
    }

    // 验证token
    const payload = verifyToken(token)
    if (!payload) {
      return {
        authenticated: false,
        user: null,
        error: 'Token无效或已过期',
      }
    }

    // 验证用户是否存在且激活
    const user = await findUserById(payload.userId)
    if (!user) {
      return {
        authenticated: false,
        user: null,
        error: '用户不存在',
      }
    }

    if (!user.is_active) {
      return {
        authenticated: false,
        user: null,
        error: '账户已被禁用',
      }
    }

    // 检查套餐有效期
    if (user.package_expires_at) {
      const expiryDate = new Date(user.package_expires_at)
      if (expiryDate < new Date()) {
        return {
          authenticated: false,
          user: null,
          error: '套餐已过期',
        }
      }
    }

    return {
      authenticated: true,
      user: {
        userId: user.id,
        email: user.email,
        role: user.role,
        packageType: user.package_type,
      },
    }
  } catch (error: any) {
    console.error('认证验证失败:', error)
    return {
      authenticated: false,
      user: null,
      error: error.message || '认证失败',
    }
  }
}

/**
 * 认证用户信息接口
 */
export interface AuthenticatedUser {
  userId: number
  email: string
  role: string
  packageType: string
}

/**
 * API处理函数类型
 */
export type AuthenticatedHandler = (
  request: NextRequest,
  user: AuthenticatedUser,
  context?: { params?: Record<string, string> }
) => Promise<Response>

/**
 * withAuth 高阶函数 - 统一API认证检查
 *
 * 用法:
 * ```typescript
 * export const GET = withAuth(async (request, user) => {
 *   // user.userId, user.email, user.role, user.packageType 可用
 *   return NextResponse.json({ data: 'success' })
 * })
 *
 * // 需要管理员权限
 * export const POST = withAuth(async (request, user) => {
 *   return NextResponse.json({ data: 'admin only' })
 * }, { requireAdmin: true })
 * ```
 */
export function withAuth(
  handler: AuthenticatedHandler,
  options?: {
    requireAdmin?: boolean
  }
) {
  return async (request: NextRequest, context?: { params?: Record<string, string> }): Promise<Response> => {
    const { NextResponse } = await import('next/server')

    const authResult = await verifyAuth(request)

    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: authResult.error || '未授权' },
        { status: 401 }
      )
    }

    // 检查管理员权限
    if (options?.requireAdmin && authResult.user.role !== 'admin') {
      return NextResponse.json(
        { error: '需要管理员权限' },
        { status: 403 }
      )
    }

    try {
      return await handler(request, authResult.user, context)
    } catch (error: any) {
      console.error('API处理错误:', error)
      return NextResponse.json(
        { error: error.message || '服务器内部错误' },
        { status: 500 }
      )
    }
  }
}

/**
 * getUserIdFromRequest - 从请求中快速获取用户ID
 *
 * 优先从中间件注入的header获取，降级到verifyAuth
 * 用于不需要完整用户信息的场景
 */
export function getUserIdFromRequest(request: NextRequest): number | null {
  const userIdHeader = request.headers.get('x-user-id')
  if (userIdHeader) {
    const userId = parseInt(userIdHeader, 10)
    if (!isNaN(userId)) {
      return userId
    }
  }
  return null
}

/**
 * requireUserId - 获取用户ID，未登录则抛出错误
 */
export function requireUserId(request: NextRequest): number {
  const userId = getUserIdFromRequest(request)
  if (!userId) {
    throw new Error('未授权，请先登录')
  }
  return userId
}
