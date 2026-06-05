import os from 'os'
import path from 'path'

type ResolveOpenclawWorkspaceDirParams = {
  stateDir: string
  actorUserId?: number
  preferredWorkspace?: string
}

export function normalizeOpenclawUserPath(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return trimmed
  if (trimmed === '~') {
    return os.homedir()
  }
  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed)
  }
  // Avoid bare path.resolve() — Turbopack NFT treats it as tracing the whole project root.
  return path.join(/*turbopackIgnore: true*/ process.cwd(), trimmed)
}

export function resolveOpenclawWorkspaceDir(params: ResolveOpenclawWorkspaceDirParams): string {
  const preferred = (params.preferredWorkspace || '').trim()
  if (preferred) {
    return normalizeOpenclawUserPath(preferred)
  }
  if (params.actorUserId && params.actorUserId > 0) {
    return normalizeOpenclawUserPath(path.join(params.stateDir, 'workspace', `user-${params.actorUserId}`))
  }
  return normalizeOpenclawUserPath(path.join(params.stateDir, 'workspace'))
}

export function getOpenclawDailyMemoryFileName(date: Date = new Date()): string {
  return `${formatDateInShanghai(date)}.md`
}

export function formatOpenclawDateInShanghai(date: Date): string {
  return formatDateInShanghai(date)
}

function formatDateInShanghai(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function resolveOpenclawConfigPath(): string {
  const configured = (process.env.OPENCLAW_CONFIG_PATH || '').trim()
  if (configured) return configured
  return path.join(/*turbopackIgnore: true*/ process.cwd(), '.openclaw', 'openclaw.json')
}

export function resolveOpenclawRuntimePaths(): { configPath: string; stateDir: string } {
  const configPath = resolveOpenclawConfigPath()
  const stateDir = (process.env.OPENCLAW_STATE_DIR || '').trim() || path.dirname(configPath)
  return { configPath, stateDir }
}
