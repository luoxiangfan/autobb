/**
 * 货币汇率转换工具
 *
 * 注意：
 * 1. 汇率数据为静态配置，建议定期更新
 * 2. 生产环境建议使用实时汇率API（如exchangerate-api.com）
 */

/**
 * 汇率表（基准货币：USD）
 * 更新时间：2026-03-03 00:02:32 UTC
 * 来源：open.er-api.com (ExchangeRate-API)
 */
import { parseCommissionPayoutValue, parseProductPriceMoney } from '@/lib/offer-monetization'

export const EXCHANGE_RATES: Record<string, number> = {
  USD: 1,        // 美元（基准）
  CNY: 6.90304,      // 人民币
  EUR: 0.854186,     // 欧元
  GBP: 0.746164,     // 英镑
  JPY: 157.245455,   // 日元
  KRW: 1459.333782,  // 韩元
  AUD: 1.411431,     // 澳元
  CAD: 1.366999,     // 加元
  HKD: 7.822186,     // 港币
  TWD: 31.581761,    // 新台币
  SGD: 1.27295,      // 新加坡元
  INR: 91.632632,    // 印度卢比
  BRL: 5.179572,     // 巴西雷亚尔
  MXN: 17.322493,    // 墨西哥比索
  THB: 31.437897,    // 泰铢
  VND: 26100.93299,  // 越南盾
  IDR: 16871.400742, // 印尼盾
  PHP: 58.226732,    // 菲律宾比索
  MYR: 3.925096,     // 马来西亚林吉特
  RUB: 77.421005,    // 俄罗斯卢布
}

/**
 * 货币符号映射
 */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  CNY: '¥',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  KRW: '₩',
  AUD: 'A$',
  CAD: 'C$',
  HKD: 'HK$',
  TWD: 'NT$',
  SGD: 'S$',
  INR: '₹',
  BRL: 'R$',
  MXN: 'MX$',
  THB: '฿',
  VND: '₫',
  IDR: 'Rp',
  PHP: '₱',
  MYR: 'RM',
  RUB: '₽',
}

/**
 * 货币名称映射
 */
export const CURRENCY_NAMES: Record<string, string> = {
  USD: '美元',
  CNY: '人民币',
  EUR: '欧元',
  GBP: '英镑',
  JPY: '日元',
  KRW: '韩元',
  AUD: '澳元',
  CAD: '加元',
  HKD: '港币',
  TWD: '新台币',
  SGD: '新加坡元',
  INR: '印度卢比',
  BRL: '巴西雷亚尔',
  MXN: '墨西哥比索',
  THB: '泰铢',
  VND: '越南盾',
  IDR: '印尼盾',
  PHP: '菲律宾比索',
  MYR: '马来西亚林吉特',
  RUB: '俄罗斯卢布',
}

/**
 * 货币转换
 * @param amount 金额
 * @param fromCurrency 源货币代码（例如：USD）
 * @param toCurrency 目标货币代码（例如：CNY）
 * @returns 转换后的金额
 */
export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): number {
  const fromRate = EXCHANGE_RATES[fromCurrency]
  const toRate = EXCHANGE_RATES[toCurrency]

  if (!fromRate || !toRate) {
    throw new Error(`不支持的货币类型: ${fromCurrency} 或 ${toCurrency}`)
  }

  // 转换公式：先转换为USD，再转换为目标货币
  const amountInUSD = amount / fromRate
  const convertedAmount = amountInUSD * toRate

  return convertedAmount
}

/**
 * 格式化货币金额
 * @param amount 金额
 * @param currency 货币代码
 * @param decimals 小数位数（默认2位）
 * @returns 格式化后的货币字符串（例如：¥6.68）
 */
export function formatCurrency(
  amount: number,
  currency: string,
  decimals: number = 2
): string {
  const symbol = CURRENCY_SYMBOLS[currency] || currency
  const formattedAmount = amount.toFixed(decimals)

  // 特殊处理：日元和韩元通常不显示小数
  if (currency === 'JPY' || currency === 'KRW') {
    return `${symbol}${Math.round(amount).toLocaleString()}`
  }

  return `${symbol}${Number(formattedAmount).toLocaleString()}`
}

/**
 * 解析价格字符串
 * @param priceString 价格字符串（例如：$699.00 或 699.00）
 * @returns 数字金额
 */
export function parsePrice(priceString: string): number | null {
  if (!priceString) return null

  // 移除货币符号和空格，只保留数字和小数点
  const cleaned = priceString.replace(/[^0-9.]/g, '')
  const parsed = parseFloat(cleaned)

  return isNaN(parsed) ? null : parsed
}

/**
 * 解析佣金比例字符串
 * @param commissionString 佣金字符串（例如：6.75% 或 6.75）
 * @returns 小数形式的佣金比例（例如：0.0675）
 */
export function parseCommission(commissionString: string): number | null {
  if (!commissionString) return null

  // 移除百分号和空格
  const cleaned = commissionString.replace(/[^0-9.]/g, '')
  const parsed = parseFloat(cleaned)

  if (isNaN(parsed)) return null

  // 转换为小数形式（例如：6.75 → 0.0675）
  return parsed / 100
}

/**
 * 计算建议最大CPC
 * @param productPrice 产品价格（例如：$699.00）
 * @param commission 佣金比例（例如：6.75%）
 * @param productCurrency 产品价格货币（默认USD）
 * @param targetCurrency 目标货币（默认USD）
 * @param clicksPerSale 出一单所需点击数（默认50）
 * @returns 建议最大CPC金额
 */
export function calculateMaxCPC(
  productPrice: string,
  commission: string,
  productCurrency: string = 'USD',
  targetCurrency: string = 'USD',
  clicksPerSale: number = 50,
  targetCountry?: string
): {
  maxCPC: number
  maxCPCFormatted: string
  calculationDetails: {
    productPrice: number
    productCurrency: string | null
    commissionMode: 'percent' | 'amount'
    commissionRate: number | null
    commissionAmount: number
    sourceCurrency: string
    clicksPerSale: number
    targetCurrency: string
  }
} | null {
  const parsedProduct = parseProductPriceMoney(productPrice, {
    targetCountry,
    fallbackCurrency: targetCountry ? undefined : productCurrency,
  })

  const parsedCommission = parseCommissionPayoutValue(commission, {
    targetCountry,
    fallbackCurrency: parsedProduct?.currency || (targetCountry ? undefined : productCurrency),
  })
  if (!parsedCommission) return null

  let commissionAmount = 0
  let sourceCurrency = parsedProduct?.currency || productCurrency
  let commissionRate: number | null = null

  if (parsedCommission.mode === 'percent') {
    if (!parsedProduct || parsedProduct.amount <= 0) return null
    commissionAmount = parsedProduct.amount * parsedCommission.rate
    sourceCurrency = parsedProduct.currency
    commissionRate = parsedCommission.displayRate
  } else {
    commissionAmount = parsedCommission.amount
    sourceCurrency = parsedCommission.currency

    if (parsedProduct && parsedProduct.amount > 0) {
      commissionRate = (parsedCommission.amount / parsedProduct.amount) * 100
    }
  }

  if (!(commissionAmount > 0)) return null

  // 计算最大CPC（佣金原币）
  const maxCPCInSourceCurrency = commissionAmount / clicksPerSale

  // 货币转换
  const maxCPCInTargetCurrency = convertCurrency(
    maxCPCInSourceCurrency,
    sourceCurrency,
    targetCurrency
  )

  // 🔧 修复(2025-12-26): 四舍五入到计费单位（0.01货币单位）
  const roundedMaxCPC = Math.round(maxCPCInTargetCurrency * 100) / 100

  // 格式化
  const maxCPCFormatted = formatCurrency(roundedMaxCPC, targetCurrency)

  return {
    maxCPC: roundedMaxCPC,
    maxCPCFormatted,
    calculationDetails: {
      productPrice: parsedProduct?.amount || 0,
      productCurrency: parsedProduct?.currency || null,
      commissionMode: parsedCommission.mode,
      commissionRate,
      commissionAmount,
      sourceCurrency,
      clicksPerSale,
      targetCurrency,
    },
  }
}

/**
 * 从Google Ads账号获取货币代码
 * 如果无法获取，返回默认货币（USD）
 */
export function getAdsCurrency(): string {
  // TODO: 从Google Ads账号配置中读取货币
  // 目前返回默认值
  return 'CNY' // 中国广告主大多使用人民币
}
