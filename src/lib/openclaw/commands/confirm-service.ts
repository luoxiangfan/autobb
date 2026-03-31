import crypto from 'crypto'
import { getDatabase } from '@/lib/db'
import { boolParam, nowFunc } from '@/lib/db-helpers'

const DEFAULT_CONFIRM_TTL_SECONDS = 10 * 60

type ConfirmDecision = 'confirm' | 'cancel'

type ConsumeConfirmResult =
  | {
      ok: false
      code: 'not_found' | 'invalid_token' | 'expired' | 'already_processed'
      confirmStatus?: string
      runStatus?: string
    }
  | {
      ok: true
      status: 'confirmed' | 'canceled'
      runId: string
      userId: number
      riskLevel: string
      confirmStatus: string
    }

function resolveConfirmTtlSeconds(ttlSeconds?: number): number {
  if (typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
    return Math.max(60, Math.floor(ttlSeconds))
  }

  const envSeconds = Number(process.env.OPENCLAW_CONFIRM_TTL_SECONDS)
  if (Number.isFinite(envSeconds) && envSeconds > 0) {
    return Math.max(60, Math.floor(envSeconds))
  }

  return DEFAULT_CONFIRM_TTL_SECONDS
}

function generateConfirmToken(): string {
  return `occf_${crypto.randomBytes(24).toString('base64url')}`
}

function hashConfirmToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function safeTokenHashCompare(rawToken: string, tokenHash: string): boolean {
  const incoming = Buffer.from(hashConfirmToken(rawToken), 'utf8')
  const existing = Buffer.from(tokenHash || '', 'utf8')
  if (incoming.length !== existing.length) {
    return false
  }
  return crypto.timingSafeEqual(incoming, existing)
}

export async function expireStaleCommandConfirmations(params?: {
  userId?: number
}): Promise<number> {
  const db = await getDatabase()
  const nowSql = nowFunc(db.type)

  const confirmWhere = [
    `status = 'pending'`,
    'expires_at IS NOT NULL',
    `expires_at <= ${nowSql}`,
  ]
  const confirmParams: Array<number | string> = []
  if (typeof params?.userId === 'number' && Number.isFinite(params.userId)) {
    confirmWhere.push('user_id = ?')
    confirmParams.push(params.userId)
  }

  const expiredConfirms = await db.exec(
    `UPDATE openclaw_command_confirms
     SET status = 'expired',
         updated_at = ${nowSql}
     WHERE ${confirmWhere.join(' AND ')}`,
    confirmParams
  )

  const runWhere = [
    `status = 'pending_confirm'`,
    'confirm_expires_at IS NOT NULL',
    `confirm_expires_at <= ${nowSql}`,
    'confirm_required = ?',
  ]
  const runParams: Array<number | string | boolean> = [boolParam(true, db.type)]
  if (typeof params?.userId === 'number' && Number.isFinite(params.userId)) {
    runWhere.push('user_id = ?')
    runParams.push(params.userId)
  }

  await db.exec(
    `UPDATE openclaw_command_runs
     SET status = 'expired',
         updated_at = ${nowSql}
     WHERE ${runWhere.join(' AND ')}`,
    runParams
  )

  return Number(expiredConfirms?.changes || 0)
}

export async function createOrRefreshCommandConfirmation(params: {
  runId: string
  userId: number
  ttlSeconds?: number
}): Promise<{ confirmToken: string; expiresAt: string }> {
  const db = await getDatabase()
  const nowSql = nowFunc(db.type)

  await expireStaleCommandConfirmations({ userId: params.userId })

  const confirmToken = generateConfirmToken()
  const tokenHash = hashConfirmToken(confirmToken)
  const ttlSeconds = resolveConfirmTtlSeconds(params.ttlSeconds)
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()

  await db.exec(
    `INSERT INTO openclaw_command_confirms
     (run_id, user_id, confirm_token_hash, status, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ${nowSql}, ${nowSql})
     ON CONFLICT(run_id)
     DO UPDATE SET
       user_id = excluded.user_id,
       confirm_token_hash = excluded.confirm_token_hash,
       status = 'pending',
       expires_at = excluded.expires_at,
       confirmed_at = NULL,
       canceled_at = NULL,
       callback_event_id = NULL,
       updated_at = ${nowSql}`,
    [params.runId, params.userId, tokenHash, expiresAt]
  )

  await db.exec(
    `UPDATE openclaw_command_runs
     SET status = 'pending_confirm',
         confirm_required = ?,
         confirm_expires_at = ?,
         updated_at = ${nowSql}
     WHERE id = ? AND user_id = ?`,
    [boolParam(true, db.type), expiresAt, params.runId, params.userId]
  )

  return {
    confirmToken,
    expiresAt,
  }
}

export async function consumeCommandConfirmation(params: {
  runId: string
  userId: number
  confirmToken: string
  decision: ConfirmDecision
  callbackEventId?: string | null
}): Promise<ConsumeConfirmResult> {
  return consumeCommandConfirmationInternal({
    runId: params.runId,
    userId: params.userId,
    decision: params.decision,
    callbackEventId: params.callbackEventId,
    confirmToken: params.confirmToken,
    requireTokenCheck: true,
  })
}

export async function consumeCommandConfirmationByOwner(params: {
  runId: string
  userId: number
  decision: ConfirmDecision
}): Promise<ConsumeConfirmResult> {
  return consumeCommandConfirmationInternal({
    runId: params.runId,
    userId: params.userId,
    decision: params.decision,
    requireTokenCheck: false,
  })
}

async function consumeCommandConfirmationInternal(params: {
  runId: string
  userId: number
  decision: ConfirmDecision
  callbackEventId?: string | null
  confirmToken?: string
  requireTokenCheck: boolean
}): Promise<ConsumeConfirmResult> {
  const db = await getDatabase()
  const nowSql = nowFunc(db.type)

  await expireStaleCommandConfirmations({ userId: params.userId })

  const row = await db.queryOne<{
    run_id: string
    user_id: number
    confirm_token_hash: string
    status: string
    expires_at: string
    run_status: string
    risk_level: string
  }>(
    `SELECT
       c.run_id,
       c.user_id,
       c.confirm_token_hash,
       c.status,
       c.expires_at,
       r.status AS run_status,
       r.risk_level
     FROM openclaw_command_confirms c
     INNER JOIN openclaw_command_runs r ON r.id = c.run_id
     WHERE c.run_id = ? AND c.user_id = ?
     LIMIT 1`,
    [params.runId, params.userId]
  )

  if (!row) {
    return { ok: false, code: 'not_found' }
  }

  if (row.status !== 'pending') {
    return {
      ok: false,
      code: 'already_processed',
      confirmStatus: row.status,
      runStatus: row.run_status,
    }
  }

  const expiresAtMs = Date.parse(row.expires_at)
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
    await db.exec(
      `UPDATE openclaw_command_confirms
       SET status = 'expired',
           updated_at = ${nowSql}
       WHERE run_id = ? AND user_id = ?`,
      [params.runId, params.userId]
    )

    await db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'expired',
           updated_at = ${nowSql}
       WHERE id = ? AND user_id = ?`,
      [params.runId, params.userId]
    )

    return { ok: false, code: 'expired', confirmStatus: 'expired', runStatus: 'expired' }
  }

  if (params.requireTokenCheck) {
    const confirmToken = String(params.confirmToken || '').trim()
    if (!confirmToken || !safeTokenHashCompare(confirmToken, row.confirm_token_hash)) {
      return { ok: false, code: 'invalid_token' }
    }
  }

  if (params.decision === 'cancel') {
    await db.exec(
      `UPDATE openclaw_command_confirms
       SET status = 'canceled',
           canceled_at = ${nowSql},
           callback_event_id = COALESCE(?, callback_event_id),
           updated_at = ${nowSql}
       WHERE run_id = ? AND user_id = ?`,
      [params.callbackEventId || null, params.runId, params.userId]
    )

    await db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'canceled',
           updated_at = ${nowSql}
       WHERE id = ? AND user_id = ?`,
      [params.runId, params.userId]
    )

    return {
      ok: true,
      status: 'canceled',
      runId: params.runId,
      userId: params.userId,
      riskLevel: row.risk_level,
      confirmStatus: 'canceled',
    }
  }

  await db.exec(
    `UPDATE openclaw_command_confirms
     SET status = 'confirmed',
         confirmed_at = ${nowSql},
         callback_event_id = COALESCE(?, callback_event_id),
         updated_at = ${nowSql}
     WHERE run_id = ? AND user_id = ?`,
    [params.callbackEventId || null, params.runId, params.userId]
  )

  await db.exec(
    `UPDATE openclaw_command_runs
     SET status = 'confirmed',
         updated_at = ${nowSql}
     WHERE id = ? AND user_id = ?`,
    [params.runId, params.userId]
  )

  return {
    ok: true,
    status: 'confirmed',
    runId: params.runId,
    userId: params.userId,
    riskLevel: row.risk_level,
    confirmStatus: 'confirmed',
  }
}

export async function recordOpenclawCallbackEvent(params: {
  userId: number
  channel: string
  eventId: string
  eventType?: string | null
  payloadJson?: string | null
}): Promise<{ accepted: boolean }> {
  const db = await getDatabase()
  const result = await db.exec(
    `INSERT INTO openclaw_callback_events
     (user_id, channel, event_id, event_type, payload_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(channel, event_id)
     DO NOTHING`,
    [
      params.userId,
      params.channel,
      params.eventId,
      params.eventType || null,
      params.payloadJson || null,
    ]
  )

  return {
    accepted: Number(result.changes || 0) > 0,
  }
}
