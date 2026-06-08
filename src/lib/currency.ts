/**
 * 货币汇率转换工具
 *
 * 运行时使用数据库中的 USD 基准汇率（由 ExchangeRate-API 定时同步）；
 * 若库中无数据或未配置 API Key，则回退到下方静态表。
 */
import { parseCommissionPayoutValue, parseProductPriceMoney } from '@/lib/offer-monetization'
import { getEffectiveUsdRates } from '@/lib/exchange-rates-cache'

export const USD_BASE_CURRENCY = 'USD'

/**
 * 静态回退汇率（基准货币：USD），与 DB 中字段含义一致：每 1 USD 可兑换的外币数量
 * 更新时间：2026-03-03 00:02:32 UTC
 * 来源：open.er-api.com (ExchangeRate-API)
 */
export const EXCHANGE_RATES: Record<string, number> = {
  USD: 1, // 美元（基准）
  CNY: 6.90304, // 人民币
  EUR: 0.854186, // 欧元
  GBP: 0.746164, // 英镑
  JPY: 157.245455, // 日元
  KRW: 1459.333782, // 韩元
  AUD: 1.411431, // 澳元
  CAD: 1.366999, // 加元
  HKD: 7.822186, // 港币
  TWD: 31.581761, // 新台币
  SGD: 1.27295, // 新加坡元
  INR: 91.632632, // 印度卢比
  BRL: 5.179572, // 巴西雷亚尔
  MXN: 17.322493, // 墨西哥比索
  THB: 31.437897, // 泰铢
  VND: 26100.93299, // 越南盾
  IDR: 16871.400742, // 印尼盾
  PHP: 58.226732, // 菲律宾比索
  MYR: 3.925096, // 马来西亚林吉特
  RUB: 77.421005, // 俄罗斯卢布
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

export function normalizeCurrencyCode(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase()
}

/**
 * 货币转换
 * @param amount 金额
 * @param fromCurrency 源货币代码（例如：USD）
 * @param toCurrency 目标货币代码（例如：CNY）
 * @returns 转换后的金额
 */
export function convertCurrency(amount: number, fromCurrency: string, toCurrency: string): number {
  const rates = getEffectiveUsdRates(EXCHANGE_RATES)
  const from = String(fromCurrency || '')
    .trim()
    .toUpperCase()
  const to = String(toCurrency || '')
    .trim()
    .toUpperCase()
  const fromRate = rates[from]
  const toRate = rates[to]

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
export function formatCurrency(amount: number, currency: string, decimals: number = 2): string {
  const symbol = CURRENCY_SYMBOLS[currency] || currency
  const formattedAmount = amount.toFixed(decimals)

  // 特殊处理：日元和韩元通常不显示小数
  if (currency === 'JPY' || currency === 'KRW') {
    return `${symbol}${Math.round(amount).toLocaleString()}`
  }

  return `${symbol}${Number(formattedAmount).toLocaleString()}`
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
