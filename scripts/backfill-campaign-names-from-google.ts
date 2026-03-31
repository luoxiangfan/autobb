#!/usr/bin/env tsx
/**
 * 一次性回填脚本：
 * 将本地 campaigns.campaign_name 回填为 Google Ads 当前真实 campaign.name
 *
 * 默认 dry-run（仅预览，不写库）。
 * 使用 `--apply` 才会真正写入数据库。
 *
 * 用法:
 *   tsx scripts/backfill-campaign-names-from-google.ts
 *   tsx scripts/backfill-campaign-names-from-google.ts --apply
 *   tsx scripts/backfill-campaign-names-from-google.ts --apply --user-id=7 --account-id=33 --limit=200
 */

type BackfillOptions = {
  dryRun: boolean
  userId?: number
  accountId?: number
  limit?: number
}

type CampaignRow = {
  campaign_id: number
  user_id: number
  google_ads_account_id: number
  campaign_name: string
  campaign_config: unknown
  google_campaign_id: string
  customer_id: string
  parent_mcc_id: string | null
}

type GroupKey = `${number}:${number}`

let cachedProxyUrl: string | null | undefined
let cachedProxyDispatcher: any | null | undefined

function parseIntegerArg(value: string | undefined): number | undefined {
  if (!value) return undefined
  const num = Number(value)
  if (!Number.isInteger(num) || num <= 0) return undefined
  return num
}

function parseArgs(argv: string[]): BackfillOptions {
  const opts: BackfillOptions = { dryRun: true }

  for (const arg of argv) {
    if (arg === '--apply') {
      opts.dryRun = false
      continue
    }
    if (arg === '--dry-run') {
      opts.dryRun = true
      continue
    }
    if (arg.startsWith('--user-id=')) {
      opts.userId = parseIntegerArg(arg.split('=')[1])
      continue
    }
    if (arg.startsWith('--account-id=')) {
      opts.accountId = parseIntegerArg(arg.split('=')[1])
      continue
    }
    if (arg.startsWith('--limit=')) {
      opts.limit = parseIntegerArg(arg.split('=')[1])
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`
Usage:
  tsx scripts/backfill-campaign-names-from-google.ts [--dry-run] [--apply] [--user-id=N] [--account-id=N] [--limit=N]

Options:
  --dry-run      Preview only (default)
  --apply        Execute updates
  --user-id=N    Backfill only one user
  --account-id=N Backfill only one Google Ads account
  --limit=N      Limit candidate rows
      `.trim())
      process.exit(0)
    }
  }

  return opts
}

function normalizeCampaignConfigWithName(raw: unknown, campaignName: string): string | null {
  if (raw === null || raw === undefined) return null

  const rawString = typeof raw === 'string' ? raw : JSON.stringify(raw)
  if (!rawString) return null

  try {
    const parsed = JSON.parse(rawString)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify({
        ...parsed,
        campaignName,
      })
    }
    return rawString
  } catch {
    return rawString
  }
}

function normalizeDigits(value: unknown): string {
  return String(value || '').replace(/\D/g, '')
}

function buildGoogleAdsError(prefix: string, response: Response, payload: any, fallbackText: string): Error {
  const errorMessage = String(
    payload?.error?.message
    || payload?.message
    || fallbackText
    || `HTTP ${response.status}`
  ).trim()
  const err: any = new Error(`${prefix}: ${errorMessage}`)
  err.status = payload?.error?.status || payload?.status || response.status
  err.response = { status: response.status, statusCode: response.status }
  err.details = (() => {
    try {
      return JSON.stringify(payload?.error?.details || payload?.error || payload || null)
    } catch {
      return ''
    }
  })()
  return err as Error
}

function isTokenExpiredError(error: unknown): boolean {
  const err: any = error
  const message = String(err?.message || '').toLowerCase()
  const status = String(err?.status || err?.response?.status || '').toLowerCase()
  return status === '401'
    || status.includes('unauthenticated')
    || message.includes('unauthenticated')
    || message.includes('invalid authentication credentials')
    || message.includes('access token has expired')
    || message.includes('expired token')
}

async function resolveProxyUrl(): Promise<string | undefined> {
  if (cachedProxyUrl !== undefined) {
    return cachedProxyUrl || undefined
  }

  const explicitProxy = String(
    process.env.GOOGLE_ADS_HTTP_PROXY
    || process.env.HTTPS_PROXY
    || process.env.HTTP_PROXY
    || process.env.ALL_PROXY
    || ''
  ).trim()

  if (explicitProxy) {
    cachedProxyUrl = explicitProxy
    return cachedProxyUrl
  }

  const providerProxyUrl = String(process.env.PROXY_URL || '').trim()
  if (!providerProxyUrl) {
    cachedProxyUrl = null
    return undefined
  }

  try {
    const { fetchProxyIp } = await import('../src/lib/proxy/fetch-proxy-ip')
    const proxy = await fetchProxyIp(providerProxyUrl, 1, true)
    const username = encodeURIComponent(proxy.username)
    const password = encodeURIComponent(proxy.password)
    cachedProxyUrl = `http://${username}:${password}@${proxy.host}:${proxy.port}`
    console.log(`Using dynamic proxy ${proxy.host}:${proxy.port} for Google Ads backfill`)
    return cachedProxyUrl
  } catch (error: any) {
    cachedProxyUrl = null
    console.warn(`⚠️ proxy bootstrap failed, fallback to direct connection: ${error?.message || error}`)
    return undefined
  }
}

async function getProxyDispatcher(): Promise<any | undefined> {
  if (cachedProxyDispatcher !== undefined) {
    return cachedProxyDispatcher || undefined
  }

  const proxyUrl = await resolveProxyUrl()
  if (!proxyUrl) {
    cachedProxyDispatcher = null
    return undefined
  }

  const { ProxyAgent } = await import('undici')
  cachedProxyDispatcher = new ProxyAgent(proxyUrl)
  return cachedProxyDispatcher
}

async function proxyAwareFetch(input: string, init?: RequestInit): Promise<Response> {
  const dispatcher = await getProxyDispatcher()
  if (dispatcher) {
    return fetch(input, { ...(init || {}), dispatcher } as any)
  }
  return fetch(input, init)
}

async function refreshAccessTokenByHttp(params: {
  refreshToken: string
  clientId: string
  clientSecret: string
}): Promise<string> {
  const response = await proxyAwareFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'refresh_token',
    }),
  })

  const responseText = await response.text()
  let payload: any = null
  try {
    payload = responseText ? JSON.parse(responseText) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw buildGoogleAdsError('Token refresh failed', response, payload, responseText)
  }

  const accessToken = String(payload?.access_token || '').trim()
  if (!accessToken) {
    throw new Error('Token refresh succeeded but access_token is empty')
  }
  return accessToken
}

async function refreshAccessTokenWithRetry(params: {
  refreshToken: string
  clientId: string
  clientSecret: string
}): Promise<string> {
  let lastError: any = null
  const maxAttempts = 3

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await refreshAccessTokenByHttp(params)
    } catch (error: any) {
      lastError = error
      const message = String(error?.message || '').toLowerCase()
      const nonRetryable = message.includes('invalid_grant') || message.includes('invalid_client')
      if (nonRetryable || attempt >= maxAttempts) break
      const delayMs = attempt * 500
      console.warn(`Refresh Google Ads Token failed (${attempt}/${maxAttempts}), retry in ${delayMs}ms`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw lastError || new Error('Token refresh failed')
}

async function getCampaignNameByHttp(params: {
  customerId: string
  campaignId: string
  accessToken: string
  developerToken: string
  loginCustomerId?: string
}): Promise<string> {
  const customerId = normalizeDigits(params.customerId)
  const campaignId = normalizeDigits(params.campaignId)
  const loginCustomerId = normalizeDigits(params.loginCustomerId)

  if (!customerId) throw new Error(`Invalid customerId: ${params.customerId}`)
  if (!campaignId) throw new Error(`Invalid campaignId: ${params.campaignId}`)

  const envApiVersionRaw = String(process.env.GOOGLE_ADS_API_VERSION || '').trim().toLowerCase()
  const envApiVersion = /^v\d+$/.test(envApiVersionRaw) ? envApiVersionRaw : null
  const versionCandidates = Array.from(new Set([
    envApiVersion,
    'v22',
    'v21',
    'v20',
    'v19',
    'v18',
    'v17',
    'v16',
  ].filter(Boolean) as string[]))

  const query = `
    SELECT
      campaign.id,
      campaign.name
    FROM campaign
    WHERE campaign.id = ${campaignId}
  `

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${params.accessToken}`,
    'developer-token': params.developerToken,
    'Content-Type': 'application/json',
  }
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId
  }

  let lastError: any = null
  for (const apiVersion of versionCandidates) {
    const endpoint = `https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/googleAds:searchStream`
    const response = await proxyAwareFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    })

    const responseText = await response.text()
    let payload: any = null
    try {
      payload = responseText ? JSON.parse(responseText) : null
    } catch {
      payload = null
    }

    if (!response.ok) {
      const err = buildGoogleAdsError('Google Ads searchStream failed', response, payload, responseText)
      const errText = String((err as any)?.message || '').toLowerCase()
      const unsupportedVersion = errText.includes('unsupported_version')
        || errText.includes('version') && errText.includes('deprecated')
      if (unsupportedVersion) {
        lastError = err
        continue
      }
      throw err
    }

    const chunks = Array.isArray(payload) ? payload : [payload]
    for (const chunk of chunks) {
      const results = Array.isArray(chunk?.results) ? chunk.results : []
      for (const row of results) {
        const name = String(row?.campaign?.name || '').trim()
        if (name) {
          return name
        }
      }
    }

    return ''
  }

  throw lastError || new Error('Google Ads searchStream failed for all API versions')
}

async function run() {
  const options = parseArgs(process.argv.slice(2))
  const [{ getDatabase, closeDatabase }, oauth, loginCustomer] = await Promise.all([
    import('../src/lib/db'),
    import('../src/lib/google-ads-oauth'),
    import('../src/lib/google-ads-login-customer'),
  ])
  const { getGoogleAdsCredentials, getUserAuthType } = oauth
  const { resolveLoginCustomerCandidates, isGoogleAdsAccountAccessError } = loginCustomer

  const db = getDatabase()
  try {
    const where: string[] = [
      `COALESCE(NULLIF(c.google_campaign_id, ''), NULLIF(c.campaign_id, '')) IS NOT NULL`,
      `TRIM(COALESCE(NULLIF(c.google_campaign_id, ''), NULLIF(c.campaign_id, ''))) != ''`,
    ]
    const params: any[] = []

    if (options.userId) {
      where.push('c.user_id = ?')
      params.push(options.userId)
    }
    if (options.accountId) {
      where.push('c.google_ads_account_id = ?')
      params.push(options.accountId)
    }

    const limitSql = options.limit ? `LIMIT ${Math.max(1, options.limit)}` : ''

    const rows = await db.query<CampaignRow>(
      `
        SELECT
          c.id AS campaign_id,
          c.user_id,
          c.google_ads_account_id,
          c.campaign_name,
          c.campaign_config,
          COALESCE(NULLIF(c.google_campaign_id, ''), NULLIF(c.campaign_id, '')) AS google_campaign_id,
          gaa.customer_id,
          gaa.parent_mcc_id
        FROM campaigns c
        INNER JOIN google_ads_accounts gaa
          ON gaa.id = c.google_ads_account_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.id ASC
        ${limitSql}
      `,
      params
    )

    console.log('═'.repeat(72))
    console.log('Campaign Name Backfill: Local <- Google Ads')
    console.log('═'.repeat(72))
    console.log(`Mode: ${options.dryRun ? 'DRY-RUN' : 'APPLY'}`)
    console.log(`Candidates: ${rows.length}`)
    if (options.userId) console.log(`Filter userId: ${options.userId}`)
    if (options.accountId) console.log(`Filter accountId: ${options.accountId}`)
    console.log('')

    if (rows.length === 0) {
      console.log('No campaign rows matched filters.')
      return
    }

    const groups = new Map<GroupKey, CampaignRow[]>()
    for (const row of rows) {
      const key = `${row.user_id}:${row.google_ads_account_id}` as GroupKey
      const list = groups.get(key) || []
      list.push(row)
      groups.set(key, list)
    }

    let checked = 0
    let changed = 0
    let updated = 0
    let unchanged = 0
    let missingRemote = 0
    let failed = 0
    let skippedNoAuth = 0

    const nowExpr = db.type === 'postgres' ? 'CURRENT_TIMESTAMP' : 'datetime("now")'

    for (const [groupKey, groupRows] of groups.entries()) {
      const first = groupRows[0]
      const userId = Number(first.user_id)
      const customerId = String(first.customer_id)
      const parentMccId = first.parent_mcc_id ? String(first.parent_mcc_id) : undefined

      console.log(`Processing group ${groupKey} (customer=${customerId}, campaigns=${groupRows.length})`)

      const [credentials, auth] = await Promise.all([
        getGoogleAdsCredentials(userId),
        getUserAuthType(userId),
      ])

      const refreshToken = String(credentials?.refresh_token || '').trim()
      const clientId = String((credentials as any)?.client_id || '').trim()
      const clientSecret = String((credentials as any)?.client_secret || '').trim()
      const developerToken = String((credentials as any)?.developer_token || '').trim()

      if (auth.authType === 'oauth' && (!refreshToken || !clientId || !clientSecret || !developerToken)) {
        skippedNoAuth += groupRows.length
        console.warn(`  ⚠️ skip group: OAuth credentials missing (userId=${userId})`)
        continue
      }

      let serviceAccountMccId: string | undefined
      if (auth.authType === 'service_account') {
        try {
          const { getServiceAccountConfig } = await import('../src/lib/google-ads-service-account')
          const saConfig = await getServiceAccountConfig(userId, auth.serviceAccountId)
          if (saConfig?.mccCustomerId) {
            serviceAccountMccId = saConfig.mccCustomerId
          }
        } catch (error) {
          console.warn(`  ⚠️ cannot read service-account MCC config: ${error}`)
        }
      }

      const loginCandidates = resolveLoginCustomerCandidates({
        authType: auth.authType,
        accountParentMccId: parentMccId,
        oauthLoginCustomerId: credentials?.login_customer_id,
        serviceAccountMccId,
        targetCustomerId: customerId,
      })

      let preferredLoginCustomerId = loginCandidates[0]
      let accessToken: string | null = null

      const ensureAccessToken = async (forceRefresh = false): Promise<string> => {
        if (forceRefresh || !accessToken) {
          accessToken = await refreshAccessTokenWithRetry({
            refreshToken,
            clientId,
            clientSecret,
          })
        }
        return accessToken
      }

      const runWithLoginFallback = async <T>(
        callback: (loginCustomerId: string | undefined) => Promise<T>
      ): Promise<T> => {
        const ordered = [
          preferredLoginCustomerId,
          ...loginCandidates.filter((candidate) => candidate !== preferredLoginCustomerId),
        ]

        let lastError: any = null
        for (let i = 0; i < ordered.length; i += 1) {
          const loginCustomerId = ordered[i]
          try {
            const result = await callback(loginCustomerId)
            preferredLoginCustomerId = loginCustomerId
            return result
          } catch (error: any) {
            lastError = error
            const hasNext = i < ordered.length - 1
            if (hasNext && isGoogleAdsAccountAccessError(error)) {
              continue
            }
            throw error
          }
        }

        throw lastError || new Error('Google Ads request failed')
      }

      for (const row of groupRows) {
        checked += 1
        try {
          const remoteName = await runWithLoginFallback(async (loginCustomerId) => {
            try {
              const token = await ensureAccessToken(false)
              return await getCampaignNameByHttp({
                customerId,
                campaignId: String(row.google_campaign_id),
                accessToken: token,
                developerToken,
                loginCustomerId,
              })
            } catch (error) {
              if (!isTokenExpiredError(error)) {
                throw error
              }
              const token = await ensureAccessToken(true)
              return getCampaignNameByHttp({
                customerId,
                campaignId: String(row.google_campaign_id),
                accessToken: token,
                developerToken,
                loginCustomerId,
              })
            }
          })

          if (!remoteName) {
            missingRemote += 1
            console.warn(
              `  ⚠️ [${row.campaign_id}] empty remote name (googleCampaignId=${row.google_campaign_id})`
            )
            continue
          }

          if (remoteName === String(row.campaign_name || '')) {
            unchanged += 1
            continue
          }

          changed += 1
          const nextConfig = normalizeCampaignConfigWithName(row.campaign_config, remoteName)

          console.log(`  🔁 [${row.campaign_id}] "${row.campaign_name}" -> "${remoteName}"`)
          if (!options.dryRun) {
            if (nextConfig !== null) {
              await db.exec(
                `
                  UPDATE campaigns
                  SET campaign_name = ?, campaign_config = ?, updated_at = ${nowExpr}
                  WHERE id = ? AND user_id = ?
                `,
                [remoteName, nextConfig, row.campaign_id, row.user_id]
              )
            } else {
              await db.exec(
                `
                  UPDATE campaigns
                  SET campaign_name = ?, updated_at = ${nowExpr}
                  WHERE id = ? AND user_id = ?
                `,
                [remoteName, row.campaign_id, row.user_id]
              )
            }
            updated += 1
          }
        } catch (error: any) {
          failed += 1
          console.error(
            `  ❌ [${row.campaign_id}] failed (googleCampaignId=${row.google_campaign_id}): ${error?.message || error}`
          )
        }
      }
    }
    console.log('')
    console.log('─'.repeat(72))
    console.log('Summary')
    console.log('─'.repeat(72))
    console.log(`Checked: ${checked}`)
    console.log(`Changed: ${changed}`)
    console.log(`Updated: ${updated}`)
    console.log(`Unchanged: ${unchanged}`)
    console.log(`Missing remote name: ${missingRemote}`)
    console.log(`Skipped(no auth): ${skippedNoAuth}`)
    console.log(`Failed: ${failed}`)
    console.log('═'.repeat(72))
  } finally {
    closeDatabase()
  }
}

run()
  .then(() => {
    // MemoryCache uses an internal interval; force exit after script work is complete.
    process.exit(0)
  })
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
