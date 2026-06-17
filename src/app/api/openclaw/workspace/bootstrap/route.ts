import { NextRequest, NextResponse } from 'next/server'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/gateway/request-auth'
import { getSettingsByCategory } from '@/lib/common/server'
import { syncOpenclawConfig } from '@/lib/openclaw/config/config'
import { resolveOpenclawRuntimePaths, resolveOpenclawWorkspaceDir } from '@/lib/openclaw/workspace/workspace-paths'

function parseJsonObject(value?: string | null): Record<string, any> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined
    }
    return parsed as Record<string, any>
  } catch {
    return undefined
  }
}

async function buildWorkspaceStatus(params: {
  workspaceDir: string
  computedWorkspaceDir: string
  canReloadGateway: boolean
}) {
  const { inspectOpenclawWorkspace } = await import(
    /* turbopackIgnore: true */ '@/lib/openclaw/workspace/workspace-bootstrap'
  )
  const inspected = inspectOpenclawWorkspace(params.workspaceDir)
  return {
    success: true,
    source: 'computed' as const,
    runtimeWorkspaceDir: null,
    computedWorkspaceDir: params.computedWorkspaceDir,
    canReloadGateway: params.canReloadGateway,
    ...inspected }
}

export async function POST(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { stateDir } = resolveOpenclawRuntimePaths()
  const settings = await getSettingsByCategory('openclaw', auth.user.userId)
  const settingMap = settings.reduce<Record<string, string | null>>((acc, item) => {
    acc[item.key] = item.value
    return acc
  }, {})

  const agentDefaults = parseJsonObject(settingMap.openclaw_agent_defaults_json)
  const preferredWorkspace = typeof agentDefaults?.workspace === 'string'
    ? agentDefaults.workspace.trim()
    : ''

  const computedWorkspaceDir = resolveOpenclawWorkspaceDir({
    stateDir,
    actorUserId: auth.user.userId,
    preferredWorkspace })

  const { ensureOpenclawWorkspaceBootstrap } = await import(
    /* turbopackIgnore: true */ '@/lib/openclaw/workspace/workspace-bootstrap'
  )
  const bootstrap = ensureOpenclawWorkspaceBootstrap({
    stateDir,
    actorUserId: auth.user.userId,
    preferredWorkspace })

  const statusPayload = await buildWorkspaceStatus({
    workspaceDir: bootstrap.workspaceDir || computedWorkspaceDir,
    computedWorkspaceDir,
    canReloadGateway: auth.user.role === 'admin' })

  try {
    await syncOpenclawConfig({
      reason: 'openclaw-workspace-bootstrap',
      actorUserId: auth.user.userId })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'OpenClaw 配置同步失败',
        changedFiles: bootstrap.changedFiles,
        status: statusPayload },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    changedFiles: bootstrap.changedFiles,
    status: statusPayload })
}
