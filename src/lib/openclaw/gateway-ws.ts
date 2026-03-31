import { randomUUID } from 'crypto'
import { resolveOpenclawGatewayBaseUrl } from '@/lib/openclaw/gateway'
import { getOpenclawGatewayToken } from '@/lib/openclaw/auth'

const PROTOCOL_VERSION = 3
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_CACHE_MS = 15_000
const DEFAULT_RETRY_COUNT = 2
const DEFAULT_RETRY_DELAY_MS = 350

type GatewayResponse = {
  type: 'res'
  id: string
  ok: boolean
  payload?: any
  error?: { message?: string; code?: string }
}

export type OpenclawGatewaySnapshot = {
  fetchedAt: string
  health: any | null
  skills: any | null
  errors: string[]
}

type PendingRequest = {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

type GatewayClient = {
  request: (method: string, params?: any, timeoutMs?: number) => Promise<any>
  close: () => void
}

type ConnectGatewayOptions = {
  scopes?: string[]
}

let cachedSnapshot: OpenclawGatewaySnapshot | null = null
let cacheExpiresAt = 0
let inflight: Promise<OpenclawGatewaySnapshot> | null = null

function parseNumber(value: string | undefined | null, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

function resolveCacheTtlMs(): number {
  return parseNumber(process.env.OPENCLAW_GATEWAY_STATUS_CACHE_MS, DEFAULT_CACHE_MS)
}

function resolveTimeoutMs(): number {
  return parseNumber(process.env.OPENCLAW_GATEWAY_STATUS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
}

function resolveRetryCount(): number {
  const parsed = parseNumber(process.env.OPENCLAW_GATEWAY_STATUS_RETRIES, DEFAULT_RETRY_COUNT)
  return Math.max(1, Math.min(3, Math.floor(parsed)))
}

function resolveRetryDelayMs(): number {
  const parsed = parseNumber(process.env.OPENCLAW_GATEWAY_STATUS_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS)
  return Math.max(100, Math.min(5_000, Math.floor(parsed)))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function resolveWebSocketImpl(): Promise<any> {
  if (typeof WebSocket !== 'undefined') {
    return WebSocket
  }
  try {
    const mod = await import('ws')
    return (mod as any).WebSocket || (mod as any).default || mod
  } catch (error) {
    throw new Error('当前运行环境不支持 WebSocket')
  }
}

function toWsUrl(httpUrl: string): string {
  const url = new URL(httpUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString().replace(/\/+$/, '')
}

function attachListener(
  ws: any,
  event: string,
  handler: (...args: any[]) => void
): void {
  if (typeof ws.addEventListener === 'function') {
    ws.addEventListener(event, handler)
    return
  }
  if (typeof ws.on === 'function') {
    ws.on(event, handler)
  }
}

function detachListener(
  ws: any,
  event: string,
  handler: (...args: any[]) => void
): void {
  if (typeof ws.removeEventListener === 'function') {
    ws.removeEventListener(event, handler)
    return
  }
  if (typeof ws.off === 'function') {
    ws.off(event, handler)
    return
  }
  if (typeof ws.removeListener === 'function') {
    ws.removeListener(event, handler)
  }
}

function resolveMessagePayload(eventOrData: any): string | null {
  const raw = eventOrData && typeof eventOrData === 'object' && 'data' in eventOrData
    ? (eventOrData as { data: any }).data
    : eventOrData
  if (typeof raw === 'string') return raw
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString('utf-8')
  }
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf-8')
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf-8')
  }
  return null
}

async function openGatewaySocket(url: string, timeoutMs: number): Promise<any> {
  const WebSocketImpl = await resolveWebSocketImpl()
  const ws = new WebSocketImpl(url)
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        ws.close()
      } catch {}
      reject(new Error('连接 OpenClaw Gateway 超时'))
    }, timeoutMs)

    const handleOpen = () => {
      clearTimeout(timer)
      detachListener(ws, 'open', handleOpen)
      detachListener(ws, 'error', handleError)
      resolve(ws)
    }

    const handleError = (event: any) => {
      clearTimeout(timer)
      detachListener(ws, 'open', handleOpen)
      detachListener(ws, 'error', handleError)
      const message = event?.message || '连接 OpenClaw Gateway 失败'
      reject(new Error(message))
    }

    attachListener(ws, 'open', handleOpen)
    attachListener(ws, 'error', handleError)
  })
}

function createGatewayClient(ws: any): GatewayClient {
  const pending = new Map<string, PendingRequest>()

  const cleanupPending = (error: Error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  const handleMessage = (eventOrData: any) => {
    const payload = resolveMessagePayload(eventOrData)
    if (!payload) return
    let parsed: GatewayResponse | null = null
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }
    if (!parsed || parsed.type !== 'res' || typeof parsed.id !== 'string') {
      return
    }
    const entry = pending.get(parsed.id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(parsed.id)
    if (!parsed.ok) {
      entry.reject(new Error(parsed.error?.message || 'Gateway 请求失败'))
      return
    }
    entry.resolve(parsed.payload)
  }

  const handleClose = () => {
    cleanupPending(new Error('Gateway 连接已关闭'))
  }

  attachListener(ws, 'message', handleMessage)
  attachListener(ws, 'close', handleClose)

  const request = (method: string, params?: any, timeoutMs?: number) => {
    const id = randomUUID()
    const payload = JSON.stringify({ type: 'req', id, method, params })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Gateway 请求超时: ${method}`))
      }, timeoutMs ?? DEFAULT_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      ws.send(payload)
    })
  }

  const close = () => {
    detachListener(ws, 'message', handleMessage)
    detachListener(ws, 'close', handleClose)
    try {
      ws.close()
    } catch {}
  }

  return { request, close }
}

async function connectGateway(
  client: GatewayClient,
  token: string,
  timeoutMs: number,
  options: ConnectGatewayOptions = {},
) {
  const version = process.env.APP_VERSION || process.env.npm_package_version || 'dev'
  const platform = `node-${process.platform}`
  const scopes = Array.isArray(options.scopes) && options.scopes.length > 0
    ? options.scopes
    : ['operator.read']
  const connectPayload = {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: {
      id: 'gateway-client',
      displayName: 'AutoAds',
      version,
      platform,
      mode: 'backend',
    },
    role: 'operator',
    scopes,
    auth: { token },
    locale: 'zh-CN',
    userAgent: `autoads/${version}`,
  }
  return await client.request('connect', connectPayload, timeoutMs)
}

export type OpenclawGatewayRestartResult = {
  requestedAt: string
  restart: any | null
  path: string | null
}

export async function requestOpenclawGatewayRestart(opts?: {
  note?: string
}): Promise<OpenclawGatewayRestartResult> {
  const baseUrl = await resolveOpenclawGatewayBaseUrl()
  const wsUrl = toWsUrl(baseUrl)
  const timeoutMs = resolveTimeoutMs()
  const token = await getOpenclawGatewayToken()

  let ws: any = null
  let client: GatewayClient | null = null

  try {
    ws = await openGatewaySocket(wsUrl, timeoutMs)
    client = createGatewayClient(ws)

    await connectGateway(client, token, timeoutMs, { scopes: ['operator.admin'] })

    const configSnapshot = await client.request('config.get', {}, timeoutMs)
    const baseHash = typeof configSnapshot?.hash === 'string'
      ? configSnapshot.hash.trim()
      : ''

    if (!baseHash) {
      throw new Error('Gateway 未返回配置哈希，无法触发重启')
    }

    const patchResult = await client.request(
      'config.patch',
      {
        baseHash,
        raw: '{}',
        note: String(opts?.note || '').trim() || 'openclaw-manual-hot-reload',
        restartDelayMs: 0,
      },
      timeoutMs,
    )

    return {
      requestedAt: new Date().toISOString(),
      restart: patchResult?.restart ?? null,
      path: typeof patchResult?.path === 'string' ? patchResult.path : null,
    }
  } catch (error: any) {
    const message = error?.message || '未知错误'
    throw new Error(`Gateway 重启请求失败 (${wsUrl}): ${message}`)
  } finally {
    if (client) {
      client.close()
    } else if (ws) {
      try {
        ws.close()
      } catch {}
    }
  }
}

async function fetchGatewaySnapshot(): Promise<OpenclawGatewaySnapshot> {
  const baseUrl = await resolveOpenclawGatewayBaseUrl()
  const wsUrl = toWsUrl(baseUrl)
  const timeoutMs = resolveTimeoutMs()
  const token = await getOpenclawGatewayToken()

  let ws: any = null
  let client: GatewayClient | null = null

  try {
    ws = await openGatewaySocket(wsUrl, timeoutMs)
    client = createGatewayClient(ws)

    await connectGateway(client, token, timeoutMs)

    const [healthRes, skillsRes] = await Promise.allSettled([
      client.request('health', {}, timeoutMs),
      client.request('skills.status', {}, timeoutMs),
    ])

    const errors: string[] = []
    const health = healthRes.status === 'fulfilled' ? healthRes.value : null
    if (healthRes.status === 'rejected') {
      errors.push(healthRes.reason?.message || 'health 请求失败')
    }

    const skills = skillsRes.status === 'fulfilled' ? skillsRes.value : null
    if (skillsRes.status === 'rejected') {
      errors.push(skillsRes.reason?.message || 'skills.status 请求失败')
    }

    return {
      fetchedAt: new Date().toISOString(),
      health,
      skills,
      errors,
    }
  } catch (error: any) {
    const message = error?.message || '未知错误'
    throw new Error(`Gateway 状态查询失败 (${wsUrl}): ${message}`)
  } finally {
    if (client) {
      client.close()
    } else if (ws) {
      try {
        ws.close()
      } catch {}
    }
  }
}

async function fetchGatewaySnapshotWithRetry(): Promise<OpenclawGatewaySnapshot> {
  const attempts = resolveRetryCount()
  const delayMs = resolveRetryDelayMs()
  let lastError: any = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetchGatewaySnapshot()
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await sleep(delayMs * attempt)
      }
    }
  }

  throw lastError || new Error('Gateway 状态查询失败')
}

export async function getOpenclawGatewaySnapshot(opts?: { force?: boolean }): Promise<OpenclawGatewaySnapshot> {
  const force = opts?.force === true
  const ttlMs = resolveCacheTtlMs()

  if (!force && cachedSnapshot && Date.now() < cacheExpiresAt) {
    return cachedSnapshot
  }

  if (!force && inflight) {
    return await inflight
  }

  inflight = fetchGatewaySnapshotWithRetry()

  try {
    const snapshot = await inflight
    cachedSnapshot = snapshot
    cacheExpiresAt = Date.now() + ttlMs
    return snapshot
  } finally {
    inflight = null
  }
}
