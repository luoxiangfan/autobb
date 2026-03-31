import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'
import { feishuRequest, getTenantAccessToken, resolveFeishuApiBase } from '@/lib/openclaw/feishu-api'
import { getOpenclawSettingsMap } from '@/lib/openclaw/settings'

type FeishuReceiveIdType = 'open_id' | 'union_id' | 'chat_id'

type FeishuVerifySession = {
  id: string
  userId: number
  appId: string
  appSecret: string
  domain: string
  target: string
  receiveIdType: FeishuReceiveIdType
  chatId: string
  expectedSenderOpenId: string
  code: string
  createdAt: number
  expiresAt: number
  testMessageId: string | null
}

const VERIFY_TTL_MS = 5 * 60 * 1000
const sessions = new Map<string, FeishuVerifySession>()

const startSchema = z.object({
  action: z.literal('start'),
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  domain: z.string().optional(),
  target: z.string().optional(),
  expectedSenderOpenId: z.string().optional(),
})

const checkSchema = z.object({
  action: z.literal('check'),
  verificationId: z.string().min(8),
  debug: z.boolean().optional(),
})

const requestSchema = z.union([startSchema, checkSchema])

function pickFirstText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

function normalizeFeishuId(value?: string | null): string {
  return String(value || '').trim().replace(/^(feishu|lark):/i, '').toLowerCase()
}

function parseFeishuTarget(input?: string | null): {
  target: string
  receiveIdType: FeishuReceiveIdType
} | null {
  const raw = String(input || '').trim()
  if (!raw) return null

  const normalized = raw.replace(/^(feishu|lark):/i, '').trim()
  if (!normalized) return null

  const typed = normalized.match(/^(open_id|union_id|chat_id):(.+)$/i)
  if (typed) {
    const receiveIdType = typed[1].toLowerCase() as FeishuReceiveIdType
    const target = typed[2].trim()
    if (!target) return null
    return { target, receiveIdType }
  }

  const userTyped = normalized.match(/^(user|dm):(.+)$/i)
  if (userTyped) {
    const target = userTyped[2].trim()
    if (!target) return null
    return { target, receiveIdType: 'open_id' }
  }

  const chatTyped = normalized.match(/^(chat|group):(.+)$/i)
  if (chatTyped) {
    const target = chatTyped[2].trim()
    if (!target) return null
    return { target, receiveIdType: 'chat_id' }
  }

  if (normalized.startsWith('ou_')) {
    return { target: normalized, receiveIdType: 'open_id' }
  }
  if (normalized.startsWith('on_')) {
    return { target: normalized, receiveIdType: 'union_id' }
  }
  if (normalized.startsWith('oc_')) {
    return { target: normalized, receiveIdType: 'chat_id' }
  }

  return null
}

function parseAllowFromOpenIds(rawValue?: string | null): string[] {
  if (!rawValue) return []
  try {
    const parsed = JSON.parse(rawValue)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => normalizeFeishuId(String(entry || '')))
      .filter((entry) => entry.startsWith('ou_'))
  } catch {
    return []
  }
}

function resolveExpectedSenderOpenId(params: {
  receiveIdType: FeishuReceiveIdType
  target: string
  expectedSenderOpenIdInput?: string
  allowFromRaw?: string | null
}): string | null {
  if (params.receiveIdType === 'open_id') {
    return normalizeFeishuId(params.target)
  }

  const fromInput = normalizeFeishuId(params.expectedSenderOpenIdInput)
  if (fromInput.startsWith('ou_')) {
    return fromInput
  }

  const allowFromOpenIds = parseAllowFromOpenIds(params.allowFromRaw)
  if (allowFromOpenIds.length === 1) {
    return allowFromOpenIds[0]
  }

  return null
}

function generateVerificationCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let result = ''
  for (let i = 0; i < 6; i += 1) {
    const index = Math.floor(Math.random() * chars.length)
    result += chars[index]
  }
  return result
}

function cleanupExpiredSessions(now = Date.now()) {
  for (const [id, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(id)
    }
  }
}

function parseCreateTimeMs(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed
}

function extractSenderOpenId(message: any): string | null {
  const senderIdRaw = typeof message?.sender?.id === 'string'
    ? message.sender.id
    : null

  const senderIdType = String(message?.sender?.id_type || '').trim().toLowerCase()

  const candidates = [
    senderIdType === 'open_id' ? senderIdRaw : null,
    senderIdRaw,
    message?.sender?.id?.open_id,
    message?.sender?.sender_id?.open_id,
    message?.sender?.open_id,
    message?.open_id,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeFeishuId(candidate)
    if (normalized.startsWith('ou_')) return normalized
  }

  return null
}

function extractTextFromMessage(message: any): string {
  const contentCandidates = [
    message?.body?.content,
    message?.content,
  ]

  for (const candidate of contentCandidates) {
    if (candidate && typeof candidate === 'object') {
      const text = String((candidate as any)?.text || '').trim()
      if (text) return text
    }

    const raw = String(candidate || '').trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      const text = String(parsed?.text || '').trim()
      if (text) return text
    } catch {
      if (raw) return raw
    }
  }

  return ''
}

async function resolveSenderOpenIdFromMessageDetail(params: {
  apiBase: string
  token: string
  messageId?: string | null
}): Promise<string | null> {
  const messageId = String(params.messageId || '').trim()
  if (!messageId) return null

  try {
    const detail = await feishuRequest<{ data?: { items?: any[]; sender?: any } }>({
      method: 'GET',
      url: `${params.apiBase}/im/v1/messages/${encodeURIComponent(messageId)}?user_id_type=open_id`,
      token: params.token,
    })

    const item = Array.isArray(detail?.data?.items) ? detail?.data?.items?.[0] : null
    const sender = item || { sender: detail?.data?.sender }
    return extractSenderOpenId(sender)
  } catch {
    return null
  }
}

async function resolveChatIdForStartMessage(params: {
  apiBase: string
  token: string
  receiveIdType: FeishuReceiveIdType
  target: string
  chatIdFromSend?: string | null
  messageId?: string | null
}): Promise<string> {
  if (params.receiveIdType === 'chat_id') {
    return params.target
  }

  const chatIdFromSend = String(params.chatIdFromSend || '').trim()
  if (chatIdFromSend) {
    return chatIdFromSend
  }

  const messageId = String(params.messageId || '').trim()
  if (!messageId) {
    throw new Error('发送验证消息成功，但未返回 chat_id/message_id，无法建立双向验证会话')
  }

  const detail = await feishuRequest<{ data?: { chat_id?: string } }>({
    method: 'GET',
    url: `${params.apiBase}/im/v1/messages/${encodeURIComponent(messageId)}`,
    token: params.token,
  })

  const chatId = String(detail?.data?.chat_id || '').trim()
  if (!chatId) {
    throw new Error('无法解析测试消息对应的 chat_id，请稍后重试')
  }

  return chatId
}

async function startVerification(params: {
  userId: number
  appId: string
  appSecret: string
  domain: string
  target: string
  receiveIdType: FeishuReceiveIdType
  expectedSenderOpenId: string
}) {
  cleanupExpiredSessions()

  const tenantAccessToken = await getTenantAccessToken({
    appId: params.appId,
    appSecret: params.appSecret,
    domain: params.domain,
  })

  const apiBase = resolveFeishuApiBase(params.domain)
  const code = generateVerificationCode()
  const now = Date.now()
  const expiresAt = now + VERIFY_TTL_MS

  const sendPayload = {
    receive_id: params.target,
    msg_type: 'text',
    content: JSON.stringify({
      text: [
        '【OpenClaw 双向通信验证】',
        `验证码：${code}`,
        '请在当前会话内回复该验证码（原样回复）。',
        '验证码 5 分钟内有效。',
      ].join('\n'),
    }),
  }

  const sendResult = await feishuRequest<{ data?: { message_id?: string } }>({
    method: 'POST',
    url: `${apiBase}/im/v1/messages?receive_id_type=${params.receiveIdType}`,
    token: tenantAccessToken,
    body: sendPayload,
  })

  const testMessageId = String(sendResult?.data?.message_id || '').trim() || null
  const chatIdFromSend = String((sendResult as any)?.data?.chat_id || '').trim() || null
  const chatId = await resolveChatIdForStartMessage({
    apiBase,
    token: tenantAccessToken,
    receiveIdType: params.receiveIdType,
    target: params.target,
    chatIdFromSend,
    messageId: testMessageId,
  })

  const session: FeishuVerifySession = {
    id: randomUUID(),
    userId: params.userId,
    appId: params.appId,
    appSecret: params.appSecret,
    domain: params.domain,
    target: params.target,
    receiveIdType: params.receiveIdType,
    chatId,
    expectedSenderOpenId: params.expectedSenderOpenId,
    code,
    createdAt: now,
    expiresAt,
    testMessageId,
  }

  sessions.set(session.id, session)

  return {
    verificationId: session.id,
    code: session.code,
    expiresAt: session.expiresAt,
    receiveIdType: session.receiveIdType,
    target: session.target,
    expectedSenderOpenId: session.expectedSenderOpenId,
  }
}

async function checkVerification(params: {
  userId: number
  verificationId: string
  debug?: boolean
}) {
  cleanupExpiredSessions()

  const session = sessions.get(params.verificationId)
  if (!session || session.userId !== params.userId) {
    return {
      found: false,
      verified: false,
      pending: false,
      message: '验证会话不存在或已失效，请重新发起双向验证',
    }
  }

  const now = Date.now()
  if (session.expiresAt <= now) {
    sessions.delete(session.id)
    return {
      found: true,
      verified: false,
      pending: false,
      expired: true,
      message: '验证码已过期，请重新发起双向验证',
    }
  }

  const tenantAccessToken = await getTenantAccessToken({
    appId: session.appId,
    appSecret: session.appSecret,
    domain: session.domain,
  })
  const apiBase = resolveFeishuApiBase(session.domain)

  const messagesResult = await feishuRequest<{ data?: { items?: any[] } }>({
    method: 'GET',
    url: `${apiBase}/im/v1/messages?container_id_type=chat&container_id=${encodeURIComponent(session.chatId)}&sort_type=ByCreateTimeDesc&page_size=50&user_id_type=open_id`,
    token: tenantAccessToken,
  })

  const items = Array.isArray(messagesResult?.data?.items) ? messagesResult.data.items : []
  const expectedSender = normalizeFeishuId(session.expectedSenderOpenId)
  const codeUpper = session.code.toUpperCase()

  const diagnostics = {
    totalItems: items.length,
    skippedSelfMessage: 0,
    skippedOldMessage: 0,
    codeMatched: 0,
    senderMatchedDirect: 0,
    senderDetailLookups: 0,
    senderMatchedViaDetail: 0,
  }

  const senderDetailCache = new Map<string, string | null>()
  let matched: any = null
  let matchedSenderOpenId: string | null = null

  for (const item of items) {
    const messageId = String(item?.message_id || '').trim()
    if (messageId && session.testMessageId && messageId === session.testMessageId) {
      diagnostics.skippedSelfMessage += 1
      continue
    }

    const createdAtMs = parseCreateTimeMs(item?.create_time)
    if (!createdAtMs || createdAtMs + 3_000 < session.createdAt) {
      diagnostics.skippedOldMessage += 1
      continue
    }

    const text = extractTextFromMessage(item)
    if (!text || !text.toUpperCase().includes(codeUpper)) {
      continue
    }

    diagnostics.codeMatched += 1

    let senderOpenId = extractSenderOpenId(item)
    if (senderOpenId && normalizeFeishuId(senderOpenId) === expectedSender) {
      diagnostics.senderMatchedDirect += 1
    }

    if ((!senderOpenId || normalizeFeishuId(senderOpenId) !== expectedSender) && messageId) {
      if (!senderDetailCache.has(messageId)) {
        diagnostics.senderDetailLookups += 1
        const resolved = await resolveSenderOpenIdFromMessageDetail({
          apiBase,
          token: tenantAccessToken,
          messageId,
        })
        senderDetailCache.set(messageId, resolved)
      }
      senderOpenId = senderDetailCache.get(messageId) || null
      if (senderOpenId && normalizeFeishuId(senderOpenId) === expectedSender) {
        diagnostics.senderMatchedViaDetail += 1
      }
    }

    if (!senderOpenId || normalizeFeishuId(senderOpenId) !== expectedSender) {
      continue
    }

    matched = item
    matchedSenderOpenId = senderOpenId
    break
  }

  if (matched) {
    sessions.delete(session.id)
    return {
      found: true,
      verified: true,
      pending: false,
      message: '双向通信验证成功：已确认飞书回执可回流到当前 OpenClaw 链路',
      matchedMessage: {
        messageId: String(matched?.message_id || '').trim() || null,
        createdAt: parseCreateTimeMs(matched?.create_time),
        senderOpenId: matchedSenderOpenId || extractSenderOpenId(matched),
      },
    }
  }

  return {
    found: true,
    verified: false,
    pending: true,
    message: '暂未检测到有效验证码回执，请在飞书当前会话中回复验证码后重试',
    expiresAt: session.expiresAt,
    expectedSenderOpenId: session.expectedSenderOpenId,
    diagnostics: params.debug ? diagnostics : undefined,
  }
}

export async function POST(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = requestSchema.safeParse(body || {})
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || '请求参数不合法' }, { status: 400 })
  }

  if (parsed.data.action === 'start') {
    const settingsMap = await getOpenclawSettingsMap(auth.user.userId)

    const appId = pickFirstText(parsed.data.appId, settingsMap.feishu_app_id)
    const appSecret = pickFirstText(parsed.data.appSecret, settingsMap.feishu_app_secret)
    const domain = pickFirstText(parsed.data.domain, settingsMap.feishu_domain, 'feishu')
    const targetInput = pickFirstText(parsed.data.target, settingsMap.feishu_target)

    if (!appId) {
      return NextResponse.json({ error: '请先填写飞书 App ID' }, { status: 400 })
    }
    if (!appSecret) {
      return NextResponse.json({ error: '请先填写飞书 App Secret' }, { status: 400 })
    }
    if (!targetInput) {
      return NextResponse.json({ error: '请先填写飞书推送目标（open_id / union_id / chat_id）' }, { status: 400 })
    }

    const parsedTarget = parseFeishuTarget(targetInput)
    if (!parsedTarget) {
      return NextResponse.json(
        { error: '推送目标格式不正确，请使用 open_id/union_id/chat_id（如 ou_xxx / on_xxx / oc_xxx）' },
        { status: 400 }
      )
    }

    const expectedSenderOpenId = resolveExpectedSenderOpenId({
      receiveIdType: parsedTarget.receiveIdType,
      target: parsedTarget.target,
      expectedSenderOpenIdInput: parsed.data.expectedSenderOpenId,
      allowFromRaw: settingsMap.feishu_allow_from,
    })

    if (!expectedSenderOpenId) {
      return NextResponse.json(
        {
          error: parsedTarget.receiveIdType === 'open_id'
            ? '无法解析验证发送者 open_id'
            : '当前 target 不是 open_id，请填写“验证发送者 open_id”（或确保 allowFrom 仅包含一个 open_id）',
        },
        { status: 400 }
      )
    }

    try {
      const result = await startVerification({
        userId: auth.user.userId,
        appId,
        appSecret,
        domain,
        target: parsedTarget.target,
        receiveIdType: parsedTarget.receiveIdType,
        expectedSenderOpenId,
      })

      return NextResponse.json({
        success: true,
        step: 'pending',
        message: '验证码已发送，请在飞书当前会话回复验证码后点击“校验回执”',
        verification: result,
      })
    } catch (error: any) {
      console.error('[openclaw][feishu-verify] start failed:', {
        userId: auth.user.userId,
        domain,
        target: parsedTarget.target,
        receiveIdType: parsedTarget.receiveIdType,
        error: error?.message || String(error),
      })
      return NextResponse.json(
        {
          success: false,
          error: error?.message || '发起双向验证失败',
        },
        { status: 502 }
      )
    }
  }

  try {
    const check = await checkVerification({
      userId: auth.user.userId,
      verificationId: parsed.data.verificationId,
      debug: Boolean(parsed.data.debug),
    })

    if (!check.found) {
      return NextResponse.json({ success: false, ...check }, { status: 404 })
    }

    if (check.expired) {
      return NextResponse.json({ success: false, ...check }, { status: 410 })
    }

    return NextResponse.json({ success: true, ...check })
  } catch (error: any) {
    console.error('[openclaw][feishu-verify] check failed:', {
      userId: auth.user.userId,
      verificationId: parsed.data.verificationId,
      error: error?.message || String(error),
    })
    return NextResponse.json(
      {
        success: false,
        error: error?.message || '校验双向验证状态失败',
      },
      { status: 502 }
    )
  }
}
