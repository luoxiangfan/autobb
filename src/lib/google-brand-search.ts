/**
 * Google品牌词搜索（独立站增强）
 *
 * 目标：
 * - 使用品牌词（优先用户输入）在Google搜索
 * - 尝试提取：官网（首个自然结果）+ 搜索广告元素（headline/description/callout/sitelink）
 *
 * 约束：
 * - 反爬失败不影响主流程（best-effort）
 * - 解析规则以“稳定优先”为目标，尽量使用语义/结构选择器而非易变class
 */

import type { Page } from 'playwright'
import { getLanguageCodeForCountry } from '@/lib/language-country-codes'
import { getPlaywrightPool } from '@/lib/playwright-pool'
import { clearProxyCache } from '@/lib/proxy/fetch-proxy-ip'
import { smartWaitForLoad } from '@/lib/smart-wait-strategy'
import { isProxyConnectionError } from '@/lib/stealth-scraper/proxy-utils'
import { createStealthBrowser, configureStealthPage, getDynamicTimeout, randomDelay, releaseBrowser } from '@/lib/stealth-scraper/browser-stealth'
import { scrapeUrl } from '@/lib/scraper'
import { extractBrandServices, generateCalloutSuggestions, generateSitelinkSuggestions } from '@/lib/brand-services-extractor'

export interface SerpSitelink {
  text: string
  description?: string
}

export interface SerpAd {
  headlines: string[]
  descriptions: string[]
  callouts: string[]
  sitelinks: SerpSitelink[]
  displayUrl?: string
  landingUrl?: string
}

export interface BrandSearchSupplement {
  query: string
  targetCountry: string
  searchedAt: string
  officialSite?: {
    url: string
    title?: string
    snippet?: string
    metaTitle?: string
    metaDescription?: string
  }
  ads: SerpAd[]
  extracted: {
    headlines: string[]
    descriptions: string[]
    callouts: string[]
    sitelinks: SerpSitelink[]
  }
  errors?: string[]
}

function uniqStrings(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const normalized = item.trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

function uniqSitelinks(items: SerpSitelink[]): SerpSitelink[] {
  const seen = new Set<string>()
  const out: SerpSitelink[] = []
  for (const item of items) {
    const text = item?.text?.trim()
    if (!text) continue
    const key = `${text.toLowerCase()}__${(item.description || '').trim().toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ text, description: item.description?.trim() || undefined })
  }
  return out
}

async function maybeAcceptGoogleConsent(page: Page): Promise<void> {
  try {
    const candidates = [
      'button:has-text("Accept all")',
      'button:has-text("I agree")',
      'button:has-text("Aceptar todo")',
      'button:has-text("Acepto")',
      'button:has-text("同意")',
      'button:has-text("接受全部")',
    ]
    for (const selector of candidates) {
      const btn = page.locator(selector).first()
      if (await btn.count()) {
        await btn.click({ timeout: 2000 }).catch(() => {})
        await page.waitForTimeout(800).catch(() => {})
        return
      }
    }
  } catch {
    // best-effort
  }
}

export async function fetchBrandSearchSupplement(options: {
  brandName: string
  /**
   * Optional override query (e.g. "Brand + category").
   * When omitted, defaults to `brandName`.
   */
  query?: string
  targetCountry: string
  proxyApiUrl: string
  maxProxyRetries?: number
}): Promise<BrandSearchSupplement | null> {
  const brandName = options.brandName.trim()
  const query = (options.query || brandName).trim()
  if (!query) return null

  const lang = getLanguageCodeForCountry(options.targetCountry) || 'en'
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=${encodeURIComponent(lang)}&gl=${encodeURIComponent(options.targetCountry)}&num=10`

  const errors: string[] = []
  const maxProxyRetries = typeof options.maxProxyRetries === 'number' ? options.maxProxyRetries : 2

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    let browserResult: Awaited<ReturnType<typeof createStealthBrowser>> | null = null
    let page: Page | null = null

    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 Google SERP抓取 - 代理重试 ${proxyAttempt}/${maxProxyRetries}`)
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        clearProxyCache(options.proxyApiUrl)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      browserResult = await createStealthBrowser(options.proxyApiUrl, options.targetCountry)
      page = await browserResult.context.newPage()
      await configureStealthPage(page, options.targetCountry)

      await randomDelay(500, 1500)

      const response = await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: getDynamicTimeout(searchUrl),
      })

      if (!response) throw new Error('Google SERP: No response received')

      // 等待 SERP 主体出现（Google会持续请求资源，不适合等 networkidle）
      await page.waitForSelector('#search, #rso', { timeout: 8000 }).catch(() => {})
      await smartWaitForLoad(page, searchUrl, { maxWaitTime: 8000 }).catch(() => {})
      await maybeAcceptGoogleConsent(page)
      await randomDelay(500, 1200)

      // 轻量滚动，触发可能的懒加载
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight))
        await randomDelay(300, 600)
      }

      // 简单反爬检测：出现验证码/异常流量提示时换代理重试（best-effort）
      const maybeBlocked = await page.locator('text=/unusual traffic|not a robot|验证|captcha/i').first().count().catch(() => 0)
      if (maybeBlocked) {
        const title = await page.title().catch(() => '(unknown title)')
        const msg = `Google SERP疑似触发反爬（unusual traffic / captcha），title="${title}"`
        errors.push(msg)
        if (proxyAttempt < maxProxyRetries) continue
        return {
          query,
          targetCountry: options.targetCountry,
          searchedAt: new Date().toISOString(),
          ads: [],
          extracted: { headlines: [], descriptions: [], callouts: [], sitelinks: [] },
          errors,
        }
      }

      const raw = await page.evaluate(() => {
        const normalize = (s: string) => (s || '').replace(/\s+/g, ' ').trim()

        const isGoogleHost = (host: string) => {
          const h = (host || '').toLowerCase()
          return (
            h === 'google.com' ||
            h.endsWith('.google.com') ||
            h.endsWith('.googleusercontent.com') ||
            h === 'googleadservices.com' ||
            h.endsWith('.googleadservices.com') ||
            h === 'doubleclick.net' ||
            h.endsWith('.doubleclick.net')
          )
        }

        const unwrapGoogleRedirect = (href: string | null | undefined): string | null => {
          if (!href) return null
          try {
            const u = new URL(href, location.origin)

            // Google 常见跳转包装：
            // - /url?q=https://...
            // - /aclk?adurl=https://...
            if (isGoogleHost(u.hostname)) {
              const path = u.pathname || ''
              if (path === '/url' || path === '/aclk' || path === '/imgres' || path.includes('/pagead/aclk')) {
                const candidate =
                  u.searchParams.get('q') ||
                  u.searchParams.get('url') ||
                  u.searchParams.get('adurl') ||
                  u.searchParams.get('imgurl')
                if (candidate && /^https?:\/\//i.test(candidate)) return candidate
              }
            }

            if (/^https?:\/\//i.test(u.href)) return u.href
            return null
          } catch {
            return null
          }
        }

        const organic: Array<{ url: string; title?: string; snippet?: string }> = []
        const organicAnchors = Array.from(document.querySelectorAll('#search a[href]')) as HTMLAnchorElement[]
        for (const a of organicAnchors) {
          const h3 = a.querySelector('h3')
          if (!h3) continue

          const url = unwrapGoogleRedirect(a.getAttribute('href') || a.href)
          if (!url) continue
          if (!/^https?:\/\//i.test(url)) continue
          if (url.includes('google.com/')) continue
          if (url.includes('googleusercontent.com/')) continue

          const root =
            (a.closest('div.MjjYud') as HTMLElement | null) ||
            (a.closest('div.g') as HTMLElement | null) ||
            (a.closest('div') as HTMLElement | null)

          const snippetNode =
            (root?.querySelector('div.VwiC3b') as HTMLElement | null) ||
            (root?.querySelector('span.VwiC3b') as HTMLElement | null) ||
            (root?.querySelector('[data-sncf]') as HTMLElement | null)

          const snippet = snippetNode ? normalize(snippetNode.textContent || '') : undefined

          organic.push({
            url,
            title: normalize(h3.textContent || ''),
            snippet: snippet || undefined,
          })
          if (organic.length >= 3) break
        }

        const adContainersSet = new Set<HTMLElement>()
        for (const el of Array.from(document.querySelectorAll('#tads .uEierd')) as HTMLElement[]) adContainersSet.add(el)
        for (const el of Array.from(document.querySelectorAll('#tads [data-text-ad]')) as HTMLElement[]) adContainersSet.add(el)
        for (const el of Array.from(document.querySelectorAll('[data-text-ad]')) as HTMLElement[]) adContainersSet.add(el)
        const adContainers = Array.from(adContainersSet)

        const ads = adContainers.slice(0, 8).map((container) => {
          // 注意：先按换行切分，再 normalize（之前先 normalize 会导致 '\n' 被抹掉，lines 永远只有1行）
          const rawText = container.innerText || ''
          const lines = rawText.split('\n').map(normalize).filter(Boolean)

          const headlineEls = Array.from(container.querySelectorAll('a h3, a div[role="heading"], a span[role="heading"]'))
          const headlines = headlineEls.map(el => normalize(el.textContent || '')).filter(Boolean).filter(h => h.length >= 3 && h.length <= 120)

          const linkEls = Array.from(container.querySelectorAll('a[href]')) as HTMLAnchorElement[]
          const landingUrl = linkEls
            .map(a => unwrapGoogleRedirect(a.getAttribute('href') || a.href))
            .find(u => !!u && /^https?:\/\//i.test(u) && !u.includes('google.com/')) || undefined

          const displayUrl = lines.find(l => /\b(www\.)?[\w-]+\.[a-z]{2,}\b/i.test(l) && l.length <= 80)

          // descriptions：去掉headlines/展示URL后，保留较长行
          const headlineSet = new Set(headlines.map(h => h.toLowerCase()))
          const descriptions = lines
            .filter(l => l.length >= 30 && l.length <= 180)
            .filter(l => !headlineSet.has(l.toLowerCase()))
            .filter(l => displayUrl ? l !== displayUrl : true)

          // callouts：短句（<=25），排除“Sponsored/Ad”
          const callouts = lines
            .filter(l => l.length >= 4 && l.length <= 25)
            .filter(l => !/^(ad|ads|sponsored|赞助内容)$/i.test(l))
            .filter(l => !headlineSet.has(l.toLowerCase()))

          // sitelinks：短文本链接（<=25），尽量从a元素文本提取
          const sitelinks: Array<{ text: string; description?: string }> = []
          for (const a of linkEls) {
            const t = normalize(a.textContent || '')
            if (!t) continue
            if (t.length > 25) continue
            if (/^(ad|ads|sponsored)$/i.test(t)) continue
            if (headlineSet.has(t.toLowerCase())) continue
            sitelinks.push({ text: t })
            if (sitelinks.length >= 8) break
          }

          return {
            headlines,
            descriptions,
            callouts,
            sitelinks,
            displayUrl,
            landingUrl,
          }
        })

        return {
          organic,
          officialSite: organic[0],
          ads,
        }
      })

      const organicOk = !!raw.officialSite?.url
      const adsOk = Array.isArray(raw.ads) && raw.ads.length > 0
      if (!organicOk && !adsOk) {
        const title = await page.title().catch(() => '(unknown title)')
        const msg = `SERP解析为空（无自然结果/广告），title="${title}"`
        errors.push(msg)
        if (proxyAttempt < maxProxyRetries) continue
      }

      const normalizeBrandKey = (input: string) =>
        input.toLowerCase().replace(/[^a-z0-9]/g, '')

      const isDisallowedHost = (hostname: string): boolean => {
        const h = (hostname || '').toLowerCase()
        // Marketplace / platform pages (site filtering will be noisy)
        if (/(^|\.)amazon\./i.test(h)) return true
        if (/(^|\.)ebay\./i.test(h)) return true
        if (/(^|\.)walmart\./i.test(h)) return true
        if (/(^|\.)aliexpress\./i.test(h)) return true
        if (/(^|\.)temu\./i.test(h)) return true
        if (/(^|\.)etsy\./i.test(h)) return true
        // Social / directory / wiki (high false-positive rates)
        if (/(^|\.)facebook\.com$/i.test(h)) return true
        if (/(^|\.)instagram\.com$/i.test(h)) return true
        if (/(^|\.)youtube\.com$/i.test(h)) return true
        if (/(^|\.)tiktok\.com$/i.test(h)) return true
        if (/(^|\.)x\.com$/i.test(h)) return true
        if (/(^|\.)twitter\.com$/i.test(h)) return true
        if (/(^|\.)wikipedia\.org$/i.test(h)) return true
        if (/(^|\.)linkedin\.com$/i.test(h)) return true
        return false
      }

      const scoreOfficialCandidate = (candidate: { url: string; title?: string; snippet?: string }, brand: string): number => {
        try {
          const u = new URL(candidate.url)
          const host = u.hostname.toLowerCase().replace(/^www\./i, '')
          if (isDisallowedHost(host)) return -1000

          const brandKey = normalizeBrandKey(brand)
          const hostKey = normalizeBrandKey(host)
          const titleKey = normalizeBrandKey(candidate.title || '')
          const snippetKey = normalizeBrandKey(candidate.snippet || '')

          let score = 0
          if (brandKey && hostKey.includes(brandKey)) score += 8
          if (brandKey && (titleKey.includes(brandKey) || snippetKey.includes(brandKey))) score += 3
          if (u.pathname === '/' || u.pathname === '') score += 1
          return score
        } catch {
          return -1000
        }
      }

      const organicCandidates = Array.isArray((raw as any).organic) ? ((raw as any).organic as Array<{ url: string; title?: string; snippet?: string }>) : []
      const adLandingCandidates = Array.isArray(raw.ads)
        ? raw.ads
            .map((a: any) => ({ url: a?.landingUrl, title: a?.displayUrl }))
            .filter((c: any) => typeof c?.url === 'string' && /^https?:\/\//i.test(c.url))
        : []

      const allCandidates = [
        ...organicCandidates,
        ...adLandingCandidates,
      ].filter(c => typeof c?.url === 'string')

      // Prefer brand-relevant, non-marketplace domains; fall back to the previous behavior.
      const bestCandidate = allCandidates
        .map(c => ({ c, score: scoreOfficialCandidate(c as any, brandName) }))
        .sort((a, b) => b.score - a.score)[0]?.c as any | undefined

      const selectedOrganic = bestCandidate
        ? organicCandidates.find(o => o.url === bestCandidate.url) || null
        : null

      // 🔥 额外抓取官网页面信息（best-effort）：补充meta title/description + 真实callout/sitelink建议
      let officialMetaTitle: string | undefined
      let officialMetaDescription: string | undefined
      let officialCallouts: string[] = []
      let officialSitelinks: SerpSitelink[] = []

      const officialUrlCandidate =
        bestCandidate?.url ||
        raw.officialSite?.url ||
        (Array.isArray(raw.ads) ? raw.ads.find((a: any) => typeof a?.landingUrl === 'string' && a.landingUrl.trim())?.landingUrl : undefined)
      const officialUrl = typeof officialUrlCandidate === 'string' ? officialUrlCandidate.trim() : undefined
      if (!officialUrl) {
        errors.push('未能从Google SERP解析出官网链接')
      }
      if (officialUrl) {
        try {
          const pageData = await scrapeUrl(officialUrl, options.proxyApiUrl, lang)
          officialMetaTitle = pageData.title?.trim() || undefined
          officialMetaDescription = pageData.description?.trim() || undefined

          const services = await extractBrandServices(officialUrl, options.targetCountry, options.proxyApiUrl)
          officialCallouts = generateCalloutSuggestions(services)
          officialSitelinks = generateSitelinkSuggestions(services, query).map(s => ({
            text: s.title,
            description: s.description,
          }))
        } catch (e: any) {
          errors.push(`官网补充抓取失败: ${e?.message || String(e)}`)
        }
      }

      const ads: SerpAd[] = (raw.ads || []).map((a: any) => ({
        headlines: uniqStrings(Array.isArray(a.headlines) ? a.headlines : []),
        descriptions: uniqStrings(Array.isArray(a.descriptions) ? a.descriptions : []),
        callouts: uniqStrings(Array.isArray(a.callouts) ? a.callouts : []),
        sitelinks: uniqSitelinks(Array.isArray(a.sitelinks) ? a.sitelinks : []),
        displayUrl: typeof a.displayUrl === 'string' ? a.displayUrl : undefined,
        landingUrl: typeof a.landingUrl === 'string' ? a.landingUrl : undefined,
      }))

      const extractedHeadlines = uniqStrings([
        ...(officialMetaTitle ? [officialMetaTitle] : []),
        ...(raw.officialSite?.title ? [raw.officialSite.title] : []),
        ...ads.flatMap(a => a.headlines),
      ]).slice(0, 30)

      const extractedDescriptions = uniqStrings([
        ...(officialMetaDescription ? [officialMetaDescription] : []),
        ...(raw.officialSite?.snippet ? [raw.officialSite.snippet] : []),
        ...ads.flatMap(a => a.descriptions),
      ]).slice(0, 20)

      if (extractedHeadlines.length === 0 && extractedDescriptions.length === 0) {
        errors.push('SERP解析到的headline/description为空（可能无广告或结构变化）')
      }

      const extractedCallouts = uniqStrings([
        ...officialCallouts,
        ...ads.flatMap(a => a.callouts),
      ]).slice(0, 20)

      const extractedSitelinks = uniqSitelinks([
        ...officialSitelinks,
        ...ads.flatMap(a => a.sitelinks),
      ]).slice(0, 12)

      return {
        query,
        targetCountry: options.targetCountry,
        searchedAt: new Date().toISOString(),
        officialSite: officialUrl ? {
          ...(selectedOrganic || raw.officialSite || {}),
          url: officialUrl,
          metaTitle: officialMetaTitle,
          metaDescription: officialMetaDescription,
        } : undefined,
        ads,
        extracted: {
          headlines: extractedHeadlines,
          descriptions: extractedDescriptions,
          callouts: extractedCallouts,
          sitelinks: extractedSitelinks,
        },
        errors: errors.length > 0 ? errors : undefined,
      }
    } catch (error: any) {
      if (isProxyConnectionError(error) && proxyAttempt < maxProxyRetries) {
        errors.push(`代理连接失败: ${error?.message || String(error)}`)
        continue
      }

      errors.push(error?.message || String(error))
      return {
        query,
        targetCountry: options.targetCountry,
        searchedAt: new Date().toISOString(),
        ads: [],
        extracted: { headlines: [], descriptions: [], callouts: [], sitelinks: [] },
        errors,
      }
    } finally {
      if (page) await page.close().catch(() => {})
      if (browserResult) await releaseBrowser(browserResult)
    }
  }

  // 理论上不会走到这里：for 循环在成功/失败都会 return
  return {
    query,
    targetCountry: options.targetCountry,
    searchedAt: new Date().toISOString(),
    ads: [],
    extracted: { headlines: [], descriptions: [], callouts: [], sitelinks: [] },
    errors: errors.length > 0 ? errors : ['Google SERP抓取失败：未知原因'],
  }
}
