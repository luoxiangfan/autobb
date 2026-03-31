/**
 * 安全审计日志系统
 *
 * 功能：
 * - 记录所有安全相关事件
 * - 支持事件类型分类
 * - 提供查询和分析接口
 * - User-Agent解析（设备类型、浏览器、操作系统）
 * - 用户管理操作审计
 */

import { getDatabase } from './db'
import { toDbJsonObjectField } from './json-field'

// ============================================================================
// User-Agent 解析工具
// ============================================================================

export interface ParsedUserAgent {
  deviceType: 'Desktop' | 'Mobile' | 'Tablet' | 'Bot' | 'Unknown'
  os: string
  browser: string
  browserVersion: string | null
}

/**
 * 解析 User-Agent 字符串
 */
export function parseUserAgent(userAgent: string): ParsedUserAgent {
  if (!userAgent) {
    return { deviceType: 'Unknown', os: 'Unknown', browser: 'Unknown', browserVersion: null }
  }

  const ua = userAgent.toLowerCase()

  // 检测设备类型
  let deviceType: ParsedUserAgent['deviceType'] = 'Desktop'
  if (/bot|spider|crawler|crawling/i.test(userAgent)) {
    deviceType = 'Bot'
  } else if (/ipad|tablet|playbook|silk/i.test(userAgent)) {
    deviceType = 'Tablet'
  } else if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry/i.test(userAgent)) {
    deviceType = 'Mobile'
  }

  // 检测操作系统
  let os = 'Unknown'
  if (/windows/i.test(userAgent)) {
    os = 'Windows'
    const windowsMatch = userAgent.match(/Windows NT (\d+\.\d+)/i)
    if (windowsMatch) {
      const ntVersion = windowsMatch[1]
      const windowsVersionMap: Record<string, string> = {
        '10.0': 'Windows 10/11',
        '6.3': 'Windows 8.1',
        '6.2': 'Windows 8',
        '6.1': 'Windows 7',
      }
      os = windowsVersionMap[ntVersion] || `Windows NT ${ntVersion}`
    }
  } else if (/macintosh|mac os x/i.test(userAgent)) {
    os = 'macOS'
    const macMatch = userAgent.match(/Mac OS X (\d+[._]\d+)/i)
    if (macMatch) {
      os = `macOS ${macMatch[1].replace('_', '.')}`
    }
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    os = 'iOS'
    const iosMatch = userAgent.match(/OS (\d+[._]\d+)/i)
    if (iosMatch) {
      os = `iOS ${iosMatch[1].replace('_', '.')}`
    }
  } else if (/android/i.test(userAgent)) {
    os = 'Android'
    const androidMatch = userAgent.match(/Android (\d+\.?\d*)/i)
    if (androidMatch) {
      os = `Android ${androidMatch[1]}`
    }
  } else if (/linux/i.test(userAgent)) {
    os = 'Linux'
  }

  // 检测浏览器
  let browser = 'Unknown'
  let browserVersion: string | null = null

  // 优先检测一些特殊浏览器（避免被Chrome匹配）
  if (/edg\//i.test(userAgent)) {
    browser = 'Edge'
    const match = userAgent.match(/Edg\/(\d+\.?\d*)/i)
    browserVersion = match ? match[1] : null
  } else if (/opr\//i.test(userAgent) || /opera/i.test(userAgent)) {
    browser = 'Opera'
    const match = userAgent.match(/(?:OPR|Opera)\/(\d+\.?\d*)/i)
    browserVersion = match ? match[1] : null
  } else if (/chrome/i.test(userAgent) && !/edg/i.test(userAgent)) {
    browser = 'Chrome'
    const match = userAgent.match(/Chrome\/(\d+\.?\d*)/i)
    browserVersion = match ? match[1] : null
  } else if (/firefox/i.test(userAgent)) {
    browser = 'Firefox'
    const match = userAgent.match(/Firefox\/(\d+\.?\d*)/i)
    browserVersion = match ? match[1] : null
  } else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) {
    browser = 'Safari'
    const match = userAgent.match(/Version\/(\d+\.?\d*)/i)
    browserVersion = match ? match[1] : null
  } else if (/curl/i.test(userAgent)) {
    browser = 'curl'
    const match = userAgent.match(/curl\/(\d+\.?\d*)/i)
    browserVersion = match ? match[1] : null
  } else if (/postman/i.test(userAgent)) {
    browser = 'Postman'
  }

  return { deviceType, os, browser, browserVersion }
}

/**
 * 审计事件类型枚举
 */
export enum AuditEventType {
  // 认证相关
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILED = 'login_failed',
  LOGOUT = 'logout',
  ACCOUNT_LOCKED = 'account_locked',
  ACCOUNT_UNLOCKED = 'account_unlocked',

  // 密码相关
  PASSWORD_CHANGED = 'password_changed',
  PASSWORD_RESET_REQUESTED = 'password_reset_requested',
  PASSWORD_RESET_COMPLETED = 'password_reset_completed',

  // 权限相关
  PERMISSION_CHANGED = 'permission_changed',
  ROLE_CHANGED = 'role_changed',

  // 安全相关
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  UNAUTHORIZED_ACCESS_ATTEMPT = 'unauthorized_access_attempt',

  // 账户管理
  USER_CREATED = 'user_created',
  USER_UPDATED = 'user_updated',
  USER_DISABLED = 'user_disabled',
  USER_ENABLED = 'user_enabled',

  // 敏感操作
  SENSITIVE_DATA_ACCESS = 'sensitive_data_access',
  CONFIGURATION_CHANGED = 'configuration_changed',
}

/**
 * 审计日志条目接口
 */
export interface AuditLogEntry {
  userId?: number // 可选：未登录的操作（如登录失败）可能没有userId
  eventType: AuditEventType
  ipAddress: string
  userAgent: string
  details?: Record<string, any> // 额外的上下文信息
  timestamp?: Date // 可选：默认为当前时间
}

/**
 * 记录审计事件
 *
 * @param entry 审计日志条目
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  const db = await getDatabase()

  try {
    const timestamp = entry.timestamp || new Date()

    await db.exec(`
      INSERT INTO audit_logs (user_id, event_type, ip_address, user_agent, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      entry.userId || null,
      entry.eventType,
      entry.ipAddress,
      entry.userAgent,
      toDbJsonObjectField(entry.details || null, db.type, null),
      timestamp.toISOString()
    ])
  } catch (error) {
    console.error('[AuditLogger] Failed to log audit event:', error)
    // 不抛出错误，避免影响业务流程
  }
}

/**
 * 查询审计日志
 */
export interface QueryAuditLogsOptions {
  userId?: number
  eventType?: AuditEventType | AuditEventType[]
  ipAddress?: string
  startDate?: Date
  endDate?: Date
  limit?: number
  offset?: number
}

export interface AuditLogResult {
  id: number
  user_id: number | null
  event_type: string
  ip_address: string
  user_agent: string
  details: string | null
  created_at: string
}

/**
 * 查询审计日志（支持多条件过滤）
 */
export async function queryAuditLogs(options: QueryAuditLogsOptions = {}): Promise<AuditLogResult[]> {
  const db = await getDatabase()

  let query = 'SELECT * FROM audit_logs WHERE 1=1'
  const params: any[] = []

  if (options.userId) {
    query += ' AND user_id = ?'
    params.push(options.userId)
  }

  if (options.eventType) {
    if (Array.isArray(options.eventType)) {
      query += ` AND event_type IN (${options.eventType.map(() => '?').join(',')})`
      params.push(...options.eventType)
    } else {
      query += ' AND event_type = ?'
      params.push(options.eventType)
    }
  }

  if (options.ipAddress) {
    query += ' AND ip_address = ?'
    params.push(options.ipAddress)
  }

  if (options.startDate) {
    query += ' AND created_at >= ?'
    params.push(options.startDate.toISOString())
  }

  if (options.endDate) {
    query += ' AND created_at <= ?'
    params.push(options.endDate.toISOString())
  }

  query += ' ORDER BY created_at DESC'

  if (options.limit) {
    query += ' LIMIT ?'
    params.push(options.limit)
  }

  if (options.offset) {
    query += ' OFFSET ?'
    params.push(options.offset)
  }

  return await db.query(query, params) as AuditLogResult[]
}

/**
 * 获取最近的可疑活动（用于安全监控）
 */
export async function getRecentSuspiciousActivity(hours: number = 24, limit: number = 50): Promise<AuditLogResult[]> {
  const startDate = new Date()
  startDate.setHours(startDate.getHours() - hours)

  return await queryAuditLogs({
    eventType: [
      AuditEventType.SUSPICIOUS_ACTIVITY,
      AuditEventType.RATE_LIMIT_EXCEEDED,
      AuditEventType.UNAUTHORIZED_ACCESS_ATTEMPT,
      AuditEventType.ACCOUNT_LOCKED,
    ],
    startDate,
    limit,
  })
}

/**
 * 获取用户的审计历史（用于用户行为分析）
 */
export async function getUserAuditHistory(userId: number, limit: number = 100): Promise<AuditLogResult[]> {
  return await queryAuditLogs({
    userId,
    limit,
  })
}

/**
 * 获取特定IP的活动历史（用于IP行为分析）
 */
export async function getIpActivityHistory(ipAddress: string, hours: number = 24): Promise<AuditLogResult[]> {
  const startDate = new Date()
  startDate.setHours(startDate.getHours() - hours)

  return await queryAuditLogs({
    ipAddress,
    startDate,
  })
}

/**
 * 统计审计事件（用于安全报表）
 */
export interface AuditEventStats {
  event_type: string
  count: number
}

/**
 * 获取事件类型统计（最近N小时）
 */
export async function getEventTypeStats(hours: number = 24): Promise<AuditEventStats[]> {
  const db = await getDatabase()

  return await db.query(`
    SELECT event_type, COUNT(*) as count
    FROM audit_logs
    WHERE created_at > datetime('now', '-${hours} hours')
    GROUP BY event_type
    ORDER BY count DESC
  `, []) as AuditEventStats[]
}

/**
 * 清理旧的审计日志（保留策略：默认保留90天）
 */
export async function cleanupOldAuditLogs(retentionDays: number = 90): Promise<number> {
  const db = await getDatabase()

  const result = await db.exec(`
    DELETE FROM audit_logs
    WHERE created_at < datetime('now', '-${retentionDays} days')
  `, [])

  const deletedCount = result.changes || 0

  if (deletedCount > 0) {
    console.log(`[AuditLogger] Cleaned up ${deletedCount} audit logs older than ${retentionDays} days`)
  }

  return deletedCount
}

/**
 * 导出审计日志（CSV格式，用于离线分析）
 */
export async function exportAuditLogsToCSV(options: QueryAuditLogsOptions = {}): Promise<string> {
  const logs = await queryAuditLogs(options)

  const headers = ['ID', 'User ID', 'Event Type', 'IP Address', 'User Agent', 'Details', 'Created At']
  const rows = logs.map(log => [
    log.id,
    log.user_id || '',
    log.event_type,
    log.ip_address,
    log.user_agent,
    log.details || '',
    log.created_at,
  ])

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n')

  return csv
}

// ============================================================================
// 用户管理操作审计 - 统一接口
// ============================================================================

/**
 * 用户管理操作上下文
 */
export interface UserManagementContext {
  /** 操作人ID（管理员） */
  operatorId: number
  /** 操作人用户名 */
  operatorUsername: string
  /** 目标用户ID */
  targetUserId: number
  /** 目标用户名 */
  targetUsername: string
  /** IP地址 */
  ipAddress: string
  /** User-Agent */
  userAgent: string
}

/**
 * 用户管理操作类型
 */
export type UserManagementAction =
  | 'user_created'
  | 'user_updated'
  | 'user_disabled'
  | 'user_enabled'
  | 'user_deleted'
  | 'user_password_reset'
  | 'user_unlocked'
  | 'user_role_changed'

/**
 * 用户管理操作详情
 */
export interface UserManagementDetails {
  /** 操作前的值 */
  before?: Record<string, any>
  /** 操作后的值 */
  after?: Record<string, any>
  /** 变更字段列表 */
  changedFields?: string[]
  /** 额外信息 */
  extra?: Record<string, any>
}

/**
 * 记录用户管理操作审计日志
 *
 * @param action 操作类型
 * @param context 操作上下文
 * @param details 操作详情
 * @param status 操作状态
 * @param errorMessage 错误信息（仅当 status='failure' 时）
 */
export async function logUserManagementAction(
  action: UserManagementAction,
  context: UserManagementContext,
  details?: UserManagementDetails,
  status: 'success' | 'failure' = 'success',
  errorMessage?: string
): Promise<void> {
  const db = await getDatabase()

  try {
    const timestamp = new Date().toISOString()
    const parsedUA = parseUserAgent(context.userAgent)

    await db.exec(`
      INSERT INTO audit_logs (
        user_id, event_type, ip_address, user_agent, details, created_at,
        operator_id, operator_username, target_user_id, target_username, status, error_message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      context.targetUserId,
      action,
      context.ipAddress,
      context.userAgent,
      toDbJsonObjectField(details ? {
        ...details,
        parsedUserAgent: parsedUA,
      } : { parsedUserAgent: parsedUA }, db.type, { parsedUserAgent: parsedUA }),
      timestamp,
      context.operatorId,
      context.operatorUsername,
      context.targetUserId,
      context.targetUsername,
      status,
      errorMessage || null,
    ])

    console.log(`[AuditLogger] User management action logged: ${action} by ${context.operatorUsername} on ${context.targetUsername} (${status})`)
  } catch (error) {
    console.error('[AuditLogger] Failed to log user management action:', error)
    // 不抛出错误，避免影响业务流程
  }
}

/**
 * 快捷方法：记录用户创建
 */
export async function logUserCreated(
  context: UserManagementContext,
  newUserData: Record<string, any>
): Promise<void> {
  // 移除敏感信息
  const safeUserData = { ...newUserData }
  delete safeUserData.password
  delete safeUserData.password_hash

  await logUserManagementAction('user_created', context, {
    after: safeUserData,
  })
}

/**
 * 快捷方法：记录用户更新
 */
export async function logUserUpdated(
  context: UserManagementContext,
  beforeData: Record<string, any>,
  afterData: Record<string, any>,
  changedFields: string[]
): Promise<void> {
  // 移除敏感信息
  const safeBefore = { ...beforeData }
  const safeAfter = { ...afterData }
  delete safeBefore.password
  delete safeBefore.password_hash
  delete safeAfter.password
  delete safeAfter.password_hash

  await logUserManagementAction('user_updated', context, {
    before: safeBefore,
    after: safeAfter,
    changedFields,
  })
}

/**
 * 快捷方法：记录用户禁用
 */
export async function logUserDisabled(
  context: UserManagementContext,
  reason?: string
): Promise<void> {
  await logUserManagementAction('user_disabled', context, {
    extra: { reason },
    before: { is_active: true },
    after: { is_active: false },
    changedFields: ['is_active'],
  })
}

/**
 * 快捷方法：记录用户启用
 */
export async function logUserEnabled(
  context: UserManagementContext
): Promise<void> {
  await logUserManagementAction('user_enabled', context, {
    before: { is_active: false },
    after: { is_active: true },
    changedFields: ['is_active'],
  })
}

/**
 * 快捷方法：记录用户删除
 */
export async function logUserDeleted(
  context: UserManagementContext,
  deletedUserData: Record<string, any>
): Promise<void> {
  // 移除敏感信息
  const safeUserData = { ...deletedUserData }
  delete safeUserData.password
  delete safeUserData.password_hash

  await logUserManagementAction('user_deleted', context, {
    before: safeUserData,
  })
}

/**
 * 快捷方法：记录密码重置
 */
export async function logPasswordReset(
  context: UserManagementContext,
  resetMethod: 'admin_reset' | 'user_request' | 'email_link'
): Promise<void> {
  await logUserManagementAction('user_password_reset', context, {
    extra: { resetMethod },
    changedFields: ['password_hash'],
  })
}

/**
 * 快捷方法：记录账户解锁
 */
export async function logUserUnlocked(
  context: UserManagementContext,
  previousLockInfo?: { locked_until?: string; failed_attempts?: number }
): Promise<void> {
  await logUserManagementAction('user_unlocked', context, {
    before: previousLockInfo,
    after: { locked_until: null, failed_login_attempts: 0 },
    changedFields: ['locked_until', 'failed_login_attempts'],
  })
}

/**
 * 快捷方法：记录角色变更
 */
export async function logRoleChanged(
  context: UserManagementContext,
  oldRole: string,
  newRole: string
): Promise<void> {
  await logUserManagementAction('user_role_changed', context, {
    before: { role: oldRole },
    after: { role: newRole },
    changedFields: ['role'],
  })
}

// ============================================================================
// 登录记录增强 - 添加设备信息
// ============================================================================

/**
 * 记录登录尝试（带设备信息解析）
 */
export async function logLoginAttemptWithDeviceInfo(
  usernameOrEmail: string,
  success: boolean,
  ipAddress: string,
  userAgent: string,
  userId?: number,
  failureReason?: string
): Promise<void> {
  const db = await getDatabase()
  const parsedUA = parseUserAgent(userAgent)

  try {
    await db.exec(`
      INSERT INTO login_attempts (
        username_or_email, user_id, ip_address, user_agent, success, failure_reason, attempted_at,
        device_type, os, browser, browser_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      usernameOrEmail,
      userId || null,
      ipAddress,
      userAgent,
      success ? 1 : 0,
      failureReason || null,
      new Date().toISOString(),
      parsedUA.deviceType,
      parsedUA.os,
      parsedUA.browser,
      parsedUA.browserVersion,
    ])
  } catch (error) {
    console.error('[AuditLogger] Failed to log login attempt:', error)
  }
}

/**
 * 查询用户管理操作日志
 */
export interface QueryUserManagementLogsOptions {
  operatorId?: number
  targetUserId?: number
  action?: UserManagementAction | UserManagementAction[]
  status?: 'success' | 'failure'
  startDate?: Date
  endDate?: Date
  limit?: number
  offset?: number
}

export interface UserManagementLogResult {
  id: number
  user_id: number | null
  event_type: string
  ip_address: string
  user_agent: string
  details: string | null
  created_at: string
  operator_id: number | null
  operator_username: string | null
  target_user_id: number | null
  target_username: string | null
  status: string
  error_message: string | null
}

/**
 * 查询用户管理操作日志
 */
export async function queryUserManagementLogs(
  options: QueryUserManagementLogsOptions = {}
): Promise<UserManagementLogResult[]> {
  const db = await getDatabase()

  let query = `
    SELECT * FROM audit_logs
    WHERE event_type IN ('user_created', 'user_updated', 'user_disabled', 'user_enabled',
                         'user_deleted', 'user_password_reset', 'user_unlocked', 'user_role_changed')
  `
  const params: any[] = []

  if (options.operatorId) {
    query += ' AND operator_id = ?'
    params.push(options.operatorId)
  }

  if (options.targetUserId) {
    query += ' AND target_user_id = ?'
    params.push(options.targetUserId)
  }

  if (options.action) {
    if (Array.isArray(options.action)) {
      query += ` AND event_type IN (${options.action.map(() => '?').join(',')})`
      params.push(...options.action)
    } else {
      query += ' AND event_type = ?'
      params.push(options.action)
    }
  }

  if (options.status) {
    query += ' AND status = ?'
    params.push(options.status)
  }

  if (options.startDate) {
    query += ' AND created_at >= ?'
    params.push(options.startDate.toISOString())
  }

  if (options.endDate) {
    query += ' AND created_at <= ?'
    params.push(options.endDate.toISOString())
  }

  query += ' ORDER BY created_at DESC'

  if (options.limit) {
    query += ' LIMIT ?'
    params.push(options.limit)
  }

  if (options.offset) {
    query += ' OFFSET ?'
    params.push(options.offset)
  }

  return await db.query(query, params) as UserManagementLogResult[]
}
