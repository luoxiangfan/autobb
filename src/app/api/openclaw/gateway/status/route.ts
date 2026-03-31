import { NextRequest, NextResponse } from 'next/server'
import { getOpenclawGatewaySnapshot } from '@/lib/openclaw/gateway-ws'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'
import { syncOpenclawConfig } from '@/lib/openclaw/config'

function asRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, any>
}

function normalizeGatewayHealth(rawHealth: unknown): unknown {
  const health = asRecord(rawHealth)
  if (!health) return rawHealth

  const channels = asRecord(health.channels)
  if (!channels) return rawHealth

  let changed = false
  const nextChannels: Record<string, any> = { ...channels }

  for (const [channelId, channelValue] of Object.entries(channels)) {
    const channel = asRecord(channelValue)
    if (!channel) continue

    if (typeof channel.linked === 'boolean') {
      nextChannels[channelId] = channel
      continue
    }

    // OpenClaw Feishu status payload currently does not expose `linked`.
    // For AutoAds UI, treat Feishu "configured" as an explicit bound state.
    if (channelId === 'feishu' && typeof channel.configured === 'boolean') {
      nextChannels[channelId] = {
        ...channel,
        linked: channel.configured,
      }
      changed = true
      continue
    }

    nextChannels[channelId] = channel
  }

  if (!changed) return rawHealth
  return {
    ...health,
    channels: nextChannels,
  }
}

function normalizeGatewaySnapshot(snapshot: {
  fetchedAt: string
  health: any | null
  skills: any | null
  errors: string[]
}) {
  return {
    ...snapshot,
    health: normalizeGatewayHealth(snapshot.health),
  }
}

export async function GET(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const url = new URL(request.url)
  const force = url.searchParams.get('force') === '1'

  try {
    const snapshot = await getOpenclawGatewaySnapshot({ force })
    return NextResponse.json({ success: true, ...normalizeGatewaySnapshot(snapshot) })
  } catch (error: any) {
    const firstError = error?.message || '获取 Gateway 状态失败'
    console.error('[openclaw] gateway status fetch failed:', firstError)

    if (force) {
      try {
        await syncOpenclawConfig({
          reason: 'gateway-status-repair',
          actorUserId: auth.user.userId,
        })

        const repairedSnapshot = await getOpenclawGatewaySnapshot({ force: true })
        return NextResponse.json({
          success: true,
          recovered: true,
          warnings: [firstError],
          ...normalizeGatewaySnapshot(repairedSnapshot),
        })
      } catch (retryError: any) {
        const retryMessage = retryError?.message || 'Gateway 修复重试失败'
        console.error('[openclaw] gateway status repair retry failed:', retryMessage)
        return NextResponse.json(
          {
            success: false,
            error: retryMessage,
            retryError: firstError,
          },
          { status: 502 }
        )
      }
    }

    return NextResponse.json(
      { success: false, error: firstError },
      { status: 502 }
    )
  }
}
