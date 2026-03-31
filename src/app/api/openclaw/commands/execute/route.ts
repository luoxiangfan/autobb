import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { executeOpenclawCommand } from '@/lib/openclaw/commands/command-service'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'
import {
  resolveOpenclawParentRequestId,
  resolveOpenclawParentRequestIdFromHeaders,
} from '@/lib/openclaw/request-correlation'

export const dynamic = 'force-dynamic'

const executeSchema = z.object({
  method: z.string().min(1),
  path: z.string().min(1),
  query: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  body: z.unknown().optional(),
  channel: z.string().optional(),
  accountId: z.string().optional(),
  account_id: z.string().optional(),
  tenantKey: z.string().optional(),
  tenant_key: z.string().optional(),
  senderId: z.string().optional(),
  sender_id: z.string().optional(),
  senderOpenId: z.string().optional(),
  sender_open_id: z.string().optional(),
  intent: z.string().optional(),
  idempotencyKey: z.string().optional(),
  parentRequestId: z.string().optional(),
  parent_request_id: z.string().optional(),
})

function normalizeHeaderValue(value: string | null | undefined): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null)
    const parsed = executeSchema.safeParse(rawBody)

    const channelFromBody = parsed.success
      ? normalizeHeaderValue(parsed.data.channel)
      : undefined
    const senderIdFromBody = parsed.success
      ? normalizeHeaderValue(
        parsed.data.senderId
        || parsed.data.sender_id
        || parsed.data.senderOpenId
        || parsed.data.sender_open_id
      )
      : undefined
    const accountIdFromBody = parsed.success
      ? normalizeHeaderValue(parsed.data.accountId || parsed.data.account_id)
      : undefined
    const tenantKeyFromBody = parsed.success
      ? normalizeHeaderValue(parsed.data.tenantKey || parsed.data.tenant_key)
      : undefined

    const auth = await resolveOpenclawRequestUser(request, {
      channel: channelFromBody,
      senderId: senderIdFromBody,
      accountId: accountIdFromBody,
      tenantKey: tenantKeyFromBody,
    })
    if (!auth) {
      return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
    }

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message || '请求参数错误' },
        { status: 400 }
      )
    }

    const channel = normalizeHeaderValue(
      parsed.data.channel
      || request.headers.get('x-openclaw-channel')
      || request.headers.get('x-channel')
    )

    const senderId = normalizeHeaderValue(
      parsed.data.senderId
      || parsed.data.sender_id
      || parsed.data.senderOpenId
      || parsed.data.sender_open_id
      || request.headers.get('x-openclaw-sender')
      || request.headers.get('x-openclaw-sender-id')
      || request.headers.get('x-openclaw-sender-open-id')
    )

    const parentRequestFromHeaders = resolveOpenclawParentRequestIdFromHeaders(request.headers)
    const parentRequestFromBody = normalizeHeaderValue(
      parsed.data.parentRequestId || parsed.data.parent_request_id
    )
    const accountId = normalizeHeaderValue(
      parsed.data.accountId
      || parsed.data.account_id
      || request.headers.get('x-openclaw-account-id')
    )
    const parentRequestId = await resolveOpenclawParentRequestId({
      explicitParentRequestId: parentRequestFromBody || parentRequestFromHeaders.parentRequestId,
      explicitSource: parentRequestFromBody ? 'manual' : parentRequestFromHeaders.source,
      userId: auth.userId,
      channel,
      senderId,
      accountId,
    })

    const result = await executeOpenclawCommand({
      userId: auth.userId,
      authType: auth.authType,
      method: parsed.data.method,
      path: parsed.data.path,
      query: parsed.data.query,
      body: parsed.data.body,
      channel,
      senderId,
      intent: parsed.data.intent,
      idempotencyKey: parsed.data.idempotencyKey,
      parentRequestId,
    })

    const status = result.status === 'pending_confirm' ? 202 : 200
    return NextResponse.json({ success: true, ...result }, { status })
  } catch (error: any) {
    console.error('[openclaw][commands/execute] request failed:', error)
    const message = error?.message || 'OpenClaw 命令执行失败'
    const status = message.includes('not allowed') || message.includes('Invalid') || message.includes('blocked')
      || message.includes('canonical web flow')
      || message.includes('only support write methods')
      || message.includes('only supports write methods')
      || message.includes('A/B/D flow')
      ? 400
      : 500
    return NextResponse.json({ error: message }, { status })
  }
}
