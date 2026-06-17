import fs from 'fs'
import { NextRequest, NextResponse } from 'next/server'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/gateway/request-auth'
import { getSettingsByCategory } from '@/lib/common/server'
import { inspectOpenclawWorkspace } from '@/lib/openclaw/workspace/workspace-bootstrap'
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


function readRuntimeWorkspaceDir(configPath: string): string | undefined {
  try {
    if (!fs.existsSync(configPath)) return undefined
    const raw = fs.readFileSync(configPath, 'utf-8')
    if (!raw.trim()) return undefined
    const parsed = JSON.parse(raw) as any
    const workspace = parsed?.agents?.defaults?.workspace
    if (typeof workspace !== 'string') return undefined
    const trimmed = workspace.trim()
    return trimmed || undefined
  } catch {
    return undefined
  }
}

export async function GET(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { configPath, stateDir } = resolveOpenclawRuntimePaths()
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
  const runtimeWorkspaceDir = readRuntimeWorkspaceDir(configPath)
  const effectiveWorkspaceDir = runtimeWorkspaceDir || computedWorkspaceDir
  const status = inspectOpenclawWorkspace(effectiveWorkspaceDir)

  return NextResponse.json({
    success: true,
    source: runtimeWorkspaceDir ? 'runtime-config' : 'computed',
    runtimeWorkspaceDir: runtimeWorkspaceDir || null,
    computedWorkspaceDir,
    canReloadGateway: auth.user.role === 'admin',
    ...status })
}
