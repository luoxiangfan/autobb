import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'
import { getOpenclawSettingsMap } from '@/lib/openclaw/settings'
import { feishuRequest, getTenantAccessToken, resolveFeishuApiBase } from '@/lib/openclaw/feishu-api'

const feishuTestSchema = z.object({
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  domain: z.string().optional(),
  target: z.string().optional(),
})

type FeishuReceiveIdType = 'open_id' | 'union_id' | 'chat_id'

function pickFirstText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
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

function resolveTargetHint(receiveIdType: FeishuReceiveIdType): string {
  if (receiveIdType === 'chat_id') {
    return 'chat_id 已做远端可达性检查'
  }
  return `${receiveIdType} 已做格式检查（不发送测试消息）`
}

export async function POST(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = feishuTestSchema.safeParse(body || {})
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || '请求参数不合法' }, { status: 400 })
  }

  const payload = parsed.data
  const settingMap = await getOpenclawSettingsMap(auth.user.userId)

  const appId = pickFirstText(payload.appId, settingMap.feishu_app_id)
  const appSecret = pickFirstText(payload.appSecret, settingMap.feishu_app_secret)
  const domain = pickFirstText(payload.domain, settingMap.feishu_domain, 'feishu')
  const targetInput = pickFirstText(payload.target, settingMap.feishu_target)

  if (!appId) {
    return NextResponse.json({ error: '请先填写飞书 App ID' }, { status: 400 })
  }
  if (!appSecret) {
    return NextResponse.json({ error: '请先填写飞书 App Secret' }, { status: 400 })
  }
  if (!targetInput) {
    return NextResponse.json({ error: '请先填写飞书推送目标（open_id / union_id / chat_id）' }, { status: 400 })
  }

  const target = parseFeishuTarget(targetInput)
  if (!target) {
    return NextResponse.json(
      { error: '推送目标格式不正确，请使用 open_id/union_id/chat_id（如 ou_xxx / on_xxx / oc_xxx）' },
      { status: 400 }
    )
  }

  try {
    const tenantAccessToken = await getTenantAccessToken({
      appId,
      appSecret,
      domain,
    })

    const apiBase = resolveFeishuApiBase(domain)
    const botInfo = await feishuRequest<{ bot?: { app_name?: string } }>({
      method: 'GET',
      url: `${apiBase}/bot/v3/info`,
      token: tenantAccessToken,
    })

    if (target.receiveIdType === 'chat_id') {
      await feishuRequest({
        method: 'GET',
        url: `${apiBase}/im/v1/chats/${encodeURIComponent(target.target)}`,
        token: tenantAccessToken,
      })
    }

    const botName = (botInfo.bot?.app_name || '').trim()
    const targetHint = resolveTargetHint(target.receiveIdType)
    const message = botName
      ? `连接成功：Bot=${botName}，目标类型=${target.receiveIdType}，${targetHint}`
      : `连接成功：目标类型=${target.receiveIdType}，${targetHint}`

    return NextResponse.json({
      success: true,
      ok: true,
      message,
      details: {
        receiveIdType: target.receiveIdType,
        target: target.target,
        botName: botName || null,
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        ok: false,
        error: error?.message || 'Feishu 连接测试失败',
      },
      { status: 502 }
    )
  }
}
