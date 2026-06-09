import crypto from 'crypto'
import { JWT_SECRET } from './config'

export type GoogleAdsOAuthStatePurpose = 'google_ads' | 'google_ads_test'

export type GoogleAdsOAuthStatePayload = {
  user_id: number
  timestamp: number
  purpose?: GoogleAdsOAuthStatePurpose
}

export const GOOGLE_ADS_OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000

/** 允许 state 时间戳相对当前时间的未来偏移（时钟偏差） */
export const GOOGLE_ADS_OAUTH_STATE_FUTURE_SKEW_MS = 60_000

function signPayloadBase64(payloadBase64: string): string {
  return crypto.createHmac('sha256', JWT_SECRET).update(payloadBase64).digest('base64url')
}

/** 生成带 HMAC 签名的 OAuth state（防伪造 user_id / CSRF）。 */
export function createGoogleAdsOAuthState(payload: GoogleAdsOAuthStatePayload): string {
  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${payloadBase64}.${signPayloadBase64(payloadBase64)}`
}

export type GoogleAdsOAuthStateVerifyResult =
  | { ok: true; payload: GoogleAdsOAuthStatePayload }
  | { ok: false; error: string }

/** 校验 OAuth state 签名、时效与可选 purpose / userId。 */
export function verifyGoogleAdsOAuthState(
  state: string,
  options: {
    maxAgeMs?: number
    expectedPurpose?: GoogleAdsOAuthStatePurpose
    expectedUserId?: number
  } = {}
): GoogleAdsOAuthStateVerifyResult {
  const parts = String(state || '').split('.')
  if (parts.length !== 2) {
    return { ok: false, error: 'invalid_state' }
  }

  const [payloadBase64, providedSignature] = parts
  if (!payloadBase64 || !providedSignature) {
    return { ok: false, error: 'invalid_state' }
  }

  const expectedSignature = signPayloadBase64(payloadBase64)
  const providedBuffer = Buffer.from(providedSignature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return { ok: false, error: 'invalid_state' }
  }

  let payload: GoogleAdsOAuthStatePayload
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, error: 'invalid_state' }
  }

  if (typeof payload.user_id !== 'number' || !Number.isFinite(payload.user_id)) {
    return { ok: false, error: 'invalid_state' }
  }
  if (typeof payload.timestamp !== 'number' || !Number.isFinite(payload.timestamp)) {
    return { ok: false, error: 'invalid_state' }
  }

  const now = Date.now()
  const maxAgeMs = options.maxAgeMs ?? GOOGLE_ADS_OAUTH_STATE_MAX_AGE_MS
  if (now - payload.timestamp > maxAgeMs) {
    return { ok: false, error: 'state_expired' }
  }
  if (payload.timestamp > now + GOOGLE_ADS_OAUTH_STATE_FUTURE_SKEW_MS) {
    return { ok: false, error: 'invalid_state' }
  }

  if (options.expectedPurpose !== undefined && payload.purpose !== options.expectedPurpose) {
    return { ok: false, error: 'invalid_purpose' }
  }

  if (options.expectedUserId !== undefined && payload.user_id !== options.expectedUserId) {
    return { ok: false, error: 'session_mismatch' }
  }

  return { ok: true, payload }
}
