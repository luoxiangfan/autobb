/**
 * User Sessions Management
 *
 * KISS solution for account sharing detection.
 * Tracks login sessions and detects suspicious patterns.
 */

import { randomBytes } from 'crypto'
import { getDatabase } from './db'
import { createHash } from 'crypto'

// Configuration
const SESSION_DURATION_DAYS = 7
const MAX_CONCURRENT_SESSIONS = 3
const IP_CHANGE_WINDOW_HOURS = 1  // Flag if different IP within this window

export interface SessionInfo {
  id: number
  userId: number
  sessionToken: string
  ipAddress: string
  userAgent: string
  deviceFingerprint: string
  isCurrent: boolean
  isSuspicious: boolean
  suspiciousReason: string | null
  createdAt: string
  lastActivityAt: string
  expiresAt: string
}

export interface SharingAlert {
  id: number
  userId: number
  alertType: string
  severity: 'info' | 'warning' | 'critical'
  description: string
  ipAddresses: string[]
  deviceFingerprints: string[]
  isResolved: boolean
  createdAt: string
}

export interface TrustedDevice {
  id: number
  userId: number
  deviceFingerprint: string
  deviceName: string | null
  lastUsedAt: string
  isActive: boolean
}

/**
 * Generate a simple device fingerprint from User-Agent and IP
 * Uses first 2 octets of IP for privacy (city-level granularity)
 */
export function generateDeviceFingerprint(
  userAgent: string,
  ipAddress: string
): string {
  const ipPrefix = ipAddress.split('.').slice(0, 2).join('.')  // e.g., "192.168"
  const normalizedUA = userAgent.toLowerCase()
    .replace(/chrome\/[\d.]+/g, 'chrome')  // Normalize version numbers
    .replace(/firefox\/[\d.]+/g, 'firefox')
    .replace(/safari\/[\d.]+/g, 'safari')
    .replace(/\s+/g, ' ')
    .trim()

  const combined = `${ipPrefix}|${normalizedUA}`
  return createHash('sha256').update(combined).digest('hex').substring(0, 16)
}

/**
 * Generate a secure session token
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Create a new user session and check for sharing patterns
 */
export async function createUserSession(
  userId: number,
  ipAddress: string,
  userAgent: string
): Promise<{ session: SessionInfo; alerts: SharingAlert[] }> {
  const db = await getDatabase()
  const sessionToken = generateSessionToken()
  const deviceFingerprint = generateDeviceFingerprint(userAgent, ipAddress)
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  // Clean up expired sessions first
  await cleanupExpiredSessions(userId)

  // Check for suspicious patterns BEFORE creating new session
  const sharingCheck = await checkSharingPatterns(
    userId,
    ipAddress,
    deviceFingerprint
  )

  // Create the session
  const insertSql = `
    INSERT INTO user_sessions (
      user_id, session_token, ip_address, user_agent,
      device_fingerprint, is_suspicious, suspicious_reason,
      created_at, last_activity_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)
    RETURNING id
  `

  const result = await db.queryOne<{ id: number }>(
    insertSql,
    [
      userId,
      sessionToken,
      ipAddress,
      userAgent,
      deviceFingerprint,
      sharingCheck.isSuspicious ? 1 : 0,
      sharingCheck.suspiciousReason,
      expiresAt
    ]
  )

  if (!result) {
    throw new Error('Failed to create session')
  }

  const sessionId = result.id

  // Invalidate old sessions if exceeding max concurrent
  await enforceMaxConcurrentSessions(userId)

  // Create alerts if suspicious activity detected
  const alerts: SharingAlert[] = []
  if (sharingCheck.alerts.length > 0) {
    for (const alert of sharingCheck.alerts) {
      const alertId = await createAlert(
        userId,
        alert.type,
        alert.severity,
        alert.description,
        alert.ipAddresses,
        alert.deviceFingerprints
      )
      alerts.push({
        id: alertId,
        userId,
        alertType: alert.type,
        severity: alert.severity,
        description: alert.description,
        ipAddresses: alert.ipAddresses,
        deviceFingerprints: alert.deviceFingerprints,
        isResolved: false,
        createdAt: new Date().toISOString()
      })
    }
  }

  const session: SessionInfo = {
    id: sessionId,
    userId,
    sessionToken,
    ipAddress,
    userAgent,
    deviceFingerprint,
    isCurrent: true,
    isSuspicious: sharingCheck.isSuspicious,
    suspiciousReason: sharingCheck.suspiciousReason,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    expiresAt
  }

  return { session, alerts }
}

/**
 * Check for account sharing patterns
 */
async function checkSharingPatterns(
  userId: number,
  currentIp: string,
  currentFingerprint: string
): Promise<{
  isSuspicious: boolean
  suspiciousReason: string | null
  alerts: Array<{
    type: string
    severity: 'info' | 'warning' | 'critical'
    description: string
    ipAddresses: string[]
    deviceFingerprints: string[]
  }>
}> {
  const db = await getDatabase()
  const db_type = db.type
  const alerts: Array<{
    type: string
    severity: 'info' | 'warning' | 'critical'
    description: string
    ipAddresses: string[]
    deviceFingerprints: string[]
  }> = []

  // Check if device is trusted
  const isTrusted = await isDeviceTrusted(userId, currentFingerprint)
  if (isTrusted) {
    return { isSuspicious: false, suspiciousReason: null, alerts }
  }

  // Get recent sessions (within IP change window)
  const timeCondition = db_type === 'postgres'
    ? `created_at > CURRENT_TIMESTAMP - INTERVAL '${IP_CHANGE_WINDOW_HOURS} hours'`
    : `created_at > datetime('now', '-${IP_CHANGE_WINDOW_HOURS} hours')`

  const recentSessions = await db.query<{
    ip_address: string
    device_fingerprint: string
    created_at: string
  }>(`
    SELECT ip_address, device_fingerprint, created_at
    FROM user_sessions
    WHERE user_id = ?
      AND ${timeCondition}
      AND revoked_at IS NULL
    ORDER BY created_at DESC
  `, [userId])

  if (recentSessions.length === 0) {
    // First login or all old sessions - no issue
    return { isSuspicious: false, suspiciousReason: null, alerts }
  }

  // Get unique IPs in the window
  const uniqueIps = new Set(recentSessions.map((s: { ip_address: string }) => s.ip_address))
  const uniqueFingerprints = new Set(
    recentSessions.map((s: { device_fingerprint: string }) => s.device_fingerprint)
  )

  // Pattern 1: Multiple IPs in short time window
  if (uniqueIps.size > 1) {
    const ipArray = Array.from(uniqueIps)
    const severity = ipArray.length > 2 ? 'critical' : 'warning'

    alerts.push({
      type: 'MULTI_IP_LOGIN',
      severity,
      description: `Account accessed from ${ipArray.length} different IP addresses within ${IP_CHANGE_WINDOW_HOURS} hour(s): ${ipArray.join(', ')}`,
      ipAddresses: ipArray,
      deviceFingerprints: Array.from(uniqueFingerprints)
    })
  }

  // Pattern 2: New device from different location
  const existingFingerprints = new Set(
    recentSessions.map((s: { device_fingerprint: string }) => s.device_fingerprint)
  )
  if (!existingFingerprints.has(currentFingerprint) && existingFingerprints.size > 0) {
    const oldFpArray = Array.from(existingFingerprints)
    alerts.push({
      type: 'NEW_DEVICE',
      severity: 'warning',
      description: `New device detected. Previous device(s): ${oldFpArray.length}`,
      ipAddresses: Array.from(uniqueIps),
      deviceFingerprints: [...oldFpArray, currentFingerprint]
    })
  }

  // Determine overall suspicious status
  const isSuspicious = alerts.length > 0
  let suspiciousReason: string | null = null
  if (isSuspicious) {
    const alertTypes = alerts.map(a => a.type).join(', ')
    suspiciousReason = `Patterns detected: ${alertTypes}`
  }

  return { isSuspicious, suspiciousReason, alerts }
}

/**
 * Check if a device is trusted
 */
async function isDeviceTrusted(
  userId: number,
  deviceFingerprint: string
): Promise<boolean> {
  const db = await getDatabase()
  // 注意：trusted_devices.is_active 在 PostgreSQL 和 SQLite 中都是 INTEGER 类型
  const trusted = await db.queryOne<{ id: number }>(
    `SELECT id FROM trusted_devices
     WHERE user_id = ? AND device_fingerprint = ? AND is_active = 1`,
    [userId, deviceFingerprint]
  )
  return !!trusted
}

/**
 * Create an account sharing alert
 */
async function createAlert(
  userId: number,
  alertType: string,
  severity: 'info' | 'warning' | 'critical',
  description: string,
  ipAddresses: string[],
  deviceFingerprints: string[]
): Promise<number> {
  const db = await getDatabase()
  const result = await db.queryOne<{ id: number }>(
    `INSERT INTO account_sharing_alerts (
      user_id, alert_type, severity, description,
      ip_addresses, device_fingerprints, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    RETURNING id`,
    [
      userId,
      alertType,
      severity,
      description,
      JSON.stringify(ipAddresses),
      JSON.stringify(deviceFingerprints)
    ]
  )
  return result!.id
}

/**
 * Enforce maximum concurrent sessions per user
 */
async function enforceMaxConcurrentSessions(userId: number): Promise<void> {
  const db = await getDatabase()
  const sessions = await db.query<{ id: number; created_at: string }>(`
    SELECT id, created_at FROM user_sessions
    WHERE user_id = ? AND is_current = 1 AND revoked_at IS NULL
    ORDER BY created_at DESC
  `, [userId])

  if (sessions.length > MAX_CONCURRENT_SESSIONS) {
    // Revoke oldest sessions beyond the limit
    const toRevoke = sessions.slice(MAX_CONCURRENT_SESSIONS)
    const idsToRevoke = toRevoke.map((s: { id: number }) => s.id)

    await db.exec(
      `UPDATE user_sessions SET revoked_at = datetime('now')
       WHERE id IN (${idsToRevoke.map(() => '?').join(',')})`,
      idsToRevoke
    )
  }
}

/**
 * Clean up expired sessions
 */
async function cleanupExpiredSessions(userId?: number): Promise<number> {
  const db = await getDatabase()
  let sql = `UPDATE user_sessions SET revoked_at = datetime('now')
             WHERE expires_at < datetime('now') AND revoked_at IS NULL`
  const params: (number | undefined)[] = []

  if (userId) {
    sql += ' AND user_id = ?'
    params.push(userId)
  }

  const result = await db.exec(sql, params)
  return result.changes
}

/**
 * Get active sessions for a user
 */
export async function getActiveSessions(
  userId: number
): Promise<SessionInfo[]> {
  const db = await getDatabase()
  return db.query<SessionInfo>(`
    SELECT * FROM user_sessions
    WHERE user_id = ? AND is_current = 1 AND revoked_at IS NULL
    ORDER BY last_activity_at DESC
  `, [userId])
}

/**
 * Revoke a specific session
 */
export async function revokeSession(
  sessionToken: string,
  userId: number
): Promise<boolean> {
  const db = await getDatabase()
  const result = await db.exec(
    `UPDATE user_sessions
     SET revoked_at = datetime('now')
     WHERE session_token = ? AND user_id = ?`,
    [sessionToken, userId]
  )
  return result.changes > 0
}

/**
 * Revoke all sessions for a user (logout all devices)
 */
export async function revokeAllSessions(userId: number): Promise<number> {
  const db = await getDatabase()
  const result = await db.exec(
    `UPDATE user_sessions
     SET revoked_at = datetime('now')
     WHERE user_id = ? AND is_current = 1`,
    [userId]
  )
  return result.changes
}

/**
 * Update last activity timestamp
 */
export async function updateSessionActivity(sessionToken: string): Promise<void> {
  const db = await getDatabase()
  await db.exec(
    `UPDATE user_sessions SET last_activity_at = datetime('now')
     WHERE session_token = ?`,
    [sessionToken]
  )
}

/**
 * Mark a device as trusted
 */
export async function trustDevice(
  userId: number,
  deviceFingerprint: string,
  deviceName?: string
): Promise<number> {
  const db = await getDatabase()
  const result = await db.queryOne<{ id: number }>(
    `INSERT INTO trusted_devices
     (user_id, device_fingerprint, device_name, last_used_at, created_at, is_active)
     VALUES (?, ?, ?, datetime('now'), datetime('now'), 1)
     RETURNING id`,
    [userId, deviceFingerprint, deviceName || null]
  )
  return result!.id
}

/**
 * Untrust a device
 */
export async function untrustDevice(
  userId: number,
  deviceFingerprint: string
): Promise<boolean> {
  const db = await getDatabase()
  // 注意：trusted_devices.is_active 在 PostgreSQL 和 SQLite 中都是 INTEGER 类型
  const result = await db.exec(
    `UPDATE trusted_devices SET is_active = 0
     WHERE user_id = ? AND device_fingerprint = ?`,
    [userId, deviceFingerprint]
  )
  return result.changes > 0
}

/**
 * Get trusted devices for a user
 */
export async function getTrustedDevices(
  userId: number
): Promise<TrustedDevice[]> {
  const db = await getDatabase()
  // 注意：trusted_devices.is_active 在 PostgreSQL 和 SQLite 中都是 INTEGER 类型
  return db.query<TrustedDevice>(
    `SELECT * FROM trusted_devices
     WHERE user_id = ? AND is_active = 1
     ORDER BY last_used_at DESC`,
    [userId]
  )
}

/**
 * Get unresolved alerts for a user
 */
export async function getUserAlerts(
  userId: number,
  includeResolved = false
): Promise<SharingAlert[]> {
  const db = await getDatabase()
  const params: any[] = [userId]
  let sql = `
    SELECT * FROM account_sharing_alerts
    WHERE user_id = ?
  `
  if (!includeResolved) {
    sql += ' AND is_resolved = ?'
    params.push(0)
  }
  sql += ' ORDER BY created_at DESC'

  const alerts = await db.query<{
    id: number
    user_id: number
    alert_type: string
    severity: string
    description: string
    ip_addresses: string
    device_fingerprints: string
    is_resolved: number
    created_at: string
  }>(sql, params)

  return alerts.map(a => ({
    id: a.id,
    userId: a.user_id,
    alertType: a.alert_type,
    severity: a.severity as 'info' | 'warning' | 'critical',
    description: a.description,
    ipAddresses: JSON.parse(a.ip_addresses || '[]') as string[],
    deviceFingerprints: JSON.parse(a.device_fingerprints || '[]') as string[],
    isResolved: a.is_resolved === 1,
    createdAt: a.created_at
  }))
}

/**
 * Resolve an alert (admin action)
 */
export async function resolveAlert(
  alertId: number,
  resolvedByUserId: number
): Promise<boolean> {
  const db = await getDatabase()
  const result = await db.exec(
    `UPDATE account_sharing_alerts
     SET is_resolved = 1, resolved_at = datetime('now'), resolved_by = ?
     WHERE id = ?`,
    [resolvedByUserId, alertId]
  )
  return result.changes > 0
}
