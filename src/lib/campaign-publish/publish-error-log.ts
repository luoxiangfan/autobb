const SENSITIVE_KEYS = new Set([
  'private_key',
  'privateKey',
  'developer_token',
  'developerToken',
  'refresh_token',
  'refreshToken',
  'access_token',
  'accessToken',
  'authorization',
  'cookie',
  'set-cookie',
])

function redactString(s: string): string {
  if (s.includes('-----BEGIN PRIVATE KEY-----') || s.includes('BEGIN PRIVATE KEY'))
    return '[REDACTED_PRIVATE_KEY]'
  if (s.length > 6000) return `[TRUNCATED_STRING len=${s.length}]`
  return s
}

export function redactSecrets(value: unknown, depth: number = 0): unknown {
  const MAX_DEPTH = 6
  if (depth > MAX_DEPTH) return '[Truncated]'

  if (typeof value === 'string') return redactString(value)
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1))

  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = '[REDACTED]'
      continue
    }
    if (k === 'request' || k === 'socket' || k === 'agent') {
      out[k] = '[OMITTED]'
      continue
    }
    if (k === 'data' && typeof v === 'string' && v.includes('private_key')) {
      out[k] = '[REDACTED]'
      continue
    }
    out[k] = redactSecrets(v, depth + 1)
  }
  return out
}

export function buildPublishErrorLogObject(err: unknown): Record<string, unknown> {
  if (err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError) {
    const ax = err as {
      name?: string
      message?: string
      code?: string
      config?: { url?: string; method?: string }
      response?: { status?: number; headers?: Record<string, string>; data?: unknown }
    }
    return redactSecrets({
      kind: 'AxiosError',
      name: ax.name,
      message: ax.message,
      code: ax.code,
      url: ax.config?.url,
      method: ax.config?.method,
      status: ax.response?.status,
      pythonRequestId: ax.response?.headers?.['x-request-id'],
      responseData: ax.response?.data,
    }) as Record<string, unknown>
  }

  if (err instanceof Error) {
    const ownProps: Record<string, unknown> = {}
    const errorRecord = err as unknown as Record<string, unknown>
    for (const key of Object.getOwnPropertyNames(err)) {
      ownProps[key] = errorRecord[key]
    }
    for (const key of Object.keys(errorRecord)) {
      ownProps[key] = errorRecord[key]
    }
    return redactSecrets({
      kind: 'Error',
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...ownProps,
    }) as Record<string, unknown>
  }

  if (typeof err === 'object' && err !== null) {
    const ownProps: Record<string, unknown> = {}
    for (const key of Object.getOwnPropertyNames(err)) {
      ownProps[key] = (err as Record<string, unknown>)[key]
    }
    for (const key of Object.keys(err as object)) {
      ownProps[key] = (err as Record<string, unknown>)[key]
    }
    return redactSecrets({ kind: typeof err, ...ownProps }) as Record<string, unknown>
  }

  return redactSecrets({ kind: typeof err, value: err }) as Record<string, unknown>
}
