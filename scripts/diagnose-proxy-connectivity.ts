/**
 * 代理连通性诊断（对齐 URL 解析 / Playwright 链路）
 *
 * Kookeey（直连，与生产 KookeeyProvider 一致）:
 *   npx tsx scripts/diagnose-proxy-connectivity.ts --kookeey
 *   npx tsx scripts/diagnose-proxy-connectivity.ts --kookeey "gate.kookeey.info:1000:user:pass-US" --playwright
 *   # 或环境变量 KOOKEEY_PROXY_URL / PROXY_URL（系统设置里存的同一串）
 *
 * 其他示例:
 *   npx tsx scripts/diagnose-proxy-connectivity.ts --proxy-url "$PROXY_URL" --playwright
 *   npx tsx scripts/diagnose-proxy-connectivity.ts --iprocket --country US
 *
 * 环境变量:
 *   KOOKEEY_PROXY_URL  host:port:username:password[-CC]  （Kookeey 推荐）
 *   PROXY_URL            与生产一致（Kookeey / IPRocket 等）
 *   IPROCKET_USERNAME / IPROCKET_PASSWORD  （--iprocket 时）
 */

import 'dotenv/config'
import axios from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { ProxyCredentials } from '@/lib/scraping/proxy/types'
import { fetchProxyIp, getProxyIp, tcpPing } from '@/lib/scraping/proxy/fetch-proxy-ip'
import { ProxyProviderRegistry } from '@/lib/scraping/proxy/providers/provider-registry'

const DEFAULT_YEAHPROMOS_URL =
  'https://yeahpromos.com/index/index/openurl?track=b8c4365a831c6232&url='

interface CliOptions {
  proxyUrl?: string
  kookeeyUrl?: string
  proxyInline?: string
  host?: string
  port?: number
  user?: string
  pass?: string
  iprocket: boolean
  country: string
  userId?: number
  forceRefresh: boolean
  skipHealthCheck: boolean
  testUrl: string
  timeoutMs: number
  playwright: boolean
  baseline: boolean
  json: boolean
}

interface ResolvedProxy {
  creds: ProxyCredentials
  providerName: string
  countryFromPassword: string | null
  sourceUrl: string
}

interface StepResult {
  name: string
  ok: boolean
  ms: number
  detail?: string
  error?: string
  meta?: Record<string, unknown>
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    iprocket: false,
    country: 'US',
    forceRefresh: true,
    skipHealthCheck: false,
    testUrl: DEFAULT_YEAHPROMOS_URL,
    timeoutMs: 30000,
    playwright: false,
    baseline: false,
    json: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    switch (arg) {
      case '--proxy-url':
        opts.proxyUrl = next
        i++
        break
      case '--kookeey':
        opts.kookeeyUrl =
          next && !next.startsWith('--')
            ? next
            : process.env.KOOKEEY_PROXY_URL || process.env.PROXY_URL
        if (next && !next.startsWith('--')) i++
        break
      case '--skip-health-check':
        opts.skipHealthCheck = true
        break
      case '--proxy':
        opts.proxyInline = next
        i++
        break
      case '--host':
        opts.host = next
        i++
        break
      case '--port':
        opts.port = parseInt(next, 10)
        i++
        break
      case '--user':
        opts.user = next
        i++
        break
      case '--pass':
        opts.pass = next
        i++
        break
      case '--iprocket':
        opts.iprocket = true
        break
      case '--country':
        opts.country = (next || 'US').toUpperCase()
        i++
        break
      case '--user-id':
        opts.userId = parseInt(next, 10)
        i++
        break
      case '--reuse-cache':
        opts.forceRefresh = false
        break
      case '--url':
        opts.testUrl = next
        i++
        break
      case '--timeout':
        opts.timeoutMs = parseInt(next, 10)
        i++
        break
      case '--playwright':
        opts.playwright = true
        break
      case '--baseline':
        opts.baseline = true
        break
      case '--json':
        opts.json = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
    }
  }

  return opts
}

function printHelp(): void {
  console.log(`
代理连通性诊断

Kookeey（系统设置 / 用户代理池中的直连串）:
  --kookeey [url]       host:port:username:password  或 password 以 -US 结尾表示国家
  环境变量 KOOKEEY_PROXY_URL 或 PROXY_URL
  示例: res28.kookeey.info:26368:myuser:mypass-US

选项:
  --proxy-url <url>     使用 getProxyIp（与生产一致）
  --proxy <http://u:p@h:p>  直接指定代理
  --host / --port / --user / --pass   分项指定代理
  --iprocket            从 IPRocket API 拉取代理
  --country <CC>        国家代码（仅 --iprocket / 日志标注）
  --user-id <id>        getProxyIp 用户隔离（--reuse-cache 时必填）
  --reuse-cache         不强制刷新（Kookeey 直连串通常不变）
  --skip-health-check   跳过 fetchProxyIp 内置 httpbin 健康检查
  --url / --timeout / --playwright / --baseline / --json
  -h, --help
`)
}

function maskProxy(creds: ProxyCredentials): string {
  return `${creds.host}:${creds.port} (user=${creds.username.slice(0, 4)}***)`
}

function buildAgent(creds: ProxyCredentials): HttpsProxyAgent<string> {
  const auth = `${encodeURIComponent(creds.username)}:${encodeURIComponent(creds.password)}`
  return new HttpsProxyAgent(`http://${auth}@${creds.host}:${creds.port}`)
}

function extractKookeeyCountry(password: string): string | null {
  const match = password.match(/-([A-Z]{2})$/i)
  return match ? match[1].toUpperCase() : null
}

function isKookeeyDirectUrl(url: string): boolean {
  const clean = url.replace(/^https?:\/\//, '')
  return clean.includes('kookeey.info') && clean.includes(':') && !clean.includes('@')
}

async function resolveProxy(opts: CliOptions): Promise<ResolvedProxy> {
  if (opts.proxyInline) {
    const u = new URL(opts.proxyInline)
    const creds: ProxyCredentials = {
      host: u.hostname,
      port: parseInt(u.port || '80', 10),
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      fullAddress: `${u.hostname}:${u.port}`,
    }
    return {
      creds,
      providerName: 'inline',
      countryFromPassword: extractKookeeyCountry(creds.password),
      sourceUrl: opts.proxyInline,
    }
  }

  if (opts.host && opts.port && opts.user && opts.pass) {
    const creds: ProxyCredentials = {
      host: opts.host,
      port: opts.port,
      username: opts.user,
      password: opts.pass,
      fullAddress: `${opts.host}:${opts.port}`,
    }
    return {
      creds,
      providerName: 'manual',
      countryFromPassword: extractKookeeyCountry(creds.password),
      sourceUrl: `${opts.host}:${opts.port}`,
    }
  }

  if (opts.iprocket) {
    const username = process.env.IPROCKET_USERNAME
    const password = process.env.IPROCKET_PASSWORD
    if (!username || !password) {
      throw new Error('IPRocket 模式需要 IPROCKET_USERNAME 和 IPROCKET_PASSWORD')
    }
    const apiUrl =
      `https://api.iprocket.io/api?username=${username}&password=${password}` +
      `&cc=${opts.country}&ips=1&type=-res-&proxyType=http&responseType=txt`
    const resp = await axios.get(apiUrl, {
      timeout: 15000,
      responseType: 'text',
      validateStatus: () => true,
    })
    const text = String(resp.data || '').trim()
    if (resp.status !== 200 || !text.includes(':')) {
      throw new Error(`IPRocket API 失败: HTTP ${resp.status} body=${text.slice(0, 120)}`)
    }
    const [host, port, user, pass] = text.split(':')
    const creds: ProxyCredentials = {
      host,
      port: parseInt(port, 10),
      username: user,
      password: pass,
      fullAddress: `${host}:${port}`,
    }
    return {
      creds,
      providerName: 'IPRocket',
      countryFromPassword: opts.country,
      sourceUrl: `iprocket:${opts.country}`,
    }
  }

  const proxyUrl =
    opts.kookeeyUrl || opts.proxyUrl || process.env.KOOKEEY_PROXY_URL || process.env.PROXY_URL

  if (!proxyUrl) {
    throw new Error(
      '请指定代理: --kookeey / KOOKEEY_PROXY_URL / --proxy-url / --proxy / --iprocket'
    )
  }

  const provider = ProxyProviderRegistry.getProvider(proxyUrl)

  // Kookeey 为直连串：与生产一致走 fetchProxyIp（含可选健康检查）
  if (provider.name === 'Kookeey' || isKookeeyDirectUrl(proxyUrl)) {
    const creds = await fetchProxyIp(proxyUrl, 1, opts.skipHealthCheck)
    return {
      creds,
      providerName: 'Kookeey',
      countryFromPassword: extractKookeeyCountry(creds.password),
      sourceUrl: maskKookeeyUrl(proxyUrl),
    }
  }

  const creds = await getProxyIp(proxyUrl, opts.forceRefresh, opts.userId)
  return {
    creds,
    providerName: provider.name,
    countryFromPassword: null,
    sourceUrl: proxyUrl,
  }
}

function maskKookeeyUrl(url: string): string {
  const clean = url.replace(/^https?:\/\//, '')
  const parts = clean.split(':')
  if (parts.length >= 4) {
    parts[parts.length - 1] = '***'
    return parts.join(':')
  }
  return url
}

function parseRefreshTarget(refresh: string | null | undefined): string | null {
  if (!refresh) return null
  const m = refresh.match(/url=(.+)$/i)
  const target = m?.[1]?.trim()
  if (target && /^https?:\/\//i.test(target)) return target
  return null
}

async function httpProbe(
  name: string,
  url: string,
  options: {
    agent?: HttpsProxyAgent<string>
    timeoutMs: number
    maxRedirects?: number
    label: string
  }
): Promise<StepResult> {
  const start = Date.now()
  try {
    const resp = await axios.get(url, {
      httpAgent: options.agent,
      httpsAgent: options.agent,
      timeout: options.timeoutMs,
      maxRedirects: options.maxRedirects ?? 0,
      validateStatus: () => true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      responseType: 'text',
    })
    const ms = Date.now() - start
    const refresh = resp.headers.refresh || resp.headers.Refresh || null
    const location = resp.headers.location || resp.headers.Location || null
    const refreshTarget = parseRefreshTarget(
      typeof refresh === 'string' ? refresh : Array.isArray(refresh) ? refresh[0] : null
    )

    const ok = resp.status >= 200 && resp.status < 500
    const detail = [
      `HTTP ${resp.status}`,
      location ? `Location: ${String(location).slice(0, 80)}` : null,
      refresh ? `Refresh: ${String(refresh).slice(0, 100)}` : null,
      refreshTarget ? `→ ${refreshTarget.slice(0, 80)}` : null,
    ]
      .filter(Boolean)
      .join(' | ')

    return {
      name: `${options.label}: ${name}`,
      ok,
      ms,
      detail,
      meta: {
        status: resp.status,
        refreshTarget,
        bodyLength: typeof resp.data === 'string' ? resp.data.length : 0,
      },
    }
  } catch (error: unknown) {
    const ms = Date.now() - start
    const message = error instanceof Error ? error.message : String(error)
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code)
        : undefined
    return {
      name: `${options.label}: ${name}`,
      ok: false,
      ms,
      error: code ? `${code}: ${message}` : message,
    }
  }
}

async function playwrightProbe(
  url: string,
  creds: ProxyCredentials,
  timeoutMs: number
): Promise<StepResult> {
  const start = Date.now()
  try {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({
      headless: true,
      proxy: {
        server: `http://${creds.host}:${creds.port}`,
        username: creds.username,
        password: creds.password,
      },
      args: ['--disable-http2', '--disable-quic', '--no-sandbox'],
    })
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      })
      const page = await context.newPage()
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      })
      const finalUrl = page.url()
      const status = response?.status() ?? null
      await context.close()
      const ms = Date.now() - start
      return {
        name: 'playwright: page.goto',
        ok: Boolean(response) && status !== null && status < 500,
        ms,
        detail: `status=${status} final=${finalUrl.slice(0, 100)}`,
        meta: { status, finalUrl },
      }
    } finally {
      await browser.close()
    }
  } catch (error: unknown) {
    return {
      name: 'playwright: page.goto',
      ok: false,
      ms: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function printStep(r: StepResult): void {
  const icon = r.ok ? '✅' : '❌'
  const line = `${icon} ${r.name} (${r.ms}ms)`
  console.log(r.detail ? `${line}\n   ${r.detail}` : line)
  if (r.error) console.log(`   error: ${r.error}`)
}

function summarize(results: StepResult[]): { pass: number; fail: number; verdict: string } {
  const fail = results.filter((r) => !r.ok).length
  const pass = results.length - fail
  const critical = results.filter(
    (r) => r.name.includes('yeahpromos') || r.name.includes('playwright')
  )
  const criticalFail = critical.some((r) => !r.ok)

  let verdict = '代理链路正常，URL 解析应可走 HTTP Meta Refresh'
  if (criticalFail) {
    verdict = 'YeahPromos / Playwright 失败 — 与生产「代理连接问题」一致，请换代理或国家后重试'
  } else if (fail > 0) {
    verdict = '部分探测失败，请检查 httpbin 或网络策略'
  }

  return { pass, fail, verdict }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))

  if (!opts.json) {
    console.log('🔍 代理连通性诊断\n')
  }

  const resolved = await resolveProxy(opts)
  const { creds } = resolved
  if (!opts.json) {
    console.log(`代理商: ${resolved.providerName}`)
    if (resolved.countryFromPassword) {
      console.log(`密码后缀国家: ${resolved.countryFromPassword}（Kookeey 常用 password-XX 格式）`)
    }
    console.log(`代理: ${maskProxy(creds)}`)
    if (resolved.providerName === 'Kookeey') {
      console.log(
        '说明: Kookeey 为固定网关凭证，不换 IP；若 YeahPromos 失败可尝试 password 改为 ...-US / ...-DE\n'
      )
    } else {
      console.log('')
    }
  }

  const results: StepResult[] = []

  // TCP
  const tcpMs = await tcpPing(creds.host, creds.port, 5000)
  results.push({
    name: 'tcp: proxy host:port',
    ok: tcpMs >= 0,
    ms: tcpMs >= 0 ? tcpMs : 5000,
    detail: tcpMs >= 0 ? `connected in ${tcpMs}ms` : 'connection failed / timeout',
  })

  const agent = buildAgent(creds)

  if (opts.baseline) {
    results.push(
      await httpProbe('httpbin.org/ip', 'https://httpbin.org/ip', {
        timeoutMs: opts.timeoutMs,
        label: 'direct',
      })
    )
    results.push(
      await httpProbe('yeahpromos', opts.testUrl, {
        timeoutMs: opts.timeoutMs,
        label: 'direct',
      })
    )
  }

  results.push(
    await httpProbe('httpbin.org/ip', 'https://httpbin.org/ip', {
      agent,
      timeoutMs: opts.timeoutMs,
      label: 'proxy',
    })
  )

  const yp = await httpProbe('yeahpromos openurl', opts.testUrl, {
    agent,
    timeoutMs: opts.timeoutMs,
    label: 'proxy',
  })
  results.push(yp)

  const refreshTarget =
    yp.meta && typeof yp.meta.refreshTarget === 'string' ? yp.meta.refreshTarget : null
  if (refreshTarget) {
    results.push(
      await httpProbe('refresh target (amazon)', refreshTarget, {
        agent,
        timeoutMs: opts.timeoutMs,
        maxRedirects: 5,
        label: 'proxy',
      })
    )
  }

  if (opts.playwright) {
    const pwTimeout = Math.max(opts.timeoutMs, 90000)
    results.push(await playwrightProbe(opts.testUrl, creds, pwTimeout))
  }

  const summary = summarize(results)

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          provider: resolved.providerName,
          countryFromPassword: resolved.countryFromPassword,
          proxy: maskProxy(creds),
          country: resolved.countryFromPassword || opts.country,
          testUrl: opts.testUrl,
          results,
          summary,
        },
        null,
        2
      )
    )
  } else {
    console.log('\n--- 结果 ---\n')
    for (const r of results) printStep(r)
    console.log(`\n📊 ${summary.pass}/${results.length} 通过`)
    console.log(`💡 ${summary.verdict}\n`)
  }

  process.exit(summary.fail > 0 && results.some((r) => !r.ok && r.name.includes('proxy')) ? 1 : 0)
}

main().catch((err) => {
  console.error('❌', err instanceof Error ? err.message : err)
  process.exit(1)
})
