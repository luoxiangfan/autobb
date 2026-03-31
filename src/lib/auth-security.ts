/**
 * 登录安全机制 - 暴力破解保护
 *
 * 功能:
 * - 登录失败计数
 * - 账户自动禁用（3次失败后禁用，需管理员手动启用）
 * - 登录尝试日志记录
 */

import { getDatabase } from './db'
import { logAuditEvent, AuditEventType } from './audit-logger'
import { boolParam } from './db-helpers'

// 安全配置
const MAX_FAILED_ATTEMPTS = 3 // 最大失败尝试次数（3次后禁用账户）

/**
 * 记录登录失败，并在达到阈值时禁用账户
 */
export async function recordFailedLogin(
  userId: number,
  ipAddress: string = 'unknown',
  userAgent: string = 'unknown'
): Promise<void> {
  const db = await getDatabase()
  const db_type = db.type

  // 增加失败计数
  const nowFunc = db_type === 'postgres' ? 'NOW()' : "datetime('now')"
  await db.exec(
    `
    UPDATE users
    SET failed_login_count = failed_login_count + 1,
        last_failed_login = ${nowFunc}
    WHERE id = ?
  `,
    [userId]
  )

  // 检查是否需要禁用账户
  const user = (await db.queryOne(
    'SELECT failed_login_count FROM users WHERE id = ?',
    [userId]
  )) as { failed_login_count: number } | null

  if (user && user.failed_login_count >= MAX_FAILED_ATTEMPTS) {
    // 禁用账户（需要管理员手动启用）
    await db.exec(
      `
      UPDATE users
      SET is_active = ?
      WHERE id = ?
    `,
      [boolParam(false, db.type), userId]
    )

    console.warn(
      `[Security] User ${userId} DISABLED due to ${MAX_FAILED_ATTEMPTS} failed login attempts (requires admin to re-enable)`
    )

    // 记录账户禁用事件
    await logAuditEvent({
      userId,
      eventType: AuditEventType.ACCOUNT_LOCKED, // 复用事件类型
      ipAddress,
      userAgent,
      details: {
        reason: 'max_failed_attempts_exceeded_disabled',
        failed_attempts: user.failed_login_count,
        action: 'account_disabled_requires_admin',
      },
    })
  }
}

/**
 * 重置失败尝试计数（登录成功时调用）
 */
export async function resetFailedAttempts(userId: number): Promise<void> {
  const db = await getDatabase()
  await db.exec(
    `
    UPDATE users
    SET failed_login_count = 0,
        last_failed_login = NULL
    WHERE id = ?
  `,
    [userId]
  )
}

/**
 * 记录登录尝试到audit表
 *
 * @param usernameOrEmail 用户名或邮箱
 * @param ipAddress 客户端IP地址
 * @param userAgent 客户端User-Agent
 * @param success 是否登录成功
 * @param failureReason 失败原因（可选）
 */
export async function logLoginAttempt(
  usernameOrEmail: string,
  ipAddress: string,
  userAgent: string,
  success: boolean,
  failureReason?: string
): Promise<void> {
  const db = await getDatabase()
  const db_type = db.type

  try {
    // PostgreSQL使用布尔值，SQLite使用整数
    const successValue = db_type === 'postgres' ? success : success ? 1 : 0
    await db.exec(
      `
      INSERT INTO login_attempts (username_or_email, ip_address, user_agent, success, failure_reason)
      VALUES (?, ?, ?, ?, ?)
    `,
      [usernameOrEmail, ipAddress, userAgent, successValue, failureReason || null]
    )
  } catch (error) {
    console.error('[Security] Failed to log login attempt:', error)
    // 不抛出错误，避免影响登录流程
  }
}

/**
 * 获取最近的失败登录尝试（用于分析攻击模式）
 */
export async function getRecentFailedAttempts(
  hours: number = 1,
  limit: number = 100
): Promise<
  Array<{
    username_or_email: string
    ip_address: string
    user_agent: string
    failure_reason: string
    attempted_at: string
  }>
> {
  const db = await getDatabase()
  const db_type = db.type
  const timeCondition =
    db_type === 'postgres'
      ? `attempted_at > NOW() - INTERVAL '${hours} hours'`
      : `attempted_at > datetime('now', '-${hours} hours')`

  return (await db.query(
    `
    SELECT username_or_email, ip_address, user_agent, failure_reason, attempted_at
    FROM login_attempts
    WHERE success = ?
      AND ${timeCondition}
    ORDER BY attempted_at DESC
    LIMIT ?
  `,
    [boolParam(false, db.type), limit]
  )) as any[]
}

/**
 * 获取当前被禁用的账户列表（管理员功能）
 */
export async function getDisabledAccounts(): Promise<
  Array<{
    id: number
    username: string | null
    email: string
    failed_login_count: number
    last_failed_login: string | null
  }>
> {
  const db = await getDatabase()

  return (await db.query(
    `
    SELECT id, username, email, failed_login_count, last_failed_login
    FROM users
    WHERE is_active = ?
    ORDER BY last_failed_login DESC
  `,
    [boolParam(false, db.type)]
  )) as any[]
}

/**
 * 启用账户并重置失败计数（管理员功能）
 * 用于管理员手动启用因多次登录失败被禁用的账户
 */
export async function enableAccount(userId: number): Promise<void> {
  const db = await getDatabase()

  await db.exec(
    `
    UPDATE users
    SET is_active = ?,
        failed_login_count = 0,
        last_failed_login = NULL
    WHERE id = ?
  `,
    [boolParam(true, db.type), userId]
  )

  console.log(`[Security] Account ${userId} manually enabled by admin`)
}

/**
 * @deprecated 使用 enableAccount 代替
 * 保留此函数以兼容旧代码
 */
export async function unlockAccount(userId: number): Promise<void> {
  return enableAccount(userId)
}

/**
 * 获取IP的登录尝试次数（用于IP级别的速率限制检测）
 */
export async function getIpLoginAttempts(
  ipAddress: string,
  minutes: number = 5
): Promise<number> {
  const db = await getDatabase()
  const db_type = db.type
  const timeCondition =
    db_type === 'postgres'
      ? `attempted_at > NOW() - INTERVAL '${minutes} minutes'`
      : `attempted_at > datetime('now', '-${minutes} minutes')`

  const result = (await db.queryOne(
    `
    SELECT COUNT(*) as count
    FROM login_attempts
    WHERE ip_address = ?
      AND ${timeCondition}
  `,
    [ipAddress]
  )) as { count: number } | null

  return result?.count || 0
}

/**
 * 检查是否为可疑IP（短时间内大量失败尝试）
 */
export async function isSuspiciousIp(ipAddress: string): Promise<boolean> {
  const attempts = await getIpLoginAttempts(ipAddress, 5)
  return attempts > 10 // 5分钟内超过10次尝试视为可疑
}
