/**
 * 价格解析和处理工具函数
 * 用于将product_price字符串解析为结构化的pricing JSON
 */

export interface ParsedPrice {
  original: string
  current: string
  currency: string
  discount?: {
    type: 'percentage' | 'fixed'
    value: number
    label: string
  }
}

/**
 * 货币符号到货币代码的映射
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  'A$': 'AUD',
  'C$': 'CAD',
  'CHF': 'CHF',
  'kr': 'SEK',
  'R$': 'BRL',
}

/**
 * 标准化小数分隔符：将逗号小数点转换为点小数点
 * 处理欧洲价格格式 (€319,00 → €319.00)
 *
 * 逻辑:
 * 1. 如果价格只有一个逗号且逗号后只有2位数字（如 "€319,00"），则是欧洲格式小数点
 * 2. 如果有多个逗号或千位分隔符（如 "€1,234,567.89"），则去除逗号
 * 3. 最后保留纯数字和小数点
 *
 * @param priceStr - 价格字符串
 * @returns 标准化后的数字字符串（只含数字和点）
 */
function normalizeDecimalSeparator(priceStr: string): string {
  // 移除货币符号和空格
  let cleaned = priceStr.replace(/[€$£¥₹A-Z]/g, '').trim()

  // 🔧 修复: 检测欧洲格式（逗号作为小数点）
  // 模式: 数字,数字数字（最多2位小数）并且后面没有更多数字
  const europeanFormat = /^[\d\s.]*(\d),(\d{1,2})$/
  const match = cleaned.match(europeanFormat)

  if (match) {
    // 欧洲格式: 将逗号替换为点（小数分隔符）
    // 同时移除千位分隔符（点或空格）
    cleaned = cleaned.replace(/[\s.]/g, '').replace(',', '.')
    console.log(`🔧 检测到欧洲价格格式，标准化: "${priceStr}" → "${cleaned}"`)
  } else {
    // 美式格式: 移除千位逗号分隔符，保留点作为小数点
    cleaned = cleaned.replace(/,/g, '')
  }

  // 最终清理: 只保留数字和点
  return cleaned.replace(/[^0-9.]/g, '')
}

/**
 * 解析产品价格字符串
 * 支持格式:
 * - "$99.99"
 * - "€79.99"
 * - "$99.99 (20% OFF)"
 * - "$119.99 → $99.99" (折扣价格)
 * - "¥599"
 *
 * @param productPrice - 价格字符串
 * @returns 解析后的价格对象，如果无法解析则返回null
 */
export function parseProductPrice(productPrice: string | null | undefined): ParsedPrice | null {
  if (!productPrice || !productPrice.trim()) {
    return null
  }

  const trimmed = productPrice.trim()

  // 提取货币符号
  const currencyMatch = trimmed.match(/^([A-Z]{3}|[A-Z]\$|[$€£¥₹])/)
  const currencySymbol = currencyMatch ? currencyMatch[1] : '$'
  const currency = CURRENCY_SYMBOLS[currencySymbol] || 'USD'

  // 情况1: 检查是否有折扣箭头 "原价 → 现价" 或 "原价 - 现价"
  const arrowMatch = trimmed.match(/([^\s→-]+)\s*[→-]\s*([^\s(]+)/)
  if (arrowMatch) {
    const originalPrice = arrowMatch[1].trim()
    const currentPrice = arrowMatch[2].trim()

    // 提取数值用于计算折扣
    // 🔧 修复: 先处理欧洲格式的逗号小数点，再移除其他非数字字符
    const originalValue = parseFloat(normalizeDecimalSeparator(originalPrice))
    const currentValue = parseFloat(normalizeDecimalSeparator(currentPrice))

    if (!isNaN(originalValue) && !isNaN(currentValue) && originalValue > currentValue) {
      const discountPercent = Math.round(((originalValue - currentValue) / originalValue) * 100)

      return {
        original: originalPrice,
        current: currentPrice,
        currency,
        discount: {
          type: 'percentage',
          value: discountPercent,
          label: discountPercent + '% OFF',
        },
      }
    }
  }

  // 情况2: 检查是否有括号中的折扣信息 "$99.99 (20% OFF)"
  const discountMatch = trimmed.match(/([^\s(]+)\s*\(([^)]+)\)/)
  if (discountMatch) {
    const currentPrice = discountMatch[1].trim()
    const discountLabel = discountMatch[2].trim()

    // 提取折扣百分比
    const percentMatch = discountLabel.match(/(\d+)%/)
    if (percentMatch) {
      const discountPercent = parseInt(percentMatch[1], 10)
      // 🔧 修复: 使用normalizeDecimalSeparator处理欧洲格式
      const currentValue = parseFloat(normalizeDecimalSeparator(currentPrice))

      if (!isNaN(currentValue) && !isNaN(discountPercent)) {
        // 反推原价
        const originalValue = currentValue / (1 - discountPercent / 100)
        const originalPrice = currencySymbol + originalValue.toFixed(2)

        return {
          original: originalPrice,
          current: currentPrice,
          currency,
          discount: {
            type: 'percentage',
            value: discountPercent,
            label: discountLabel,
          },
        }
      }
    }
  }

  // 情况3: 仅有单一价格 "$99.99"
  return {
    original: trimmed,
    current: trimmed,
    currency,
  }
}

/**
 * 生成pricing JSON字符串
 * @param productPrice - 价格字符串
 * @returns JSON字符串，如果无法解析则返回null
 */
export function generatePricingJSON(productPrice: string | null | undefined): string | null {
  const parsed = parseProductPrice(productPrice)
  if (!parsed) {
    return null
  }

  return JSON.stringify(parsed, null, 2)
}

/**
 * 🔧 通用价格解析函数 - 智能检测欧洲/美国价格格式
 *
 * 支持格式:
 * - 欧洲格式: "319,00 €", "1.299,99€", "245,08 €"
 * - 美国格式: "$319.00", "$1,299.99", "245.08"
 * - 混合格式: "€319", "$319", "319"
 *
 * 检测逻辑:
 * - 如果逗号在最后（且后面只有1-2位数字），则是欧洲格式（逗号=小数点）
 * - 如果点在最后（且后面只有1-2位数字），则是美国格式（点=小数点）
 * - 其他情况按千位分隔符处理
 *
 * @param priceText - 价格文本（可能包含货币符号）
 * @returns 解析后的数值，如果无法解析则返回null
 */
export function parsePrice(priceText: string | null | undefined): number | null {
  if (!priceText) return null

  // 移除货币符号和空格
  const cleaned = priceText.replace(/[€$£¥₹\s]/g, '').trim()
  if (!cleaned) return null

  const lastCommaIndex = cleaned.lastIndexOf(',')
  const lastDotIndex = cleaned.lastIndexOf('.')

  let normalized: string

  if (lastCommaIndex > lastDotIndex) {
    // 欧洲格式: 逗号在后面是小数点 "1.299,99" → "1299.99"
    // 先移除点（千位分隔符），再将逗号转为点（小数点）
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (lastDotIndex > lastCommaIndex) {
    // 美国格式: 点在后面是小数点 "1,299.99" → "1299.99"
    // 移除逗号（千位分隔符）
    normalized = cleaned.replace(/,/g, '')
  } else if (lastCommaIndex !== -1 && lastDotIndex === -1) {
    // 只有逗号，没有点: 判断是欧洲小数点还是千位分隔符
    const afterComma = cleaned.split(',')[1]
    if (afterComma && afterComma.length <= 2) {
      // 逗号后只有1-2位数字，是欧洲格式小数点 "319,00" → "319.00"
      normalized = cleaned.replace(',', '.')
    } else {
      // 逗号后超过2位数字，是千位分隔符 "1,000,000" → "1000000"
      normalized = cleaned.replace(/,/g, '')
    }
  } else {
    // 没有逗号也没有点，或其他情况
    normalized = cleaned
  }

  const price = parseFloat(normalized)
  return isNaN(price) ? null : price
}

/**
 * 初始化空的promotions JSON结构
 */
export function initializePromotionsJSON(): string {
  return JSON.stringify({
    active: [],
  })
}

/**
 * 初始化空的scraped_data JSON结构
 * @param productPrice - 可选的价格字符串，用于填充price字段
 */
export function initializeScrapedDataJSON(productPrice?: string | null): string {
  const parsed = productPrice ? parseProductPrice(productPrice) : null

  return JSON.stringify({
    price: parsed ? {
      original: parsed.original,
      current: parsed.current,
      discount: parsed.discount?.label || null,
    } : null,
    reviews: null,
    salesRank: null,
    badge: null,
    availability: null,
    shipping: null,
  })
}
