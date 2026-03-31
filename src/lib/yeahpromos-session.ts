import crypto from 'crypto'
import { getDatabase } from '@/lib/db'
import { getUserOnlySetting } from '@/lib/settings'
import { encrypt } from '@/lib/crypto'
import { JWT_SECRET } from '@/lib/config'

const SYSTEM_CATEGORY = 'system'

export const YEAHPROMOS_SESSION_COOKIE_KEY = 'affiliate_yp_session_cookie'
export const YEAHPROMOS_SESSION_CAPTURED_AT_KEY = 'affiliate_yp_session_captured_at'
export const YEAHPROMOS_SESSION_EXPIRES_AT_KEY = 'affiliate_yp_session_expires_at'
export const YEAHPROMOS_CAPTURE_NONCE_KEY = 'affiliate_yp_capture_nonce'
export const YEAHPROMOS_CAPTURE_NONCE_EXPIRES_AT_KEY = 'affiliate_yp_capture_nonce_expires_at'
export const YEAHPROMOS_MANUAL_SYNC_ONLY_KEY = 'affiliate_yp_manual_sync_only'

export const YEAHPROMOS_CAPTURE_TOKEN_TTL_MS = 5 * 60 * 1000
export const YEAHPROMOS_SESSION_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

const TRUE_TEXT_SET = new Set(['1', 'true', 'yes', 'on'])
const COOKIE_NAME_PATTERN = /^[A-Za-z0-9_.$-]+$/

type CaptureTokenPayload = {
  userId: number
  nonce: string
  exp: number
}

export type YeahPromosSessionState = {
  hasSession: boolean
  isExpired: boolean
  capturedAt: string | null
  expiresAt: string | null
  cookieHeader: string | null
  phpSessionId: string | null
}

function toBooleanFlag(value: boolean, dbType: string): boolean | number {
  if (dbType === 'postgres') return value
  return value ? 1 : 0
}

function toIsoTime(value: number): string {
  return new Date(value).toISOString()
}

function parseIsoTime(value: string | null | undefined): number | null {
  const text = String(value || '').trim()
  if (!text) return null
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

async function upsertUserSystemSetting(params: {
  userId: number
  key: string
  value: string
  dataType?: string
  isSensitive?: boolean
  description?: string
}): Promise<void> {
  const db = await getDatabase()
  const dataType = params.dataType || 'string'
  const isSensitive = Boolean(params.isSensitive)
  const nowExpr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  const existing = await db.queryOne<{ id: number }>(
    `
      SELECT id
      FROM system_settings
      WHERE user_id = ?
        AND category = ?
        AND key = ?
      LIMIT 1
    `,
    [params.userId, SYSTEM_CATEGORY, params.key]
  )

  const plainValue = isSensitive ? null : params.value
  const encryptedValue = isSensitive ? encrypt(params.value) : null

  if (existing?.id) {
    await db.exec(
      `
        UPDATE system_settings
        SET value = ?, encrypted_value = ?, data_type = ?, is_sensitive = ?, updated_at = ${nowExpr}
        WHERE id = ?
      `,
      [plainValue, encryptedValue, dataType, toBooleanFlag(isSensitive, db.type), existing.id]
    )
    return
  }

  await db.exec(
    `
      INSERT INTO system_settings (
        user_id,
        category,
        key,
        value,
        encrypted_value,
        data_type,
        is_sensitive,
        is_required,
        description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      params.userId,
      SYSTEM_CATEGORY,
      params.key,
      plainValue,
      encryptedValue,
      dataType,
      toBooleanFlag(isSensitive, db.type),
      toBooleanFlag(false, db.type),
      params.description || null,
    ]
  )
}

async function deleteUserSystemSetting(userId: number, key: string): Promise<void> {
  const db = await getDatabase()
  await db.exec(
    `
      DELETE FROM system_settings
      WHERE user_id = ?
        AND category = ?
        AND key = ?
    `,
    [userId, SYSTEM_CATEGORY, key]
  )
}

async function getUserSystemSettingValue(userId: number, key: string): Promise<string> {
  const setting = await getUserOnlySetting(SYSTEM_CATEGORY, key, userId)
  return String(setting?.value || '').trim()
}

function parseCookieHeader(rawCookie: string): Record<string, string> {
  const entries: Array<[string, string]> = []

  for (const segment of String(rawCookie || '').split(';')) {
    const item = segment.trim()
    if (!item) continue

    const eqIndex = item.indexOf('=')
    if (eqIndex <= 0) continue

    const name = item.slice(0, eqIndex).trim()
    const value = item.slice(eqIndex + 1).trim()
    if (!name || !COOKIE_NAME_PATTERN.test(name)) continue
    entries.push([name, value])
  }

  const map = new Map<string, string>()
  for (const [name, value] of entries) {
    if (map.has(name)) continue
    map.set(name, value)
  }

  return Array.from(map.entries()).reduce<Record<string, string>>((acc, [name, value]) => {
    acc[name] = value
    return acc
  }, {})
}

export function normalizeYeahPromosCookie(rawCookie: string): {
  cookieHeader: string
  phpSessionId: string
} {
  const cookieMap = parseCookieHeader(rawCookie)
  const phpSessionId = String(cookieMap.PHPSESSID || '').trim()
  if (!phpSessionId) {
    throw new Error('未检测到 PHPSESSID，请先在 YeahPromos 完成登录')
  }

  const cookieHeader = Object.entries(cookieMap)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')

  if (!cookieHeader) {
    throw new Error('Cookie 为空，无法保存登录态')
  }
  if (cookieHeader.length > 8000) {
    throw new Error('Cookie 长度异常，请重新登录后再试')
  }

  return {
    cookieHeader,
    phpSessionId,
  }
}

function buildCaptureToken(payload: CaptureTokenPayload): string {
  const payloadJson = JSON.stringify(payload)
  const payloadBase64 = Buffer.from(payloadJson, 'utf8').toString('base64url')
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(payloadBase64)
    .digest('base64url')

  return `${payloadBase64}.${signature}`
}

function verifyCaptureToken(token: string): CaptureTokenPayload | null {
  const parts = String(token || '').split('.')
  if (parts.length !== 2) return null

  const [payloadBase64, providedSignature] = parts
  if (!payloadBase64 || !providedSignature) return null

  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(payloadBase64)
    .digest('base64url')

  const providedBuffer = Buffer.from(providedSignature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (providedBuffer.length !== expectedBuffer.length) {
    return null
  }

  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8')) as CaptureTokenPayload
    if (!Number.isFinite(payload.userId) || payload.userId <= 0) return null
    if (!payload.nonce || typeof payload.nonce !== 'string') return null
    if (!Number.isFinite(payload.exp) || payload.exp <= 0) return null
    return payload
  } catch {
    return null
  }
}

export async function createYeahPromosCaptureChallenge(userId: number): Promise<{
  captureToken: string
  expiresAt: string
}> {
  const nonce = crypto.randomBytes(16).toString('hex')
  const expiresAtMs = Date.now() + YEAHPROMOS_CAPTURE_TOKEN_TTL_MS

  await upsertUserSystemSetting({
    userId,
    key: YEAHPROMOS_CAPTURE_NONCE_KEY,
    value: nonce,
    description: 'YP登录态回传一次性挑战码',
  })
  await upsertUserSystemSetting({
    userId,
    key: YEAHPROMOS_CAPTURE_NONCE_EXPIRES_AT_KEY,
    value: toIsoTime(expiresAtMs),
    description: 'YP登录态回传挑战码过期时间',
  })

  return {
    captureToken: buildCaptureToken({
      userId,
      nonce,
      exp: expiresAtMs,
    }),
    expiresAt: toIsoTime(expiresAtMs),
  }
}

export async function consumeYeahPromosCaptureChallenge(userId: number): Promise<void> {
  await Promise.all([
    deleteUserSystemSetting(userId, YEAHPROMOS_CAPTURE_NONCE_KEY),
    deleteUserSystemSetting(userId, YEAHPROMOS_CAPTURE_NONCE_EXPIRES_AT_KEY),
  ])
}

export async function validateYeahPromosCaptureToken(token: string): Promise<{ valid: boolean; userId?: number; error?: string }> {
  const payload = verifyCaptureToken(token)
  if (!payload) {
    return { valid: false, error: 'capture_token 无效' }
  }

  if (Date.now() >= payload.exp) {
    return { valid: false, error: 'capture_token 已过期，请重新生成' }
  }

  const [storedNonce, storedExpiresAtRaw] = await Promise.all([
    getUserSystemSettingValue(payload.userId, YEAHPROMOS_CAPTURE_NONCE_KEY),
    getUserSystemSettingValue(payload.userId, YEAHPROMOS_CAPTURE_NONCE_EXPIRES_AT_KEY),
  ])

  if (!storedNonce || storedNonce !== payload.nonce) {
    return { valid: false, error: 'capture_token 已失效，请重新生成' }
  }

  const storedExpiresAtMs = parseIsoTime(storedExpiresAtRaw)
  if (!storedExpiresAtMs || Date.now() >= storedExpiresAtMs) {
    return { valid: false, error: 'capture_token 已过期，请重新生成' }
  }

  return {
    valid: true,
    userId: payload.userId,
  }
}

export async function saveYeahPromosSessionCookie(params: {
  userId: number
  rawCookie: string
  ttlMs?: number
}): Promise<YeahPromosSessionState> {
  const normalized = normalizeYeahPromosCookie(params.rawCookie)
  const nowMs = Date.now()
  const expiresAtMs = nowMs + Math.max(60 * 60 * 1000, Math.trunc(params.ttlMs || YEAHPROMOS_SESSION_DEFAULT_TTL_MS))

  await upsertUserSystemSetting({
    userId: params.userId,
    key: YEAHPROMOS_SESSION_COOKIE_KEY,
    value: normalized.cookieHeader,
    isSensitive: true,
    description: 'YP会话Cookie（加密）',
  })
  await upsertUserSystemSetting({
    userId: params.userId,
    key: YEAHPROMOS_SESSION_CAPTURED_AT_KEY,
    value: toIsoTime(nowMs),
    description: 'YP会话Cookie采集时间',
  })
  await upsertUserSystemSetting({
    userId: params.userId,
    key: YEAHPROMOS_SESSION_EXPIRES_AT_KEY,
    value: toIsoTime(expiresAtMs),
    description: 'YP会话Cookie失效时间',
  })

  return {
    hasSession: true,
    isExpired: false,
    capturedAt: toIsoTime(nowMs),
    expiresAt: toIsoTime(expiresAtMs),
    cookieHeader: normalized.cookieHeader,
    phpSessionId: normalized.phpSessionId,
  }
}

export function maskSessionId(value: string | null | undefined): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  if (text.length <= 8) return text
  return `${text.slice(0, 4)}****${text.slice(-4)}`
}

export async function getYeahPromosSessionState(userId: number): Promise<YeahPromosSessionState> {
  const [cookieHeaderRaw, capturedAt, expiresAt] = await Promise.all([
    getUserSystemSettingValue(userId, YEAHPROMOS_SESSION_COOKIE_KEY),
    getUserSystemSettingValue(userId, YEAHPROMOS_SESSION_CAPTURED_AT_KEY),
    getUserSystemSettingValue(userId, YEAHPROMOS_SESSION_EXPIRES_AT_KEY),
  ])

  const cookieHeader = cookieHeaderRaw || null
  const cookieMap = parseCookieHeader(cookieHeader || '')
  const phpSessionId = String(cookieMap.PHPSESSID || '').trim() || null
  const expiresAtMs = parseIsoTime(expiresAt)
  const isExpired = Boolean(expiresAtMs && Date.now() >= expiresAtMs)
  const hasSession = Boolean(cookieHeader && phpSessionId && !isExpired)

  return {
    hasSession,
    isExpired,
    capturedAt: capturedAt || null,
    expiresAt: expiresAt || null,
    cookieHeader,
    phpSessionId,
  }
}

export async function getYeahPromosSessionCookieForSync(userId: number): Promise<string | null> {
  const session = await getYeahPromosSessionState(userId)
  if (!session.hasSession) return null
  return session.cookieHeader
}

/**
 * 检查YP session是否有足够的剩余有效期用于同步任务
 * @param userId 用户ID
 * @param minRemainingMs 最小剩余有效期（毫秒），默认1小时
 * @returns 是否有足够的有效期
 */
export async function checkYeahPromosSessionValidForSync(
  userId: number,
  minRemainingMs: number = 60 * 60 * 1000
): Promise<{
  valid: boolean
  hasSession: boolean
  isExpired: boolean
  remainingMs: number | null
  expiresAt: string | null
}> {
  const session = await getYeahPromosSessionState(userId)

  if (!session.hasSession) {
    return {
      valid: false,
      hasSession: false,
      isExpired: session.isExpired,
      remainingMs: null,
      expiresAt: session.expiresAt,
    }
  }

  const expiresAtMs = parseIsoTime(session.expiresAt)
  if (!expiresAtMs) {
    return {
      valid: false,
      hasSession: true,
      isExpired: false,
      remainingMs: null,
      expiresAt: session.expiresAt,
    }
  }

  const remainingMs = expiresAtMs - Date.now()
  const valid = remainingMs >= minRemainingMs

  return {
    valid,
    hasSession: true,
    isExpired: remainingMs <= 0,
    remainingMs,
    expiresAt: session.expiresAt,
  }
}

export async function isYeahPromosManualSyncOnly(userId: number): Promise<boolean> {
  const raw = await getUserSystemSettingValue(userId, YEAHPROMOS_MANUAL_SYNC_ONLY_KEY)
  if (!raw) return true
  return TRUE_TEXT_SET.has(raw.trim().toLowerCase())
}

function escapeForSingleQuotedString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
}

export function buildYeahPromosCaptureBookmarklet(params: {
  captureUrl: string
  captureToken: string
}): string {
  const captureUrl = escapeForSingleQuotedString(params.captureUrl)
  const captureToken = escapeForSingleQuotedString(params.captureToken)

  return `javascript:(()=>{try{var d=document;var f=d.createElement('form');f.method='POST';f.action='${captureUrl}';f.target='_blank';var add=function(k,v){var i=d.createElement('input');i.type='hidden';i.name=k;i.value=v;f.appendChild(i);};add('capture_token','${captureToken}');add('cookie',d.cookie||'');add('origin_url',location.href||'');add('ua',navigator.userAgent||'');d.body.appendChild(f);f.submit();setTimeout(function(){try{f.remove();}catch(_e){}},300);}catch(e){alert('YP会话回传失败: '+(e&&e.message?e.message:e));}})();`
}
