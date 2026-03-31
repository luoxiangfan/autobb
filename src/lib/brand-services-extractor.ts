/**
 * 品牌真实服务提取器
 * 从品牌官网提取真实的服务、承诺和特性
 * 用于验证AI生成的Callout和Sitelink的真实性
 */

import { scrapeUrl } from './scraper'
import { getLanguageCodeForCountry } from './language-country-codes'

export interface BrandServices {
  shipping: string[] // 配送相关服务
  returns: string[] // 退换货政策
  support: string[] // 客服支持
  quality: string[] // 质量保证
  payment: string[] // 支付方式
  other: string[] // 其他服务
}

/**
 * 提取品牌真实服务（KISS原则 - 基于关键词匹配）
 */
export async function extractBrandServices(
  websiteUrl: string,
  targetCountry?: string,
  customProxyUrl?: string
): Promise<BrandServices> {
  try {
    // 抓取官网内容
    const language = targetCountry ? getLanguageCodeForCountry(targetCountry) : undefined
    const pageData = await scrapeUrl(websiteUrl, customProxyUrl, language)
    const text = pageData.text.toLowerCase()

    const services: BrandServices = {
      shipping: [],
      returns: [],
      support: [],
      quality: [],
      payment: [],
      other: []
    }

    // 配送服务检测
    const shippingPatterns = [
      { pattern: /free\s+(shipping|delivery)/i, service: 'Free Shipping' },
      { pattern: /免费(配送|送货|运输)/i, service: 'Free Shipping' },
      { pattern: /fast\s+shipping/i, service: 'Fast Shipping' },
      { pattern: /快速(配送|发货)/i, service: 'Fast Shipping' },
      { pattern: /worldwide\s+shipping/i, service: 'Worldwide Shipping' },
      { pattern: /全球(配送|发货)/i, service: 'Worldwide Shipping' },
      { pattern: /2[-\s]day\s+shipping/i, service: '2-Day Shipping' },
      { pattern: /次日达|隔日达/i, service: 'Next Day Delivery' }
    ]

    shippingPatterns.forEach(({ pattern, service }) => {
      if (pattern.test(text)) {
        services.shipping.push(service)
      }
    })

    // 退换货政策检测
    const returnsPatterns = [
      { pattern: /(\d+)[-\s]day\s+returns?/i, service: '$1-Day Returns' },
      { pattern: /(\d+)天.*?(退货|退换)/i, service: '$1-Day Returns' },
      { pattern: /free\s+returns?/i, service: 'Free Returns' },
      { pattern: /免费退货/i, service: 'Free Returns' },
      { pattern: /easy\s+returns?/i, service: 'Easy Returns' },
      { pattern: /轻松退货/i, service: 'Easy Returns' },
      { pattern: /money[-\s]back\s+guarantee/i, service: 'Money-Back Guarantee' },
      { pattern: /退款保证/i, service: 'Money-Back Guarantee' }
    ]

    returnsPatterns.forEach(({ pattern, service }) => {
      const match = text.match(pattern)
      if (match) {
        const finalService = service.replace('$1', match[1] || '30')
        services.returns.push(finalService)
      }
    })

    // 客服支持检测
    const supportPatterns = [
      { pattern: /24\/7\s+(support|customer\s+service)/i, service: '24/7 Support' },
      { pattern: /24小时.*?(客服|支持)/i, service: '24/7 Support' },
      { pattern: /live\s+chat/i, service: 'Live Chat' },
      { pattern: /在线客服|即时聊天/i, service: 'Live Chat' },
      { pattern: /phone\s+support/i, service: 'Phone Support' },
      { pattern: /电话支持|客服热线/i, service: 'Phone Support' },
      { pattern: /email\s+support/i, service: 'Email Support' },
      { pattern: /邮件支持/i, service: 'Email Support' }
    ]

    supportPatterns.forEach(({ pattern, service }) => {
      if (pattern.test(text)) {
        services.support.push(service)
      }
    })

    // 质量保证检测
    const qualityPatterns = [
      { pattern: /(\d+)[-\s]year\s+warranty/i, service: '$1-Year Warranty' },
      { pattern: /(\d+)年.*?保修/i, service: '$1-Year Warranty' },
      { pattern: /lifetime\s+warranty/i, service: 'Lifetime Warranty' },
      { pattern: /终身保修/i, service: 'Lifetime Warranty' },
      { pattern: /premium\s+quality/i, service: 'Premium Quality' },
      { pattern: /高品质|优质/i, service: 'Premium Quality' },
      { pattern: /certified|认证/i, service: 'Certified Products' },
      { pattern: /authentic|正品保证/i, service: 'Authentic Products' }
    ]

    qualityPatterns.forEach(({ pattern, service }) => {
      const match = text.match(pattern)
      if (match) {
        const finalService = service.replace('$1', match[1] || '1')
        services.quality.push(finalService)
      }
    })

    // 支付方式检测
    const paymentPatterns = [
      { pattern: /secure\s+payment/i, service: 'Secure Payment' },
      { pattern: /安全支付/i, service: 'Secure Payment' },
      { pattern: /paypal|visa|mastercard/i, service: 'Multiple Payment Options' },
      { pattern: /支付宝|微信支付/i, service: 'Multiple Payment Options' },
      { pattern: /installment|分期付款/i, service: 'Installment Plans' }
    ]

    paymentPatterns.forEach(({ pattern, service }) => {
      if (pattern.test(text)) {
        if (!services.payment.includes(service)) {
          services.payment.push(service)
        }
      }
    })

    // 其他服务检测
    const otherPatterns = [
      { pattern: /price\s+match/i, service: 'Price Match Guarantee' },
      { pattern: /价格保证/i, service: 'Price Match Guarantee' },
      { pattern: /loyalty\s+program/i, service: 'Loyalty Program' },
      { pattern: /会员计划|积分/i, service: 'Loyalty Program' },
      { pattern: /gift\s+wrap/i, service: 'Gift Wrapping' },
      { pattern: /礼品包装/i, service: 'Gift Wrapping' }
    ]

    otherPatterns.forEach(({ pattern, service }) => {
      if (pattern.test(text)) {
        services.other.push(service)
      }
    })

    return services
  } catch (error) {
    console.error('提取品牌服务失败:', error)
    // 返回空服务列表
    return {
      shipping: [],
      returns: [],
      support: [],
      quality: [],
      payment: [],
      other: []
    }
  }
}

/**
 * 将品牌服务转换为AI可用的白名单
 */
export function servicesToWhitelist(services: BrandServices): string[] {
  const whitelist: string[] = []

  // 合并所有服务
  Object.values(services).forEach(serviceList => {
    whitelist.push(...serviceList)
  })

  // 去重
  return Array.from(new Set(whitelist))
}

/**
 * 验证Callout/Sitelink是否在白名单中
 */
export function validateAgainstWhitelist(
  items: string[],
  whitelist: string[]
): { valid: string[]; invalid: string[] } {
  const valid: string[] = []
  const invalid: string[] = []

  items.forEach(item => {
    // 简单的包含匹配（不区分大小写）
    const itemLower = item.toLowerCase()
    const isValid = whitelist.some(allowed =>
      itemLower.includes(allowed.toLowerCase()) ||
      allowed.toLowerCase().includes(itemLower)
    )

    if (isValid) {
      valid.push(item)
    } else {
      invalid.push(item)
    }
  })

  return { valid, invalid }
}

/**
 * 生成Callout建议（基于真实服务）
 */
export function generateCalloutSuggestions(services: BrandServices): string[] {
  const suggestions: string[] = []

  // 优先级：配送 > 退换货 > 客服 > 质量
  if (services.shipping.length > 0) {
    suggestions.push(services.shipping[0])
  }

  if (services.returns.length > 0) {
    suggestions.push(services.returns[0])
  }

  if (services.support.length > 0) {
    suggestions.push(services.support[0])
  }

  if (services.quality.length > 0) {
    suggestions.push(services.quality[0])
  }

  // 补充其他服务
  if (suggestions.length < 4) {
    services.payment.forEach(service => {
      if (suggestions.length < 4) {
        suggestions.push(service)
      }
    })
  }

  if (suggestions.length < 4) {
    services.other.forEach(service => {
      if (suggestions.length < 4) {
        suggestions.push(service)
      }
    })
  }

  return suggestions.slice(0, 4)
}

/**
 * 生成Sitelink建议（基于真实服务）
 */
export function generateSitelinkSuggestions(
  services: BrandServices,
  brand: string
): Array<{ title: string; description: string }> {
  const sitelinks: Array<{ title: string; description: string }> = []

  // 官方店铺链接
  sitelinks.push({
    title: 'Official Store',
    description: `Authorized ${brand} Products`
  })

  // 配送信息
  if (services.shipping.length > 0) {
    sitelinks.push({
      title: services.shipping[0],
      description: services.shipping[0].includes('Free')
        ? 'Free delivery on all orders'
        : 'Fast shipping available'
    })
  }

  // 客服支持
  if (services.support.length > 0) {
    sitelinks.push({
      title: 'Support Center',
      description: services.support[0] || 'Customer support available'
    })
  }

  // 质量保证
  if (services.quality.length > 0 || services.returns.length > 0) {
    const guarantee = services.returns[0] || services.quality[0]
    sitelinks.push({
      title: 'Warranty & Returns',
      description: guarantee
    })
  }

  return sitelinks.slice(0, 6)  // 🔧 修复(2025-12-24): 从4个改为6个
}
