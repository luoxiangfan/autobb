import axios from 'axios'
import { load } from 'cheerio'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getProxyIp } from './proxy/fetch-proxy-ip'
import type { ProxyCredentials } from './proxy/types'
import { normalizeBrandName } from './offer-utils'
import { getAcceptLanguageHeader, getLanguageCodeForCountry } from './language-country-codes'
import { deriveBrandFromProductTitle, isLikelyInvalidBrandName } from './brand-name-utils'
import {
  extractLandingDescription,
  extractLandingImages,
  extractLandingPrice,
  extractLandingProductName,
  isPresellStyleUrl,
  getRegistrableDomainLabelFromUrl,
  refineBrandNameForLandingPage,
} from './landing-page-scrape-utils'

const PROXY_ENABLED = process.env.PROXY_ENABLED === 'true'
const PROXY_URL = process.env.PROXY_URL || ''

/**
 * 获取代理配置（使用新的代理模块）
 */
async function getProxyAgent(customProxyUrl?: string, userId?: number): Promise<HttpsProxyAgent<string> | undefined> {
  const proxyUrl = customProxyUrl || PROXY_URL

  // 检查是否启用代理
  if (!PROXY_ENABLED && !customProxyUrl) {
    return undefined
  }

  if (!proxyUrl) {
    console.warn('代理URL未配置，使用直连')
    return undefined
  }

  try {
    // 使用新的代理模块获取代理IP（启用5分钟缓存，避免频繁调用IPRocket API）
    const proxy: ProxyCredentials = await getProxyIp(proxyUrl, false, userId)

    console.log(`使用代理: ${proxy.fullAddress}`)

    // 创建代理Agent (格式: http://username:password@host:port)
    // 添加keepAlive配置以确保稳定的HTTPS隧道连接
    return new HttpsProxyAgent(
      `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`,
      {
        keepAlive: true,
        keepAliveMsecs: 1000,
        timeout: 60000,
        scheduling: 'lifo',
      }
    )
  } catch (error: any) {
    console.error('获取代理失败:', error.message)
    // 不降级为直连，抛出错误
    throw new Error(`代理服务不可用: ${error.message}`)
  }
}

// 使用全局统一的Accept-Language映射（支持27种语言）
// 通过 getAcceptLanguageHeader() 函数获取

/**
 * 抓取网页内容
 * @param url - 要抓取的URL
 * @param customProxyUrl - 自定义代理URL
 * @param language - 目标语言代码（支持27种语言，如 en, zh, ja, ko, de, fr, es, it, pt, sv, no, da 等）
 * @param userId - 用户ID（用于代理IP缓存隔离）
 */
export async function scrapeUrl(url: string, customProxyUrl?: string, language?: string, userId?: number): Promise<{
  html: string
  title: string
  description: string
  text: string
}> {
  try {
    const proxyAgent = await getProxyAgent(customProxyUrl, userId)
    const acceptLanguage = getAcceptLanguageHeader(language || 'en')

    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': acceptLanguage,
      },
      ...(proxyAgent && { httpsAgent: proxyAgent, httpAgent: proxyAgent as any }),
    })

    const html = response.data
    const $ = load(html)

    // 提取页面标题
    const title = $('title').text() || $('h1').first().text() || ''

    // 提取meta描述
    const description = $('meta[name="description"]').attr('content') ||
                       $('meta[property="og:description"]').attr('content') || ''

    // 移除script和style标签
    $('script, style, noscript').remove()

    // 提取纯文本内容（用于AI分析）
    const text = $('body').text()
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 10000) // 限制文本长度

    return {
      html,
      title,
      description,
      text,
    }
  } catch (error: any) {
    console.error('抓取URL失败:', error)
    throw new Error(`抓取失败: ${error.message}`)
  }
}

/**
 * 验证URL是否可访问
 */
export async function validateUrl(url: string, customProxyUrl?: string, userId?: number): Promise<{
  isAccessible: boolean
  statusCode?: number
  error?: string
}> {
  try {
    const proxyAgent = await getProxyAgent(customProxyUrl, userId)

    const response = await axios.head(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      ...(proxyAgent && { httpsAgent: proxyAgent, httpAgent: proxyAgent as any }),
      validateStatus: () => true, // 不抛出错误
    })

    return {
      isAccessible: response.status >= 200 && response.status < 400,
      statusCode: response.status,
    }
  } catch (error: any) {
    return {
      isAccessible: false,
      error: error.message,
    }
  }
}

/**
 * Requirement 4.1: 真实详情页数据获取
 * Structured product data extraction
 */
export interface ScrapedProductData {
  productName: string | null
  // Raw capture fields (source text for keyword supplementation/audit)
  rawProductTitle?: string | null
  rawAboutThisItem?: string[]
  productDescription: string | null
  productPrice: string | null
  productCategory: string | null
  productFeatures: string[]
  brandName: string | null
  imageUrls: string[]
  metaTitle: string | null
  metaDescription: string | null
  // 🔥 新增：独立站增强数据字段
  faqs?: Array<{ question: string; answer: string }>
  specifications?: Record<string, string>
  packages?: Array<{ name: string; price: string | null; includes: string[] }>
  socialProof?: Array<{ metric: string; value: string }>
  coreFeatures?: string[]      // 核心卖点
  secondaryFeatures?: string[] // 次要特性
  rating?: string | null
  reviewCount?: string | null
  reviewHighlights?: string[]
  topReviews?: string[]
  reviews?: Array<{            // 用户评论（Judge.me等评论系统）
    rating: number            // 评分 1-5
    date: string              // 日期
    author: string            // 评论者
    title: string             // 标题
    body: string              // 正文
    verifiedBuyer: boolean    // 是否验证购买
    images?: string[]         // 评论图片
  }>
}

/**
 * 🌍 检测是否为Amazon域名（支持全球16个站点）
 */
export function isAmazonDomain(url: string): boolean {
  const amazonDomains = [
    'amazon.com',     // 美国
    'amazon.co.uk',   // 英国
    'amazon.de',      // 德国
    'amazon.fr',      // 法国
    'amazon.it',      // 意大利
    'amazon.es',      // 西班牙
    'amazon.co.jp',   // 日本
    'amazon.ca',      // 加拿大
    'amazon.com.au',  // 澳大利亚
    'amazon.in',      // 印度
    'amazon.com.mx',  // 墨西哥
    'amazon.nl',      // 荷兰
    'amazon.pl',      // 波兰
    'amazon.se',      // 瑞典
    'amazon.sg',      // 新加坡
    'amazon.com.br',  // 巴西
    'amazon.ae',      // 阿联酋
    'amazon.sa',      // 沙特
    'amazon.com.tr',  // 土耳其
    'amazon.eg',      // 埃及
  ]
  return amazonDomains.some(domain => url.includes(domain))
}

function isPlausibleBrandCandidate(value: string | null): value is string {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.length > 60) return false
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length
  if (wordCount > 6) return false
  return true
}

function deriveBrandFromUrl(url: string): string | null {
  const label = getRegistrableDomainLabelFromUrl(url)
  if (!label) return null
  const normalized = label.replace(/[-_]+/g, ' ').trim()
  return normalized ? normalizeBrandName(normalized) : null
}

function extractLastFunnelSuccessUrlFromHtml(html: string): string | null {
  if (!html) return null
  const re = /successURL\s*=\s*['"]([^'"]+)['"]/gi
  let match: RegExpExecArray | null
  let last: string | null = null
  while ((match = re.exec(html))) {
    if (match[1]) last = match[1]
  }
  return last
}

function looksLike29NextFunnelHtml(html: string): boolean {
  if (!html) return false
  return (
    /\bcampaign\.getSuccessUrl\b/i.test(html) ||
    /\/js\/campaign\.js\b/i.test(html) ||
    /campaigns\.apps\.29next\.com\/api\/v1/i.test(html)
  )
}

function computeFunnelSuccessUrl(currentUrl: string, successUrl: string): string | null {
  try {
    const current = new URL(currentUrl)
    const pathParts = current.pathname.split('/')
    const campaignPath = pathParts.slice(0, Math.max(0, pathParts.length - 1)).join('/')
    const combinedPath = `${campaignPath}${successUrl}`
    return new URL(`${combinedPath}${current.search}`, current.origin).href
  } catch {
    return null
  }
}

function extractMinCurrencyPriceFromText(text: string): string | null {
  const cleaned = text.replace(/\s+/g, ' ').replace(/[\u00A0\u200B]/g, ' ').trim()
  if (!cleaned) return null

  const re = /([$€£])\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2}))/g
  let match: RegExpExecArray | null
  let best: { raw: string; value: number } | null = null

  while ((match = re.exec(cleaned))) {
    const symbol = match[1]
    const amountRaw = match[2]
    const value = Number(amountRaw.replace(/,/g, ''))
    if (!Number.isFinite(value) || value <= 0) continue
    const candidate = { raw: `${symbol}${amountRaw}`, value }
    if (!best || candidate.value < best.value) best = candidate
  }

  return best?.raw || null
}

function mergeTopImageUrls(base: string[], extras: string[], max: number = 5): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const url of [...base, ...extras]) {
    const normalized = url?.trim()
    if (!normalized) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    merged.push(normalized)
    if (merged.length >= max) break
  }
  return merged
}

async function enrichPresellFunnelData(options: {
  initialUrl: string
  initialHtml: string
  baseData: ScrapedProductData
  proxyAgent?: HttpsProxyAgent<string>
  acceptLanguage: string
  timeoutMs: number
}): Promise<ScrapedProductData> {
  const { initialUrl, initialHtml, baseData, proxyAgent, acceptLanguage, timeoutMs } = options

  let data = baseData
  let currentUrl = initialUrl
  let currentHtml = initialHtml
  const visited = new Set<string>([initialUrl])

  for (let hop = 0; hop < 3; hop++) {
    const rawSuccessUrl = extractLastFunnelSuccessUrlFromHtml(currentHtml)
    if (!rawSuccessUrl) break

    const nextUrl = computeFunnelSuccessUrl(currentUrl, rawSuccessUrl)
    if (!nextUrl) break
    if (visited.has(nextUrl)) break
    visited.add(nextUrl)

    let nextHtml: string
    try {
      const response = await axios.get(nextUrl, {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': acceptLanguage,
        },
        ...(proxyAgent && { httpsAgent: proxyAgent, httpAgent: proxyAgent as any }),
      })
      nextHtml = response.data
    } catch {
      break
    }

    currentUrl = nextUrl
    currentHtml = nextHtml

    const $next = load(nextHtml)

    if (!data.productName) {
      const nextProductName = extractLandingProductName($next, nextUrl)
      if (nextProductName) data = { ...data, productName: nextProductName }
    }

    if (!data.productPrice) {
      const nextPrice = extractMinCurrencyPriceFromText($next('body').text() || '')
      if (nextPrice) data = { ...data, productPrice: nextPrice }
    }

    if (!data.imageUrls?.length || data.imageUrls.length < 2) {
      const nextImages = extractLandingImages($next, nextUrl, 5)
      if (nextImages.length > 0) data = { ...data, imageUrls: mergeTopImageUrls(data.imageUrls || [], nextImages, 5) }
    }

    if (data.productPrice && data.imageUrls?.length >= 2) break
  }

  return data
}

/**
 * Extract structured product data from a landing page
 * Supports Amazon, Shopify, and generic e-commerce sites
 * @param url - 产品页面URL
 * @param customProxyUrl - 自定义代理URL
 * @param targetCountry - 目标国家（用于动态Accept-Language配置）
 * @param timeoutMs - 超时时间（毫秒）
 * @param userId - 用户ID（用于代理IP缓存隔离）
 */
export async function scrapeProductData(
  url: string,
  customProxyUrl?: string,
  targetCountry?: string,
  timeoutMs: number = 30000,
  userId?: number
): Promise<ScrapedProductData> {
  try {
    const proxyAgent = await getProxyAgent(customProxyUrl, userId)

    // 🌍 根据目标国家动态生成Accept-Language
    let acceptLanguage = 'en-US,en;q=0.5'  // 默认英语
    if (targetCountry) {
      const langCode = getLanguageCodeForCountry(targetCountry)
      acceptLanguage = getAcceptLanguageHeader(langCode)
    }

    const response = await axios.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': acceptLanguage,  // 🌍 动态语言支持
      },
      ...(proxyAgent && { httpsAgent: proxyAgent, httpAgent: proxyAgent as any }),
    })

    const html = response.data
    const $ = load(html)

    // 🌍 Detect site type - 支持全球Amazon站点
    const isAmazon = isAmazonDomain(url)
    const isShopify = $('[data-shopify]').length > 0

    // Extract data based on site type
    if (isAmazon) {
      return extractAmazonData($, url)
    } else if (isShopify) {
      return extractShopifyData($, url)
    } else {
      const baseData = extractGenericData($, url)

      // 🔥 presell/int/checkout漏斗页：价格/图片往往只出现在下一跳（int2/checkout）
      const shouldEnrich = isPresellStyleUrl(url) &&
        (!baseData.productPrice || (baseData.imageUrls?.length || 0) === 0) &&
        !!extractLastFunnelSuccessUrlFromHtml(html) &&
        looksLike29NextFunnelHtml(html)

      if (shouldEnrich) {
        return await enrichPresellFunnelData({
          initialUrl: url,
          initialHtml: html,
          baseData,
          proxyAgent,
          acceptLanguage,
          timeoutMs,
        })
      }

      return baseData
    }
  } catch (error: any) {
    console.error('Product scraping error:', error)
    throw new Error(`Product scraping failed: ${error.message}`)
  }
}

/**
 * Extract product data from Amazon pages
 */
function extractAmazonData($: any, url: string): ScrapedProductData {
  // 🔍 调试：检查页面状态
  const pageTitle = $('title').text().trim()
  const isBlocked = pageTitle.includes('Robot Check') || pageTitle.includes('Sorry!')
  console.log(`🔍 [extractAmazonData] 页面标题: "${pageTitle.slice(0, 60)}"`)
  console.log(`🔍 [extractAmazonData] 是否被拦截: ${isBlocked}`)

  if (isBlocked) {
    console.warn('⚠️ [extractAmazonData] 页面被Amazon拦截，无法提取数据')
    return {
      productName: null,
      productDescription: null,
      productPrice: null,
      productCategory: null,
      productFeatures: [],
      brandName: null,
      imageUrls: [],
      metaTitle: pageTitle,
      metaDescription: null,
    }
  }

  const features: string[] = []
  $('#feature-bullets li').each((i: number, el: any) => {
    const text = $(el).text().trim()
    if (text && text.length > 10) {
      features.push(text)
    }
  })

  // 🔥 P1优化：增强图片提取逻辑，优先获取高质量主图
  const images: string[] = []

  // 1. 尝试获取主图（高分辨率）
  const mainImage = $('#landingImage').attr('src') ||
                    $('#imgTagWrapperId img').attr('src') ||
                    $('meta[property="og:image"]').attr('content') ||
                    null

  if (mainImage && !mainImage.includes('data:image')) {
    // 移除尺寸限制以获取原始高分辨率图片
    const highResImage = mainImage.replace(/\._.*_\./, '.')
    images.push(highResImage)
  }

  // 2. 获取备用图片（缩略图）
  $('#altImages img').each((i: number, el: any) => {
    const src = $(el).attr('src')
    if (src && !src.includes('data:image') && !images.includes(src)) {
      // 同样移除尺寸限制
      const highResSrc = src.replace(/\._.*_\./, '.')
      if (!images.includes(highResSrc)) {
        images.push(highResSrc)
      }
    }
  })

  // 3. 如果仍然没有图片，尝试其他选择器
  if (images.length === 0) {
    const fallbackImage = $('.imgTagWrapper img').attr('src') ||
                          $('[data-old-hires]').attr('data-old-hires') ||
                          null
    if (fallbackImage && !fallbackImage.includes('data:image')) {
      images.push(fallbackImage.replace(/\._.*_\./, '.'))
    }
  }

  // 🔥 P1优化：增强价格提取逻辑，支持更多Amazon价格选择器
  let productPrice: string | null = null

  // 尝试多种价格选择器（按优先级排序）
  productPrice = $('.a-price .a-offscreen').first().text().trim() || // 最常见的价格位置
                 $('#priceblock_ourprice').text().trim() ||           // 传统价格位置
                 $('#priceblock_dealprice').text().trim() ||          // Deal价格
                 $('.a-price-whole').first().text().trim() ||         // 整数部分
                 $('#price_inside_buybox').text().trim() ||           // Buy box价格
                 $('[data-a-color="price"]').text().trim() ||         // 数据属性价格
                 $('.priceToPay .a-offscreen').text().trim() ||       // 支付价格
                 null

  // 🔥 增强品牌提取逻辑 - 支持Amazon Store页面和所有主要市场语言
  let bylineInfo = $('#bylineInfo').text().trim()
  const dataBrand = $('[data-brand]').attr('data-brand')
  const poBrand = $('.po-brand .a-size-base').text().trim()

  console.log(`🔍 [extractAmazonData] #bylineInfo: "${bylineInfo}"`)
  console.log(`🔍 [extractAmazonData] [data-brand]: "${dataBrand || '(空)'}"`)
  console.log(`🔍 [extractAmazonData] .po-brand: "${poBrand}"`)

  // 🌍 多语言品牌店铺文本清理 - 支持所有Amazon主要市场

  // English (US, CA, AU, GB, IN, SG): "Visit the Brand Store"
  bylineInfo = bylineInfo.replace(/^Visit\s+the\s+/i, '').replace(/\s+Store$/i, '')

  // Italian (IT): "Visita lo Store di Brand", "Visita il/la/le/i/gli Brand"
  bylineInfo = bylineInfo.replace(/^Visita\s+(lo|il|la|le|i|gli)\s+/i, '')
  bylineInfo = bylineInfo.replace(/^(Store|Negozio)\s+(di\s+)?/i, '')

  // French (FR, BE, CA-FR): "Visitez la boutique de Brand", "Visitez la Boutique de Brand"
  bylineInfo = bylineInfo.replace(/^Visitez\s+(la|le|les)\s+/i, '')
  bylineInfo = bylineInfo.replace(/^Boutique\s+(de\s+)?/i, '')

  // German (DE, AT, CH): "Besuchen Sie den Brand-Shop"
  bylineInfo = bylineInfo
    .replace(/^Besuchen\s+Sie\s+(den|die|das)\s+/i, '')
    .replace(/-(Shop|Store)$/i, '')
    .replace(/\s+(Shop|Store)$/i, '')

  // Spanish (ES, MX, AR, CL, CO, PE): "Visita la tienda de Brand", "Visita la Tienda de Brand"
  bylineInfo = bylineInfo.replace(/^Visita\s+(la|el)\s+/i, '')
  bylineInfo = bylineInfo.replace(/^Tienda\s+(de\s+)?/i, '')

  // Portuguese (BR, PT): "Visite a loja da Brand", "Visite a Loja da Brand"
  bylineInfo = bylineInfo.replace(/^Visite\s+a\s+/i, '')
  bylineInfo = bylineInfo.replace(/^Loja\s+(da\s+)?/i, '')

  // Japanese (JP): "ブランド 出品者のストアにアクセス"
  bylineInfo = bylineInfo.replace(/\s*出品者のストアにアクセス$/i, '')
  bylineInfo = bylineInfo.replace(/のストアを表示$/i, '') // Alternative: "Show Brand's store"

  // Dutch (NL, BE-NL): "Bezoek de Brand-winkel"
  bylineInfo = bylineInfo.replace(/^Bezoek\s+de\s+/i, '').replace(/-winkel$/i, '')

  // Polish (PL): "Odwiedź sklep Brand", "Odwiedź Sklep Brand"
  bylineInfo = bylineInfo.replace(/^Odwiedź\s+/i, '')
  bylineInfo = bylineInfo.replace(/^Sklep\s+/i, '')

  // Turkish (TR): "Brand Mağazasını ziyaret edin"
  bylineInfo = bylineInfo.replace(/\s+Mağazasını\s+ziyaret\s+edin$/i, '')

  // Swedish (SE): "Besök Brand-butiken"
  bylineInfo = bylineInfo.replace(/^Besök\s+/i, '').replace(/-butiken$/i, '')

  // Arabic (AE, SA, EG): RTL text patterns
  bylineInfo = bylineInfo.replace(/زيارة\s+متجر\s+/i, '') // "Visit Brand store"
  bylineInfo = bylineInfo.replace(/\s+متجر$/i, '') // "Brand store"

  // Chinese (CN): "访问 Brand 店铺"
  bylineInfo = bylineInfo.replace(/^访问\s+/i, '').replace(/\s+店铺$/i, '')
  bylineInfo = bylineInfo.replace(/^查看\s+/i, '').replace(/\s+品牌店$/i, '')

  // Korean (KR): "Brand 스토어 방문하기"
  bylineInfo = bylineInfo.replace(/\s+스토어\s+방문하기$/i, '')

  // Hindi (IN): "Brand स्टोर पर जाएं"
  bylineInfo = bylineInfo.replace(/\s+स्टोर\s+पर\s+जाएं$/i, '')

  // General cleanup for "Brand:" labels in multiple languages
  bylineInfo = bylineInfo.replace(/^Brand:\s*/i, '')
    .replace(/^品牌:\s*/i, '')      // Chinese
    .replace(/^Marca:\s*/i, '')      // Spanish/Italian/Portuguese
    .replace(/^Marque:\s*/i, '')     // French
    .replace(/^Marke:\s*/i, '')      // German
    .replace(/^Merk:\s*/i, '')       // Dutch
    .replace(/^Marka:\s*/i, '')      // Polish/Turkish
    .replace(/^Märke:\s*/i, '')      // Swedish
    .replace(/^ブランド:\s*/i, '')   // Japanese
    .replace(/^브랜드:\s*/i, '')      // Korean
    .replace(/^العلامة التجارية:\s*/i, '') // Arabic

  let brandName = bylineInfo ||
                  dataBrand ||
                  poBrand.replace(/^Brand/, '') || // 备用选择器
                  null

  // Guard: avoid persisting locale boilerplate as a brand (e.g. "Besuchen").
  if (isLikelyInvalidBrandName(brandName)) {
    brandName = null
  }

  // 如果是Amazon stores URL且没有从页面提取到品牌，从URL中提取（支持全球站点）
  if (!brandName && isAmazonDomain(url) && url.includes('/stores/')) {
    const urlMatch = url.match(/\/stores\/([^\/]+)\//)
    if (urlMatch && urlMatch[1]) {
      brandName = decodeURIComponent(urlMatch[1])
      console.log(`✅ [Amazon Store] 从URL提取品牌: ${brandName}`)
    }
  }

  // 🔥 后备方案：从商品标题提取品牌名
  // Amazon商品标题通常以品牌名开头，格式如: "REOLINK 12MP PoE Security Camera..."
  const productTitle = $('#productTitle').text().trim()
  if (!brandName && productTitle) {
    const derived = deriveBrandFromProductTitle(productTitle)
    if (derived) {
      brandName = derived
      console.log(`✅ [Amazon] 从商品标题提取品牌: ${brandName}`)
    }
  }

  return {
    productName: productTitle || null,
    rawProductTitle: productTitle || null,
    rawAboutThisItem: features.slice(0, 10),
    productDescription: $('#feature-bullets').text().trim() || $('#productDescription').text().trim() || null,
    productPrice,
    productCategory: $('#wayfinding-breadcrumbs_feature_div').text().trim() || null,
    productFeatures: features,
    brandName,
    imageUrls: images,
    metaTitle: $('title').text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content') || null,
  }
}

/**
 * Extract product data from Shopify stores
 * 🔥 增强版：支持FAQ、技术规格、包装选项、社会证明等独立站特有数据
 */
function extractShopifyData($: any, url: string): ScrapedProductData {
  // ==================== 1. Features 提取（增强版：区分核心/次要特性）====================
  const coreFeatures: string[] = []
  const secondaryFeatures: string[] = []

  // 核心特性：通常在产品主区域、key features、highlights等
  $('h3:contains("Key Features") + ul li, h3:contains("Features") + ul li, [class*="key-feature"] li, [class*="highlight"] li, [class*="feature"] li:has(strong)').each((i: number, el: any) => {
    const text = $(el).text().trim()
    if (text && text.length > 10 && text.length < 300) {
      coreFeatures.push(text)
    }
  })

  // 次要特性：其他列表项
  $('[class*="feature"] li, [class*="spec"] li, ul li').each((i: number, el: any) => {
    const text = $(el).text().trim()
    if (text && text.length > 10 && text.length < 300 && !coreFeatures.includes(text)) {
      secondaryFeatures.push(text)
    }
  })

  // ==================== 2. FAQ 提取 ====================
  const faqs: Array<{ question: string; answer: string }> = []

  // 常见FAQ结构：accordion、collapsible、details/summary
  $('[class*="faq"] [class*="item"], [class*="accordion"] [class*="item"], details').each((i: number, el: any) => {
    let question = ''
    let answer = ''

    // 尝试多种选择器组合
    question = $(el).find('h4, h3, summary, [class*="question"], [class*="title"]').first().text().trim()
    answer = $(el).find('[class*="answer"], [class*="content"], p').map((j: number, p: any) => $(p).text().trim()).get().join('\n').trim()

    // 如果是 details/summary 结构
    if (!answer && $(el).is('details')) {
      answer = $(el).find('> :not(summary)').text().trim()
    }

    if (question && answer && question.length > 5 && answer.length > 10) {
      faqs.push({ question, answer })
    }
  })

  console.log(`🔍 [Shopify FAQ] 提取到 ${faqs.length} 个FAQ`)

  // ==================== 3. 技术规格提取 ====================
  const specifications: Record<string, string> = {}

  // 查找规格表格
  $('table[class*="spec"], table[class*="technical"], [class*="spec"] table').each((i: number, table: any) => {
    $(table).find('tr').each((j: number, row: any) => {
      const cells = $(row).find('td, th')
      if (cells.length >= 2) {
        const key = $(cells[0]).text().trim()
        const value = $(cells[1]).text().trim()
        if (key && value && key.length < 100 && value.length < 200) {
          specifications[key] = value
        }
      }
    })
  })

  // 查找规格列表（dl/dt/dd结构）
  $('dl[class*="spec"], [class*="spec"] dl').each((i: number, dl: any) => {
    $(dl).find('dt').each((j: number, dt: any) => {
      const key = $(dt).text().trim()
      const value = $(dt).next('dd').text().trim()
      if (key && value && key.length < 100 && value.length < 200) {
        specifications[key] = value
      }
    })
  })

  console.log(`🔍 [Shopify Spec] 提取到 ${Object.keys(specifications).length} 个技术参数`)

  // ==================== 4. 包装选项提取 ====================
  const packages: Array<{ name: string; price: string | null; includes: string[] }> = []

  $('[class*="package"] [class*="option"], [class*="variant"] [class*="option"], [class*="tier"]').each((i: number, el: any) => {
    const name = $(el).find('h3, h4, [class*="name"], [class*="title"]').first().text().trim()
    const priceText = $(el).find('[class*="price"]').first().text().trim()
    const includes: string[] = []

    $(el).find('li, [class*="include"]').each((j: number, item: any) => {
      const text = $(item).text().trim()
      if (text && text.length > 3 && text.length < 200) {
        includes.push(text)
      }
    })

    if (name && (priceText || includes.length > 0)) {
      packages.push({
        name,
        price: priceText || null,
        includes
      })
    }
  })

  console.log(`🔍 [Shopify Package] 提取到 ${packages.length} 个套餐选项`)

  // ==================== 5. 社会证明数据提取 ====================
  const socialProof: Array<{ metric: string; value: string }> = []

  // 查找统计数字（如：18,000+ Installations, 60% Decrease）
  $('[class*="stat"], [class*="metric"], [class*="proof"], h3:contains("+"), h3:contains("%")').each((i: number, el: any) => {
    const text = $(el).text().trim()
    // 匹配数字模式（如：18,000+、60%、100+）
    const numberMatch = text.match(/(\d{1,3}(?:,\d{3})*|\d+)([+%])?/)
    if (numberMatch) {
      const value = numberMatch[0]
      const metric = text.replace(value, '').trim()
      if (metric && metric.length > 2 && metric.length < 100) {
        socialProof.push({ value, metric })
      }
    }
  })

  console.log(`🔍 [Shopify Social] 提取到 ${socialProof.length} 个社会证明数据`)

  // ==================== 6. 图片提取（保持原有逻辑：5张）====================
  const images: string[] = []
  const ogImage = $('meta[property="og:image"]').attr('content')
  if (ogImage) images.push(ogImage)

  $('[class*="product"] img, [class*="gallery"] img').each((i: number, el: any) => {
    const src = $(el).attr('src')
    if (src && !src.includes('data:image') && !images.includes(src)) {
      images.push(src)
    }
  })

  console.log(`🔍 [Shopify Images] 提取到 ${images.length} 张图片`)

  // ==================== 7. 品牌提取（保持原有逻辑）====================
  const ogSiteName = $('meta[property="og:site_name"]').attr('content')?.trim() || null
  const vendorText = $('.product-vendor').first().text().trim() || null
  const itemPropBrand = $('[itemprop="brand"]').first().text().trim() || null

  let brandName =
    (isPlausibleBrandCandidate(ogSiteName) ? ogSiteName : null) ||
    (isPlausibleBrandCandidate(vendorText) ? vendorText : null) ||
    (isPlausibleBrandCandidate(itemPropBrand) ? itemPropBrand : null) ||
    null

  if (!brandName) {
    const pageTitle = $('title').text().trim()
    console.log(`🔍 [Shopify] 尝试从页面标题提取品牌: ${pageTitle}`)
    if (pageTitle) {
      const titleParts = pageTitle.split(/[\|\-]/)
      if (titleParts.length > 0) {
        const firstPart = titleParts[0].trim()
        brandName = firstPart.replace(/\s+(Store|Shop|Official|Site|Online|Outdoor Life)$/i, '').trim()
        console.log(`✅ [Shopify] 提取的品牌: ${brandName}`)
      }
    }
  }

  if (!isPlausibleBrandCandidate(brandName)) {
    brandName = (isPlausibleBrandCandidate(ogSiteName) ? ogSiteName : null) || deriveBrandFromUrl(url)
  }

  // ==================== 8. 评论数据提取（Judge.me系统）====================
  const reviews: Array<{
    rating: number
    date: string
    author: string
    title: string
    body: string
    verifiedBuyer: boolean
    images?: string[]
  }> = []

  // Judge.me评论系统选择器（适用于mydaysoutdoor.com等Shopify店铺）
  $('.jdgm-rev').each((i: number, el: any) => {
    const $review = $(el)

    // 提取评分（data-score属性）
    const ratingText = $review.find('.jdgm-rev__rating').attr('data-score')
    const rating = ratingText ? parseInt(ratingText, 10) : 0

    // 提取日期（data-content属性，格式：2024-01-26 00:00:00 UTC）
    const dateText = $review.find('.jdgm-rev__timestamp').attr('data-content')
    const date = dateText ? dateText.split(' ')[0] : '' // 取 YYYY-MM-DD 部分

    // 提取评论者姓名
    const author = $review.find('.jdgm-rev__author').text().trim()

    // 提取评论标题
    const title = $review.find('.jdgm-rev__title').text().trim()

    // 提取评论正文
    const body = $review.find('.jdgm-rev__body p').text().trim()

    // 提取是否为验证购买者（data-verified-buyer属性）
    const verifiedBuyerAttr = $review.attr('data-verified-buyer')
    const verifiedBuyer = verifiedBuyerAttr === 'true'

    // 提取评论图片（可选）
    const images: string[] = []
    $review.find('.jdgm-rev__pics img').each((j: number, img: any) => {
      const src = $(img).attr('src')
      if (src && !src.includes('data:image')) {
        images.push(src)
      }
    })

    // 只保存有效的评论（至少有评分和评论者）
    if (rating > 0 && author && (title || body)) {
      reviews.push({
        rating,
        date,
        author,
        title,
        body,
        verifiedBuyer,
        images: images.length > 0 ? images : undefined
      })
    }
  })

  console.log(`🔍 [Shopify Reviews] 提取到 ${reviews.length} 条评论`)

  // ==================== 9. 商品描述提取（增强版：优先从About区域提取）====================
  let productDescription: string | null = null

  // 尝试1：从 "About [Product Name]" 标题后的列表中提取
  const aboutHeadings = $('h1, h2, h3').filter((i: number, el: any) => {
    const text = $(el).text().trim()
    return text.startsWith('About ') || text.includes('About Heated') || text.includes('About Oversized')
  })

  if (aboutHeadings.length > 0) {
    const descriptionItems: string[] = []
    aboutHeadings.first().nextAll('ul, ol').first().find('li').each((i: number, el: any) => {
      const text = $(el).text().trim()
      if (text && text.length > 20) {
        descriptionItems.push(text)
      }
    })

    if (descriptionItems.length > 0) {
      productDescription = descriptionItems.join('\n\n')
      console.log(`🔍 [Shopify Desc] 从About区域提取到 ${descriptionItems.length} 条描述`)
    }
  }

  // 尝试2：从传统选择器提取（排除订阅邮件文字）
  if (!productDescription) {
    const descText = $('.product-description').text().trim() || $('[class*="product"][class*="description"]').text().trim()
    if (descText && !descText.includes('Get the latest updates') && !descText.includes('SUBSCRIBE')) {
      productDescription = descText
    }
  }

  // 尝试3：从meta description提取（最后的备选方案）
  if (!productDescription) {
    productDescription = $('meta[name="description"]').attr('content') || null
  }

  // ==================== 10. 返回增强的数据结构 ====================
  return {
    productName: $('.product-title').text().trim() || $('h1').first().text().trim() || null,
    rawProductTitle: $('.product-title').text().trim() || $('h1').first().text().trim() || null,
    rawAboutThisItem: [...coreFeatures, ...secondaryFeatures].slice(0, 20),
    productDescription,
    productPrice: $('.product-price').first().text().trim() || $('[class*="price"]').first().text().trim() || null,
    productCategory: $('.breadcrumbs').text().trim() || null,
    productFeatures: [...coreFeatures, ...secondaryFeatures].slice(0, 20), // 保持向后兼容
    brandName: brandName ? normalizeBrandName(brandName) : null,
    imageUrls: images.slice(0, 5), // 保持原有的5张限制
    metaTitle: $('title').text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content') || null,
    // 🔥 新增字段
    faqs: faqs.length > 0 ? faqs : undefined,
    specifications: Object.keys(specifications).length > 0 ? specifications : undefined,
    packages: packages.length > 0 ? packages : undefined,
    socialProof: socialProof.length > 0 ? socialProof : undefined,
    coreFeatures: coreFeatures.length > 0 ? coreFeatures : undefined,
    secondaryFeatures: secondaryFeatures.length > 0 ? secondaryFeatures : undefined,
    reviews: reviews.length > 0 ? reviews : undefined,
  }
}

/**
 * Extract product data from generic e-commerce sites
 */
function extractGenericData($: any, url: string): ScrapedProductData {
  const features: string[] = []
  $('ul li').each((i: number, el: any) => {
    const text = $(el).text().trim()
    if (text && text.length > 10 && text.length < 200) {
      features.push(text)
    }
  })

  const images: string[] = []
  const landingImages = extractLandingImages($, url, 5)
  images.push(...landingImages)

  // 🔥 增强品牌提取逻辑
  const ogBrand = $('meta[property="og:brand"]').attr('content')?.trim() || null
  const ogSiteName = $('meta[property="og:site_name"]').attr('content')?.trim() || null
  const itemPropBrand = $('[itemprop="brand"]').first().text().trim() || null
  const brandText = $('[class*="brand"]').first().text().trim() || null

  let brandName =
    (isPlausibleBrandCandidate(ogBrand) ? ogBrand : null) ||
    (isPlausibleBrandCandidate(ogSiteName) ? ogSiteName : null) ||
    (isPlausibleBrandCandidate(itemPropBrand) ? itemPropBrand : null) ||
    (isPlausibleBrandCandidate(brandText) ? brandText : null) ||
    null

  // 优先从Amazon stores URL中提取品牌名（支持全球站点）
  if (!brandName && isAmazonDomain(url) && url.includes('/stores/')) {
    const urlMatch = url.match(/\/stores\/([^\/]+)\//)
    if (urlMatch && urlMatch[1]) {
      brandName = decodeURIComponent(urlMatch[1])
      console.log(`✅ 从Amazon stores URL提取品牌: ${brandName}`)
    }
  }

  // 如果仍然没有品牌，尝试从页面标题提取
  if (!brandName) {
    const pageTitle = $('title').text().trim()
    console.log(`🔍 尝试从页面标题提取品牌: ${pageTitle}`)
    if (pageTitle) {
      // 从标题中提取第一个单词或品牌名（通常在 | 或 - 之前）
      const titleParts = pageTitle.split(/[\|\-]/)
      console.log(`📝 标题分割结果:`, titleParts)
      if (titleParts.length > 0) {
        const firstPart = titleParts[0].trim()
        console.log(`📝 第一部分: ${firstPart}`)
        // 移除常见的后缀词和末尾数字
        brandName = firstPart.replace(/\s+(Store|Shop|Official|Site|Online)$/i, '').replace(/\d+$/, '').trim()
        console.log(`✅ 提取的品牌: ${brandName}`)
      }
    }
  } else if (!url.includes('amazon.com/stores/')) {
    console.log(`✅ 从meta标签提取品牌: ${brandName}`)
  }

  if (!isPlausibleBrandCandidate(brandName)) {
    brandName =
      (isPlausibleBrandCandidate(ogBrand) ? ogBrand : null) ||
      (isPlausibleBrandCandidate(ogSiteName) ? ogSiteName : null) ||
      deriveBrandFromUrl(url)
  }

  const baseProductName =
    $('h1').text().trim() ||
    $('[class*="product"][class*="title"]').text().trim() ||
    null

  const productName = isPresellStyleUrl(url)
    ? (extractLandingProductName($, url) || baseProductName)
    : baseProductName

  // 🔥 2026-01-14：补齐“pre/presell advertorial”类型落地页的品牌识别
  // 这类页面的<title>/og:title经常是发布方/频道名（例如 “Smart Home & Garden”），不是商品品牌
  brandName = refineBrandNameForLandingPage({
    url,
    $,
    productName,
    currentBrandName: brandName,
  })

  const productDescriptionRaw =
    $('[class*="description"]').text().trim() ||
    $('meta[name="description"]').attr('content') ||
    null

  const landingDescription = extractLandingDescription({ $, productName })
  const productDescription =
    landingDescription ||
    productDescriptionRaw ||
    null

  const productPrice =
    $('[class*="price"]').text().trim() ||
    $('[data-price]').attr('data-price') ||
    extractLandingPrice($, url) ||
    null

  return {
    productName,
    rawProductTitle: productName,
    rawAboutThisItem: features.slice(0, 10),
    productDescription,
    productPrice,
    productCategory: $('.breadcrumb').text().trim() || $('[class*="breadcrumb"]').text().trim() || null,
    productFeatures: features.slice(0, 10),
    brandName: brandName ? normalizeBrandName(brandName) : null,
    imageUrls: images.slice(0, 5),
    metaTitle: $('title').text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content') || null,
  }
}

/**
 * Extract product info (simplified interface for legacy compatibility)
 * This function wraps scrapeProductData and returns a simplified format
 * @param url - 产品页面URL
 * @param targetCountry - 目标国家（用于动态语言配置）
 * @param customProxyUrl - 自定义代理URL
 * @param timeoutMs - 超时时间（毫秒）
 * @param userId - 用户ID（用于代理IP缓存隔离）
 * 🔥 2026-01-04修复：直接返回ScrapedProductData，保留完整的reviews、faqs等数据
 */
export async function extractProductInfo(
  url: string,
  targetCountry?: string,
  customProxyUrl?: string,
  timeoutMs?: number,
  userId?: number
): Promise<ScrapedProductData> {
  try {
    // 🌍 传入targetCountry到scrapeProductData
    const productData = await scrapeProductData(url, customProxyUrl, targetCountry, timeoutMs, userId)

    // 🔥 直接返回完整的ScrapedProductData，不丢失任何字段
    return productData
  } catch (error) {
    console.error('extractProductInfo error:', error)
    throw error
  }
}
