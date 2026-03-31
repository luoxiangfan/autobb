import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  confirmOpenclawCommand,
  confirmOpenclawCommandByOwner,
} from '@/lib/openclaw/commands/command-service'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'
import {
  resolveOpenclawParentRequestId,
  resolveOpenclawParentRequestIdFromHeaders,
} from '@/lib/openclaw/request-correlation'

export const dynamic = 'force-dynamic'

const confirmSchema = z.object({
  runId: z.string().min(1),
  confirmToken: z.string().min(8).optional(),
  decision: z.enum(['confirm', 'cancel']).optional(),
  action: z.enum(['confirm', 'cancel']).optional(),
  channel: z.string().optional(),
  senderId: z.string().optional(),
  sender_id: z.string().optional(),
  senderOpenId: z.string().optional(),
  sender_open_id: z.string().optional(),
  accountId: z.string().optional(),
  account_id: z.string().optional(),
  tenantKey: z.string().optional(),
  tenant_key: z.string().optional(),
  callbackEventId: z.string().optional(),
  callbackEventType: z.string().optional(),
  callbackPayload: z.unknown().optional(),
})

function normalizeHeaderValue(value: string | null | undefined): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

function isGatewayBindingConfirmAllowed(): boolean {
  const normalized = String(process.env.OPENCLAW_CONFIRM_ALLOW_GATEWAY_BINDING || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null)
    const parsed = confirmSchema.safeParse(rawBody)

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
    if (auth.authType === 'gateway-binding' && !isGatewayBindingConfirmAllowed()) {
      return NextResponse.json(
        {
          error: '已禁用 gateway-binding 直连确认，请改用 Web 控制台会话或用户令牌执行确认。',
          code: 'gateway_binding_confirm_disabled',
        },
        { status: 403 }
      )
    }

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message || '请求参数错误' },
        { status: 400 }
      )
    }

    const decision = parsed.data.decision || parsed.data.action || 'confirm'
    const channel = parsed.data.channel || request.headers.get('x-openclaw-channel') || undefined
    const senderId = normalizeHeaderValue(
      parsed.data.senderId
      || parsed.data.sender_id
      || parsed.data.senderOpenId
      || parsed.data.sender_open_id
      || request.headers.get('x-openclaw-sender')
      || request.headers.get('x-openclaw-sender-id')
      || request.headers.get('x-openclaw-sender-open-id')
    )
    const accountId = normalizeHeaderValue(
      parsed.data.accountId
      || parsed.data.account_id
      || request.headers.get('x-openclaw-account-id')
    )

    const parentRequestFromHeaders = resolveOpenclawParentRequestIdFromHeaders(request.headers)
    const parentRequestId = await resolveOpenclawParentRequestId({
      explicitParentRequestId: parentRequestFromHeaders.parentRequestId,
      explicitSource: parentRequestFromHeaders.source,
      userId: auth.userId,
      channel,
      senderId,
      accountId,
    })

    const confirmToken = normalizeHeaderValue(parsed.data.confirmToken)
    const result = confirmToken
      ? await confirmOpenclawCommand({
          runId: parsed.data.runId,
          userId: auth.userId,
          confirmToken,
          decision,
          channel,
          callbackEventId: parsed.data.callbackEventId,
          callbackEventType: parsed.data.callbackEventType,
          callbackPayload: parsed.data.callbackPayload,
          parentRequestId,
        })
      : await (() => {
          if (auth.authType !== 'session') {
            return Promise.resolve({
              status: 'invalid_token' as const,
              runId: parsed.data.runId,
            })
          }
          return confirmOpenclawCommandByOwner({
            runId: parsed.data.runId,
            userId: auth.userId,
            decision,
            parentRequestId,
          })
        })()

    if (result.status === 'not_found') {
      return NextResponse.json({ error: '命令不存在', ...result }, { status: 404 })
    }

    if (result.status === 'invalid_token') {
      return NextResponse.json({ error: '确认凭证无效', ...result }, { status: 403 })
    }

    if (result.status === 'expired') {
      return NextResponse.json({ error: '确认已过期', ...result }, { status: 410 })
    }

    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error('[openclaw][commands/confirm] request failed:', error)
    const message = error?.message || 'OpenClaw 命令确认失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
