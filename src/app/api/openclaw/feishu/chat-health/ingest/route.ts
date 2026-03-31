import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import {
  type FeishuChatHealthDecision,
  backfillFeishuChatHealthRunLinks,
  recordFeishuChatHealthLog,
} from '@/lib/openclaw/feishu-chat-health'
import { verifyOpenclawGatewayToken } from '@/lib/openclaw/auth'
import { parseFeishuAccountUserId } from '@/lib/openclaw/feishu-accounts'
import { resolveOpenclawUserFromBinding } from '@/lib/openclaw/bindings'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'

const ingestSchema = z.record(z.any())

type RawIngestPayload = z.infer<typeof ingestSchema>
type IngestPayload = {
  accountId: string
  messageId?: string
  chatId?: string
  chatType?: string
  messageType?: string
  senderPrimaryId?: string
  senderOpenId?: string
  senderUnionId?: string
  senderUserId?: string
  senderCandidates: string[]
  decision: FeishuChatHealthDecision
  reasonCode: string
  reasonMessage?: string
  messageText?: string
  messageReceivedAt?: string
  replyDispatchedAt?: string
  metadata?: Record<string, unknown>
  tenantKey?: string
}

const FEISHU_CHAT_HEALTH_NOISE_REASON_CODE = 'duplicate_message'

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const value = authHeader.trim()
  if (!value) return null
  if (value.toLowerCase().startsWith('bearer ')) {
    return value.slice(7).trim()
  }
  return value
}

function normalizeFeishuId(value?: string | null): string {
  return String(value || '').trim().replace(/^(feishu|lark):/i, '').toLowerCase()
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function firstNonEmpty(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue
    }
    if (typeof value === 'string') {
      const normalized = value.trim()
      if (normalized) {
        return normalized
      }
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
  }
  return undefined
}

function epochToIso(value: number): string | undefined {
  if (!Number.isFinite(value)) return undefined
  const abs = Math.abs(value)
  const millis = abs >= 1e14
    ? Math.floor(value / 1000)
    : abs >= 1e11
      ? Math.floor(value)
      : Math.floor(value * 1000)
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
  }
  if (typeof value === 'number') {
    return epochToIso(value)
  }

  const text = String(value || '').trim()
  if (!text) return undefined
  if (/^\d+(\.\d+)?$/.test(text)) {
    return epochToIso(Number(text))
  }

  const hasTimezone = /z$/i.test(text) || /[+-]\d{2}:\d{2}$/.test(text)
  const normalized = text.includes('T')
    ? (hasTimezone ? text : `${text}Z`)
    : `${text.replace(' ', 'T')}${hasTimezone ? '' : 'Z'}`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

function firstTimestamp(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    const normalized = normalizeTimestamp(value)
    if (normalized) return normalized
  }
  return undefined
}

function isFeishuMessageId(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized.startsWith('om_')
}

function firstFeishuMessageId(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    const candidate = firstNonEmpty(value)
    if (!candidate) continue
    if (!isFeishuMessageId(candidate)) continue
    return candidate
  }
  return undefined
}

function valueByKeys(source: Record<string, unknown> | undefined, keys: string[]): unknown {
  if (!source) return undefined
  for (const key of keys) {
    const value = source[key]
    if (value !== null && value !== undefined) {
      if (typeof value === 'string' && !value.trim()) {
        continue
      }
      return value
    }
  }
  return undefined
}

function arrayTextByKeys(source: Record<string, unknown> | undefined, keys: string[]): string[] {
  const value = valueByKeys(source, keys)
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (item === null || item === undefined) return ''
      if (typeof item === 'string') return item.trim()
      if (typeof item === 'number' || typeof item === 'boolean') return String(item)
      return ''
    })
    .filter(Boolean)
}

function normalizeDecision(value: unknown): FeishuChatHealthDecision | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return null

  if (['allowed', 'allow', 'accepted', 'pass', 'ok', 'success'].includes(normalized)) {
    return 'allowed'
  }
  if (['blocked', 'block', 'denied', 'deny', 'filtered', 'reject', 'rejected'].includes(normalized)) {
    return 'blocked'
  }
  if (['error', 'failed', 'failure', 'exception'].includes(normalized)) {
    return 'error'
  }

  return null
}

function normalizeReasonCode(value: unknown, decision: FeishuChatHealthDecision): string {
  const explicit = firstNonEmpty(value)
  if (explicit) return explicit
  if (decision === 'allowed') return 'reply_dispatched'
  if (decision === 'blocked') return 'blocked_by_policy'
  return 'dispatch_error'
}

function normalizeReasonCodeKey(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeIngestPayload(raw: RawIngestPayload): IngestPayload | null {
  const metadata = asRecord(raw.metadata)
  const sender = asRecord(raw.sender)
  const senderInMetadata = asRecord(metadata?.sender)

  const accountId = firstNonEmpty(
    raw.accountId,
    raw.account_id,
    raw.account,
    metadata?.accountId,
    metadata?.account_id,
    metadata?.account
  ) || 'unknown'

  const senderPrimaryId = firstNonEmpty(
    raw.senderPrimaryId,
    raw.sender_primary_id,
    raw.senderId,
    raw.sender_id,
    sender?.primaryId,
    sender?.senderPrimaryId,
    sender?.id,
    senderInMetadata?.primaryId,
    senderInMetadata?.senderPrimaryId,
    senderInMetadata?.id,
    metadata?.senderId,
    metadata?.sender_id
  )

  const senderOpenId = firstNonEmpty(
    raw.senderOpenId,
    raw.sender_open_id,
    sender?.openId,
    sender?.senderOpenId,
    senderInMetadata?.openId,
    senderInMetadata?.senderOpenId,
    metadata?.senderOpenId,
    metadata?.sender_open_id
  )

  const senderUnionId = firstNonEmpty(
    raw.senderUnionId,
    raw.sender_union_id,
    sender?.unionId,
    sender?.senderUnionId,
    senderInMetadata?.unionId,
    senderInMetadata?.senderUnionId,
    metadata?.senderUnionId,
    metadata?.sender_union_id
  )

  const senderUserId = firstNonEmpty(
    raw.senderUserId,
    raw.sender_user_id,
    sender?.userId,
    sender?.senderUserId,
    senderInMetadata?.userId,
    senderInMetadata?.senderUserId,
    metadata?.senderUserId,
    metadata?.sender_user_id
  )

  const senderCandidates = Array.from(
    new Set(
      [
        senderPrimaryId,
        senderOpenId,
        senderUnionId,
        senderUserId,
        ...arrayTextByKeys(raw, ['senderCandidates', 'sender_candidates']),
        ...arrayTextByKeys(sender, ['candidates', 'senderCandidates', 'sender_candidates']),
        ...arrayTextByKeys(senderInMetadata, ['candidates', 'senderCandidates', 'sender_candidates']),
        ...arrayTextByKeys(metadata, ['senderCandidates', 'sender_candidates']),
      ]
        .map((item) => normalizeFeishuId(item))
        .filter(Boolean)
    )
  )

  const decision = normalizeDecision(firstNonEmpty(
    raw.decision,
    raw.result,
    raw.status,
    metadata?.decision,
    metadata?.result,
    metadata?.status
  ))
  if (!decision) {
    return null
  }

  const reasonCode = normalizeReasonCode(
    firstNonEmpty(
      raw.reasonCode,
      raw.reason_code,
      raw.reason,
      raw.reasonType,
      raw.reason_type,
      metadata?.reasonCode,
      metadata?.reason_code,
      metadata?.reason,
      metadata?.reasonType,
      metadata?.reason_type
    ),
    decision
  )

  return {
    accountId,
    messageId: firstFeishuMessageId(
      raw.messageId,
      raw.message_id,
      raw.inboundMessageId,
      raw.inbound_message_id,
      raw.requestId,
      raw.request_id,
      raw.parentRequestId,
      raw.parent_request_id,
      metadata?.messageId,
      metadata?.message_id,
      metadata?.inboundMessageId,
      metadata?.inbound_message_id,
      metadata?.requestId,
      metadata?.request_id,
      metadata?.parentRequestId,
      metadata?.parent_request_id
    ),
    chatId: firstNonEmpty(raw.chatId, raw.chat_id, metadata?.chatId, metadata?.chat_id),
    chatType: firstNonEmpty(raw.chatType, raw.chat_type, metadata?.chatType, metadata?.chat_type),
    messageType: firstNonEmpty(raw.messageType, raw.message_type, metadata?.messageType, metadata?.message_type),
    senderPrimaryId,
    senderOpenId,
    senderUnionId,
    senderUserId,
    senderCandidates,
    decision,
    reasonCode,
    reasonMessage: firstNonEmpty(
      raw.reasonMessage,
      raw.reason_message,
      metadata?.reasonMessage,
      metadata?.reason_message
    ),
    messageText: firstNonEmpty(
      raw.messageText,
      raw.message_text,
      raw.text,
      metadata?.messageText,
      metadata?.message_text,
      metadata?.text
    ),
    messageReceivedAt: firstTimestamp(
      raw.messageReceivedAt,
      raw.message_received_at,
      raw.inboundMessageAt,
      raw.inbound_message_at,
      raw.messageCreateTime,
      raw.message_create_time,
      metadata?.messageReceivedAt,
      metadata?.message_received_at,
      metadata?.inboundMessageAt,
      metadata?.inbound_message_at,
      metadata?.messageCreateTime,
      metadata?.message_create_time
    ),
    replyDispatchedAt: firstTimestamp(
      raw.replyDispatchedAt,
      raw.reply_dispatched_at,
      raw.dispatchAt,
      raw.dispatch_at,
      raw.replySentAt,
      raw.reply_sent_at,
      raw.responseSentAt,
      raw.response_sent_at,
      metadata?.replyDispatchedAt,
      metadata?.reply_dispatched_at,
      metadata?.dispatchAt,
      metadata?.dispatch_at,
      metadata?.replySentAt,
      metadata?.reply_sent_at,
      metadata?.responseSentAt,
      metadata?.response_sent_at,
      metadata?.createdAt,
      metadata?.created_at,
      raw.createdAt,
      raw.created_at
    ),
    metadata,
    tenantKey: firstNonEmpty(raw.tenantKey, raw.tenant_key, metadata?.tenantKey, metadata?.tenant_key),
  }
}

async function resolveUserIdFromFeishuAppId(accountId: string): Promise<number | null> {
  const normalized = normalizeFeishuId(accountId)
  if (!normalized || normalized === 'unknown' || normalized.startsWith('user-')) {
    return null
  }

  const db = await getDatabase()
  const row = await db.queryOne<{ user_id: number }>(
    `SELECT user_id
     FROM system_settings
     WHERE category = 'openclaw'
       AND key = 'feishu_app_id'
       AND user_id IS NOT NULL
       AND lower(trim(value)) = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [normalized]
  )
  return row?.user_id ?? null
}

async function resolveUserIdForPayload(payload: IngestPayload): Promise<number | null> {
  const directUserId = parseFeishuAccountUserId(payload.accountId)
  if (directUserId) {
    return directUserId
  }

  const candidates = Array.from(new Set(payload.senderCandidates.map((item) => normalizeFeishuId(item)).filter(Boolean)))

  for (const senderId of candidates) {
    const resolved = await resolveOpenclawUserFromBinding('feishu', senderId, {
      accountId: payload.accountId,
      tenantKey: payload.tenantKey,
    })
    if (resolved) {
      return resolved
    }
  }

  return await resolveUserIdFromFeishuAppId(payload.accountId)
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined
  }

  const limitedEntries = Object.entries(metadata)
    .slice(0, 40)
    .map(([key, value]) => {
      const normalizedKey = String(key || '').trim().slice(0, 80)
      if (!normalizedKey) return null
      if (value === null || value === undefined) {
        return [normalizedKey, value] as const
      }
      if (typeof value === 'string') {
        return [normalizedKey, value.slice(0, 1000)] as const
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return [normalizedKey, value] as const
      }
      try {
        return [normalizedKey, JSON.parse(JSON.stringify(value))] as const
      } catch {
        return [normalizedKey, String(value)] as const
      }
    })
    .filter(Boolean) as Array<readonly [string, unknown]>

  return Object.fromEntries(limitedEntries)
}

async function ensureIngestAuthorized(request: NextRequest): Promise<
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string }
> {
  const gatewayToken = extractBearerToken(request.headers.get('authorization'))
  if (gatewayToken && await verifyOpenclawGatewayToken(gatewayToken)) {
    return { ok: true }
  }

  const sessionAuth = await verifyOpenclawSessionAuth(request)
  if (!sessionAuth.authenticated) {
    return {
      ok: false,
      status: sessionAuth.status,
      error: sessionAuth.error,
    }
  }

  if (sessionAuth.user.role !== 'admin') {
    return {
      ok: false,
      status: 403,
      error: '无权写入飞书聊天链路健康日志',
    }
  }

  return { ok: true }
}

export async function POST(request: NextRequest) {
  const authorized = await ensureIngestAuthorized(request)
  if (!authorized.ok) {
    return NextResponse.json({ error: authorized.error }, { status: authorized.status })
  }

  const rawBody = await request.json().catch(() => null)
  const parsed = ingestSchema.safeParse(rawBody || {})
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.errors[0]?.message || 'Invalid payload',
      },
      { status: 400 }
    )
  }

  try {
    const payload = normalizeIngestPayload(parsed.data)
    if (!payload) {
      return NextResponse.json(
        {
          error: 'decision 不能为空或格式不支持',
        },
        { status: 400 }
      )
    }

    // duplicate_message is expected transport-level redelivery noise, not a business-path block.
    // Skip persisting it to keep chain health focused on actionable failures.
    if (normalizeReasonCodeKey(payload.reasonCode) === FEISHU_CHAT_HEALTH_NOISE_REASON_CODE) {
      return NextResponse.json({
        success: true,
        stored: false,
        skippedReason: FEISHU_CHAT_HEALTH_NOISE_REASON_CODE,
      })
    }

    const userId = await resolveUserIdForPayload(payload)
    if (!userId) {
      console.warn('[openclaw] feishu chat health ingest skipped: user_unresolved', {
        accountId: payload.accountId,
        messageId: payload.messageId || null,
        tenantKeyProvided: Boolean(payload.tenantKey),
        senderCandidates: payload.senderCandidates.slice(0, 5),
      })
      return NextResponse.json({
        success: true,
        stored: false,
        skippedReason: 'user_unresolved',
      })
    }

    await recordFeishuChatHealthLog({
      userId,
      accountId: payload.accountId,
      messageId: payload.messageId,
      chatId: payload.chatId,
      chatType: payload.chatType,
      messageType: payload.messageType,
      senderPrimaryId: payload.senderPrimaryId,
      senderOpenId: payload.senderOpenId,
      senderUnionId: payload.senderUnionId,
      senderUserId: payload.senderUserId,
      senderCandidates: payload.senderCandidates,
      decision: payload.decision,
      reasonCode: payload.reasonCode,
      reasonMessage: payload.reasonMessage,
      messageText: payload.messageText,
      messageReceivedAt: payload.messageReceivedAt,
      replyDispatchedAt: payload.replyDispatchedAt,
      metadata: sanitizeMetadata(payload.metadata),
    })

    if (payload.decision === 'allowed' && payload.messageId) {
      const senderIds = Array.from(
        new Set(
          [
            ...payload.senderCandidates,
          ]
            .map((item) => normalizeFeishuId(item))
            .filter(Boolean)
        )
      )

      try {
        await backfillFeishuChatHealthRunLinks({
          userId,
          messageId: payload.messageId,
          senderIds,
        })
      } catch (err: any) {
        console.error('[openclaw] feishu chat health backfill failed:', err?.message || String(err))
      }
    }

    return NextResponse.json({
      success: true,
      stored: true,
      userId,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || '写入飞书聊天链路健康日志失败',
      },
      { status: 500 }
    )
  }
}
