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

  // 增加失败计数
  const nowFunc = 'NOW()'
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
  const user = (await db.queryOne('SELECT failed_login_count FROM users WHERE id = ?', [
    userId,
  ])) as { failed_login_count: number } | null

  if (user && user.failed_login_count >= MAX_FAILED_ATTEMPTS) {
    // 禁用账户（需要管理员手动启用）
    await db.exec(
      `
      UPDATE users
      SET is_active = ?
      WHERE id = ?
    `,
      [boolParam(false), userId]
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

  try {
    const successValue = success
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
    [boolParam(true), userId]
  )

  console.log(`[Security] Account ${userId} manually enabled by admin`)
}
