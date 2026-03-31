import { NextRequest, NextResponse } from 'next/server'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'
import { syncOpenclawConfig } from '@/lib/openclaw/config'
import { getOpenclawGatewaySnapshot, requestOpenclawGatewayRestart } from '@/lib/openclaw/gateway-ws'
import { auditOpenclawAiAuthOverrides } from '@/lib/openclaw/ai-auth-audit'

type GatewayStatusPayload = {
  success: boolean
  fetchedAt?: string
  health?: any | null
  skills?: any | null
  errors?: string[]
  error?: string
}

export async function POST(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: '仅管理员可执行配置热加载' }, { status: 403 })
  }

  let syncResult: Awaited<ReturnType<typeof syncOpenclawConfig>> | undefined
  try {
    syncResult = await syncOpenclawConfig({ reason: 'openclaw-manual-hot-reload' })
  } catch (error: any) {
    const message = error?.message || 'OpenClaw 配置同步失败'
    console.error('[openclaw] manual config hot reload sync failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }

  const aiAuthOverrideWarnings = auditOpenclawAiAuthOverrides({
    config: syncResult?.config,
    configPath: syncResult?.configPath,
  })

  let restartResult: any = null
  let restartError: string | null = null
  try {
    restartResult = await requestOpenclawGatewayRestart({
      note: 'OpenClaw 控制台手动执行配置热加载',
    })
  } catch (error: any) {
    restartError = error?.message || 'Gateway 重启触发失败'
    console.error('[openclaw] manual config hot reload restart trigger failed:', restartError)
  }

  let gatewayStatus: GatewayStatusPayload
  try {
    const snapshot = await getOpenclawGatewaySnapshot({ force: true })
    gatewayStatus = { success: true, ...snapshot }
  } catch (error: any) {
    const message = error?.message || 'Gateway 状态获取失败'
    console.error('[openclaw] manual config hot reload status check failed:', message)
    gatewayStatus = {
      success: false,
      error: message,
    }
  }

  return NextResponse.json({
    success: true,
    reloadedAt: new Date().toISOString(),
    restartRequested: !restartError,
    restartResult,
    restartError,
    gatewayStatus,
    message: restartError
      ? '配置已同步，但 Gateway 重启触发失败'
      : gatewayStatus.success
        ? '配置已同步并触发 Gateway 重启'
        : '配置已同步并触发 Gateway 重启，Gateway 状态暂不可用',
    aiAuthOverrideWarnings,
  })
}
