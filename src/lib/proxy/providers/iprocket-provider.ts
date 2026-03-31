import type { ProxyProvider } from './base-provider'
import type { ProxyCredentials } from '../types'
import type { ValidationResult } from './base-provider'
import { validateProxyUrl } from '../validate-url'
import axios from 'axios'
import {
  ProxyFormatError,
  ProxyError,
  ProxyHttpError,
  ProxyNetworkError,
  ProxyProviderBusinessError,
  analyzeProxyError,
} from '../proxy-errors'

function isBusinessAbnormalityError(code: number, message: string): boolean {
  const lowerMessage = String(message || '').toLowerCase()
  if (lowerMessage.includes('business abnormality')) return true
  if (lowerMessage.includes('contact customer service')) return true
  if (lowerMessage.includes('account abnormal')) return true
  if (lowerMessage.includes('risk control')) return true

  // IPRocket有时会返回500但属于账户/风控类业务错误，不是临时网络故障
  return code === 500 && lowerMessage.includes('abnormal')
}

function createIprocketApiError(code: number, message: string): ProxyError {
  const normalized = message || 'Unknown API error'
  if (isBusinessAbnormalityError(code, normalized)) {
    return new ProxyProviderBusinessError(
      'IPRocket',
      `IPRocket API business error: ${normalized}`,
      code
    )
  }
  return new ProxyHttpError(code, `IPRocket API error: ${normalized}`)
}

/**
 * IPRocket代理提供商
 * 处理格式: https://api.iprocket.io/api?username=X&password=Y&cc=UK|CA|ROW&ips=1&proxyType=http&responseType=txt
 * 响应格式: host:port:username:password (文本)
 */
export class IPRocketProvider implements ProxyProvider {
  name = 'IPRocket'

  canHandle(url: string): boolean {
    return url.includes('api.iprocket.io')
  }

  validate(url: string): ValidationResult {
    return validateProxyUrl(url)
  }

  async extractCredentials(url: string): Promise<ProxyCredentials> {
    // 验证URL
    const validation = this.validate(url)
    if (!validation.isValid) {
      throw new Error(`IPRocket URL验证失败:\n${validation.errors.join('\n')}`)
    }

    // 优先使用轻量 HTTP 请求获取代理IP（更快、且不依赖 Playwright 浏览器安装）。
    // 响应格式: host:port:username:password (文本)
    try {
      const resp = await axios.get(url, {
        timeout: 15000,
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept': 'text/plain,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        validateStatus: () => true,
      })

      if (resp.status !== 200) {
        throw new ProxyHttpError(resp.status)
      }

      const text = typeof resp.data === 'string' ? resp.data : String(resp.data ?? '')

      // 检测IPRocket返回的JSON错误响应（HTTP 200但body是错误信息）
      // 例如: {"msg":"Business abnormality, please contact customer service","code":500}
      if (text.trim().startsWith('{') && text.includes('"code"')) {
        try {
          const jsonResp = JSON.parse(text)
          if (jsonResp.code && jsonResp.code !== 200) {
            const errorMsg = jsonResp.msg || jsonResp.message || 'Unknown API error'
            console.error(`[IPRocket] API返回业务错误: code=${jsonResp.code}, msg=${errorMsg}`)
            // 不要回退到Playwright，因为是API层面的错误（账户/配额/风控问题）
            throw createIprocketApiError(jsonResp.code, errorMsg)
          }
        } catch (parseErr) {
          // 如果是ProxyHttpError，重新抛出（不要被当作JSON解析错误）
          if (parseErr instanceof ProxyError) {
            throw parseErr
          }
          // 如果JSON解析失败但看起来像JSON，记录警告
          if (text.trim().startsWith('{')) {
            console.warn(`[IPRocket] 响应像JSON但解析失败: ${text.substring(0, 100)}`)
          }
        }
      }

      // 🔍 记录响应内容用于诊断（如果看起来不正常）
      if (text.length > 200 || !text.includes(':')) {
        console.warn(`[IPRocket] 响应内容异常（前200字符）: ${text.substring(0, 200)}`)
      }

      const firstLine = text.trim().split('\n')[0]?.trim()
      if (!firstLine) {
        throw new ProxyNetworkError('empty response')
      }

      const parts = firstLine.split(':')
      if (parts.length !== 4) {
        // 🔍 记录详细错误信息用于诊断
        console.error(`[IPRocket] 代理格式错误详情:`)
        console.error(`  期望格式: host:port:username:password (4个字段)`)
        console.error(`  实际字段数: ${parts.length}`)
        console.error(`  原始响应首行: ${firstLine}`)
        console.error(`  各字段内容: ${JSON.stringify(parts)}`)

        // 智能分析错误类型
        const analyzedError = analyzeProxyError(
          new Error(`invalid proxy format (${parts.length} parts)`),
          firstLine
        )
        throw analyzedError
      }

      const [host, portStr, username, password] = parts
      const port = parseInt(portStr, 10)
      if (!host || host.length < 7) throw new Error(`invalid host: ${host}`)
      if (Number.isNaN(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${portStr}`)
      if (!username) throw new Error('missing username')
      if (!password) throw new Error('missing password')

      return { host, port, username, password, fullAddress: `${host}:${port}` }
    } catch (error: any) {
      // API业务错误或明确不可重试错误：直接抛出，避免无效降级到Playwright再次请求同一API
      if (error instanceof ProxyProviderBusinessError) {
        throw error
      }
      if (error instanceof ProxyError && !error.retryable) {
        throw error
      }

      // HTTP 获取失败再回退到 Playwright（用于应对 provider 的反爬/挑战页）。
      console.warn(`[IPRocket] HTTP 获取失败，回退到 Playwright: ${error?.message || String(error)}`)
    }

    // 使用Playwright获取代理IP（兜底）
    const { chromium } = await import('playwright')

    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
          '--disable-ipc-flooding-protection',
          '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=ScriptStreaming',
          '--disable-v8-idle-tasks',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
        ],
      })

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
        colorScheme: 'light',
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Sec-Ch-Ua': '"Google Chrome";v="130", "Chromium";v="130", "Not?A_Brand";v="24"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
        },
      })

      const page = await context.newPage()

      // Stealth脚本
      await page.addInitScript(() => {
        delete Object.getPrototypeOf(navigator).webdriver
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        })
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5].map((_, i) => ({
            name: 'Chrome PDF Plugin',
            filename: 'internal-pdf-viewer',
            description: 'Portable Document Format',
          })),
        })
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        })
      })

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      })

      if (!response || response.status() !== 200) {
        const status = response?.status() || 0
        throw new ProxyHttpError(status, `获取代理IP失败: HTTP ${status || 'unknown'}`)
      }

      const text = await page.textContent('body')
      if (!text) {
        throw new ProxyNetworkError('代理IP响应为空')
      }

      // 检测IPRocket返回的JSON错误响应（HTTP 200但body是错误信息）
      if (text.trim().startsWith('{') && text.includes('"code"')) {
        try {
          const jsonResp = JSON.parse(text)
          if (jsonResp.code && jsonResp.code !== 200) {
            const errorMsg = jsonResp.msg || jsonResp.message || 'Unknown API error'
            console.error(`[IPRocket Playwright] API返回业务错误: code=${jsonResp.code}, msg=${errorMsg}`)
            throw createIprocketApiError(jsonResp.code, errorMsg)
          }
        } catch (parseErr) {
          // 如果是ProxyError，重新抛出
          if (parseErr instanceof ProxyError) {
            throw parseErr
          }
          if (text.trim().startsWith('{')) {
            console.warn(`[IPRocket Playwright] 响应像JSON但解析失败: ${text.substring(0, 100)}`)
          }
        }
      }

      // 🔍 记录响应内容用于诊断（如果看起来不正常）
      if (text.length > 200 || !text.includes(':')) {
        console.warn(`[IPRocket Playwright] 响应内容异常（前200字符）: ${text.substring(0, 200)}`)
      }

      // 解析代理字符串 (格式: host:port:username:password)
      const firstLine = text.trim().split('\n')[0].trim()
      const parts = firstLine.split(':')

      if (parts.length !== 4) {
        // 🔍 记录详细错误信息用于诊断
        console.error(`[IPRocket Playwright] 代理格式错误详情:`)
        console.error(`  期望格式: host:port:username:password (4个字段)`)
        console.error(`  实际字段数: ${parts.length}`)
        console.error(`  原始响应首行: ${firstLine}`)
        console.error(`  各字段内容: ${JSON.stringify(parts)}`)

        // 智能分析错误类型
        const analyzedError = analyzeProxyError(
          new Error(`代理IP格式错误: 期望4个字段，实际${parts.length}个字段`),
          firstLine
        )
        throw analyzedError
      }

      const [host, portStr, username, password] = parts

      // 验证
      if (!host || host.length < 7) {
        throw new Error(`主机地址无效: ${host}`)
      }

      const port = parseInt(portStr)
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`端口号无效: ${portStr}（有效范围: 1-65535）`)
      }

      if (!username || username.length === 0) {
        throw new Error('用户名不能为空')
      }

      if (!password || password.length === 0) {
        throw new Error('密码不能为空')
      }

      return {
        host,
        port,
        username,
        password,
        fullAddress: `${host}:${port}`,
      }
    } finally {
      if (browser) {
        await browser.close().catch(() => {})
      }
    }
  }
}
