type TenantTokenCache = {
  token: string
  expiresAt: number
}

const tokenCache = new Map<string, TenantTokenCache>()

const FEISHU_DOMAIN = 'https://open.feishu.cn'
const LARK_DOMAIN = 'https://open.larksuite.com'

export function resolveFeishuApiBase(domainInput?: string | null): string {
  const trimmed = (domainInput || '').trim()
  if (!trimmed) return `${FEISHU_DOMAIN}/open-apis`
  const lower = trimmed.toLowerCase()
  if (lower === 'feishu' || lower === 'cn' || lower === 'china') {
    return `${FEISHU_DOMAIN}/open-apis`
  }
  if (lower === 'lark' || lower === 'global' || lower === 'intl' || lower === 'international') {
    return `${LARK_DOMAIN}/open-apis`
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const normalized = withScheme.replace(/\/+$/, '').replace(/\/open-apis$/i, '')
  return `${normalized}/open-apis`
}

export async function getTenantAccessToken(params: {
  appId: string
  appSecret: string
  domain?: string
}): Promise<string> {
  const cacheKey = `${params.appId}:${params.domain || ''}`
  const cached = tokenCache.get(cacheKey)
  const now = Date.now()
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.token
  }

  const base = resolveFeishuApiBase(params.domain)
  const response = await fetch(`${base}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: params.appId,
      app_secret: params.appSecret,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Feishu auth failed (${response.status}): ${text}`)
  }

  const data = await response.json() as { tenant_access_token?: string; expire?: number; code?: number; msg?: string }
  if (!data.tenant_access_token) {
    throw new Error(`Feishu auth failed: ${data.msg || 'missing token'}`)
  }

  const expiresIn = Number(data.expire || 0)
  const expiresAt = now + (expiresIn > 0 ? expiresIn * 1000 : 60 * 60 * 1000)
  tokenCache.set(cacheKey, { token: data.tenant_access_token, expiresAt })
  return data.tenant_access_token
}

export async function feishuRequest<T>(params: {
  method: 'GET' | 'POST' | 'PUT'
  url: string
  token: string
  body?: any
}): Promise<T> {
  const response = await fetch(params.url, {
    method: params.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.token}`,
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Feishu API error (${response.status}): ${text}`)
  }

  const data = await response.json()
  const code = (data as any).code
  if (code !== undefined && code !== 0) {
    throw new Error(`Feishu API error: ${(data as any).msg || code}`)
  }
  return data as T
}
