import { parsePrice } from '@/lib/pricing-utils'

export const COUNTRY_CURRENCY_MAP: Readonly<Record<string, string>> = {
  US: 'USD',
  CA: 'CAD',
  GB: 'GBP',
  UK: 'GBP',
  AU: 'AUD',
  NZ: 'NZD',
  SG: 'SGD',
  JP: 'JPY',
  KR: 'KRW',
  IN: 'INR',
  CN: 'CNY',
  HK: 'HKD',
  TW: 'TWD',
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  IE: 'EUR',
  AT: 'EUR',
  FI: 'EUR',
  PT: 'EUR',
  LU: 'EUR',
  GR: 'EUR',
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  RO: 'RON',
  BR: 'BRL',
  MX: 'MXN',
  TH: 'THB',
  VN: 'VND',
  ID: 'IDR',
  PH: 'PHP',
  MY: 'MYR',
  RU: 'RUB',
  TR: 'TRY',
  SA: 'SAR',
  AE: 'AED',
  IL: 'ILS',
  ZA: 'ZAR',
}

export const CURRENCY_SYMBOL_MAP: Readonly<Record<string, string>> = {
  USD: '$',
  CAD: 'C$',
  GBP: '£',
  AUD: 'A$',
  NZD: 'NZ$',
  SGD: 'S$',
  JPY: '¥',
  CNY: '¥',
  KRW: '₩',
  INR: '₹',
  EUR: '€',
  HKD: 'HK$',
  TWD: 'NT$',
  CHF: 'CHF',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  PLN: 'zł',
  CZK: 'Kč',
  HUF: 'Ft',
  RON: 'lei',
  BRL: 'R$',
  MXN: 'MX$',
  THB: '฿',
  VND: '₫',
  IDR: 'Rp',
  PHP: '₱',
  MYR: 'RM',
  RUB: '₽',
  TRY: '₺',
  SAR: 'ر.س',
  AED: 'د.إ',
  ILS: '₪',
  ZAR: 'R',
}

const CURRENCY_CODES = Object.keys(CURRENCY_SYMBOL_MAP).sort((a, b) => b.length - a.length)

const SYMBOL_TO_CODE_ENTRIES: Array<[string, string]> = [
  ['HK$', 'HKD'],
  ['NT$', 'TWD'],
  ['NZ$', 'NZD'],
  ['MX$', 'MXN'],
  ['C$', 'CAD'],
  ['A$', 'AUD'],
  ['S$', 'SGD'],
  ['R$', 'BRL'],
  ['CHF', 'CHF'],
  ['RM', 'MYR'],
  ['Rp', 'IDR'],
  ['zł', 'PLN'],
  ['Kč', 'CZK'],
  ['Ft', 'HUF'],
  ['lei', 'RON'],
  ['₱', 'PHP'],
  ['₫', 'VND'],
  ['₩', 'KRW'],
  ['₽', 'RUB'],
  ['₺', 'TRY'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['₹', 'INR'],
  ['¥', 'JPY'],
  ['$', 'USD'],
  ['฿', 'THB'],
  ['₪', 'ILS'],
]

function normalizeCountryCode(country?: string | null): string {
  const normalized = String(country || '').trim().toUpperCase()
  return normalized || 'US'
}

function normalizeCurrencyCode(code?: string | null): string {
  const normalized = String(code || '').trim().toUpperCase()
  return normalized || 'USD'
}

function formatCompactNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100
  if (Number.isInteger(rounded)) {
    return String(rounded)
  }
  return rounded.toFixed(2).replace(/\.?0+$/, '')
}

function parseNumberish(value: string): number | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const withoutCurrency = raw
    .replace(/[A-Za-z¥€£$₹₩฿₫₱₽₺₪]/g, '')
    .replace(/[HKNTMXCASNZRMRp]/gi, '')
    .replace(/\s+/g, '')

  if (!withoutCurrency) return null

  const lastComma = withoutCurrency.lastIndexOf(',')
  const lastDot = withoutCurrency.lastIndexOf('.')

  let normalized = withoutCurrency
  if (lastComma > lastDot) {
    normalized = withoutCurrency.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > lastComma) {
    normalized = withoutCurrency.replace(/,/g, '')
  } else if (lastComma !== -1) {
    const decimals = withoutCurrency.length - lastComma - 1
    if (decimals >= 1 && decimals <= 2) {
      normalized = withoutCurrency.slice(0, lastComma).replace(/,/g, '') + '.' + withoutCurrency.slice(lastComma + 1)
    } else {
      normalized = withoutCurrency.replace(/,/g, '')
    }
  }

  normalized = normalized.replace(/[^0-9.]/g, '')
  if (!normalized) return null

  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

function resolveSymbolCurrencyCode(symbol: string, targetCountry?: string | null): string {
  if (symbol === '$') {
    const byCountry = getCurrencyCodeByCountry(targetCountry)
    if (['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'TWD'].includes(byCountry)) {
      return byCountry
    }
    return 'USD'
  }

  if (symbol === '¥') {
    const byCountry = getCurrencyCodeByCountry(targetCountry)
    if (byCountry === 'CNY') return 'CNY'
    return 'JPY'
  }

  const found = SYMBOL_TO_CODE_ENTRIES.find(([candidate]) => candidate.toLowerCase() === symbol.toLowerCase())
  return found ? found[1] : 'USD'
}

function detectCurrencyCodeFromText(value: string, targetCountry?: string | null): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const upper = raw.toUpperCase()
  for (const code of CURRENCY_CODES) {
    const pattern = new RegExp(`\\b${code}\\b`)
    if (pattern.test(upper)) {
      return code
    }
  }

  for (const [symbol] of SYMBOL_TO_CODE_ENTRIES) {
    if (raw.includes(symbol)) {
      return resolveSymbolCurrencyCode(symbol, targetCountry)
    }
  }

  return null
}

function hasExplicitCurrencyMarker(value: string): boolean {
  const raw = String(value || '').trim()
  if (!raw) return false
  return detectCurrencyCodeFromText(raw) !== null
}

function normalizeSpacing(value: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

export function getCurrencyCodeByCountry(country?: string | null): string {
  const code = normalizeCountryCode(country)
  return COUNTRY_CURRENCY_MAP[code] || 'USD'
}

export function getCurrencySymbolByCode(currencyCode?: string | null): string {
  const code = normalizeCurrencyCode(currencyCode)
  return CURRENCY_SYMBOL_MAP[code] || '$'
}

export function getCurrencySymbolByCountry(country?: string | null): string {
  const code = getCurrencyCodeByCountry(country)
  return getCurrencySymbolByCode(code)
}

export type ParsedMoneyValue = {
  amount: number
  currency: string
  explicitCurrency: boolean
}

export function parseMoneyValue(
  value: string | null | undefined,
  options?: {
    targetCountry?: string | null
    defaultCurrency?: string | null
  }
): ParsedMoneyValue | null {
  const raw = normalizeSpacing(String(value || ''))
  if (!raw) return null

  const amount = parseNumberish(raw)
  if (amount === null) return null

  const explicitCurrencyCode = detectCurrencyCodeFromText(raw, options?.targetCountry)
  const fallbackCurrency = normalizeCurrencyCode(options?.defaultCurrency || getCurrencyCodeByCountry(options?.targetCountry))

  return {
    amount,
    currency: explicitCurrencyCode || fallbackCurrency,
    explicitCurrency: Boolean(explicitCurrencyCode),
  }
}

export function normalizeOfferProductPriceInput(
  value: string | null | undefined,
  targetCountry?: string | null
): string | undefined {
  const raw = normalizeSpacing(String(value || ''))
  if (!raw) return undefined

  if (hasExplicitCurrencyMarker(raw)) {
    return raw
  }

  const parsedAmount = parseNumberish(raw)
  if (parsedAmount === null) {
    return raw
  }

  return `${getCurrencySymbolByCountry(targetCountry)}${formatCompactNumber(parsedAmount)}`
}

export function normalizeOfferCommissionPayoutInput(
  value: string | null | undefined,
  targetCountry?: string | null,
  options?: {
    numericMode?: 'amount' | 'percent'
  }
): string | undefined {
  const raw = normalizeSpacing(String(value || ''))
  if (!raw) return undefined

  if (raw.includes('%')) {
    const parsedAmount = parseNumberish(raw)
    return parsedAmount === null ? raw : `${formatCompactNumber(parsedAmount)}%`
  }

  if (hasExplicitCurrencyMarker(raw)) {
    return raw
  }

  const parsedAmount = parseNumberish(raw)
  if (parsedAmount === null) {
    return raw
  }

  if (options?.numericMode === 'amount') {
    return `${getCurrencySymbolByCountry(targetCountry)}${formatCompactNumber(parsedAmount)}`
  }

  // 裸数字在 percent 模式下仅接受 0~1 比例值（如 0.225 => 22.5%）。
  // >1 的裸数字语义不明确（可能是百分比也可能是金额），保留原值交给上层严格校验。
  if (parsedAmount <= 1) {
    return `${formatCompactNumber(parsedAmount * 100)}%`
  }

  return raw
}

export type CommissionType = 'percent' | 'amount'

export type NormalizeOfferCommissionInputParams = {
  targetCountry?: string | null
  commissionType?: string | null
  commissionValue?: string | number | null
  commissionCurrency?: string | null
  commissionPayout?: string | null
}

export type NormalizedOfferCommission = {
  commissionType: CommissionType | null
  commissionValue: string | null
  commissionCurrency: string | null
  commissionPayout: string | null
}

function normalizeStructuredCommissionType(value: unknown): CommissionType | null {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'percent' || normalized === 'amount') {
    return normalized
  }
  return null
}

function parseStructuredCommission(
  input: NormalizeOfferCommissionInputParams
): NormalizedOfferCommission | null {
  const commissionType = normalizeStructuredCommissionType(input.commissionType)
  const hasCommissionTypeField = input.commissionType !== undefined && input.commissionType !== null && String(input.commissionType).trim() !== ''
  const hasCommissionValueField = input.commissionValue !== undefined && input.commissionValue !== null && String(input.commissionValue).trim() !== ''
  const hasCommissionCurrencyField = input.commissionCurrency !== undefined && input.commissionCurrency !== null && String(input.commissionCurrency).trim() !== ''

  if (!hasCommissionTypeField && !hasCommissionValueField && !hasCommissionCurrencyField) {
    return null
  }

  if (!hasCommissionTypeField || !hasCommissionValueField) {
    throw new Error('commission_type 与 commission_value 必须同时提供')
  }

  if (!commissionType) {
    throw new Error('commission_type 仅支持 percent 或 amount')
  }

  const targetCountry = input.targetCountry
  const valueRaw = normalizeSpacing(String(input.commissionValue || ''))

  if (!valueRaw) {
    throw new Error('commission_value 不能为空')
  }

  if (commissionType === 'percent') {
    if (hasCommissionCurrencyField) {
      throw new Error('commission_type=percent 时不应提供 commission_currency')
    }
    if (hasExplicitCurrencyMarker(valueRaw)) {
      throw new Error('commission_type=percent 时，commission_value 不应包含货币单位')
    }

    const normalizedPayout = normalizeOfferCommissionPayoutInput(valueRaw, targetCountry, {
      numericMode: 'percent',
    })
    const percentValue = parseNumberish(String(normalizedPayout || ''))
    if (percentValue === null || percentValue <= 0) {
      throw new Error('commission_value 百分比格式非法')
    }

    return {
      commissionType: 'percent',
      commissionValue: formatCompactNumber(percentValue),
      commissionCurrency: null,
      commissionPayout: `${formatCompactNumber(percentValue)}%`,
    }
  }

  if (valueRaw.includes('%')) {
    throw new Error('commission_type=amount 时，commission_value 不应包含 %')
  }

  const currencyFromInput = hasCommissionCurrencyField
    ? normalizeCurrencyCode(String(input.commissionCurrency))
    : null

  if (currencyFromInput && !CURRENCY_SYMBOL_MAP[currencyFromInput]) {
    throw new Error('commission_currency 必须是受支持的货币代码（如 USD / EUR / GBP）')
  }

  const parsedMoney = parseMoneyValue(valueRaw, {
    targetCountry,
    defaultCurrency: currencyFromInput || getCurrencyCodeByCountry(targetCountry),
  })

  if (!parsedMoney || parsedMoney.amount <= 0) {
    throw new Error('commission_value 金额格式非法')
  }

  if (currencyFromInput && parsedMoney.explicitCurrency && parsedMoney.currency !== currencyFromInput) {
    throw new Error('commission_value 与 commission_currency 货币不一致')
  }

  const normalizedCurrency = currencyFromInput || parsedMoney.currency
  const normalizedAmount = formatCompactNumber(parsedMoney.amount)

  return {
    commissionType: 'amount',
    commissionValue: normalizedAmount,
    commissionCurrency: normalizedCurrency,
    commissionPayout: `${getCurrencySymbolByCode(normalizedCurrency)}${normalizedAmount}`,
  }
}

function parseLegacyCommission(
  commissionPayout: string | null | undefined,
  targetCountry?: string | null
): NormalizedOfferCommission | null {
  const raw = normalizeSpacing(String(commissionPayout || ''))
  if (!raw) return null

  if (hasExplicitCurrencyMarker(raw)) {
    const parsedMoney = parseMoneyValue(raw, {
      targetCountry,
      defaultCurrency: getCurrencyCodeByCountry(targetCountry),
    })
    if (!parsedMoney || parsedMoney.amount <= 0) {
      throw new Error('commission_payout 金额格式非法')
    }
    const normalizedAmount = formatCompactNumber(parsedMoney.amount)
    return {
      commissionType: 'amount',
      commissionValue: normalizedAmount,
      commissionCurrency: parsedMoney.currency,
      commissionPayout: `${getCurrencySymbolByCode(parsedMoney.currency)}${normalizedAmount}`,
    }
  }

  const parsedPercentRaw = parseNumberish(raw)
  if (parsedPercentRaw === null || parsedPercentRaw <= 0) {
    throw new Error('commission_payout 百分比格式非法')
  }

  if (!raw.includes('%')) {
    if (parsedPercentRaw <= 1) {
      const ratioDisplayRate = parsedPercentRaw * 100
      return {
        commissionType: 'percent',
        commissionValue: formatCompactNumber(ratioDisplayRate),
        commissionCurrency: null,
        commissionPayout: `${formatCompactNumber(ratioDisplayRate)}%`,
      }
    }

    const parsedMoney = parseMoneyValue(raw, {
      targetCountry,
      defaultCurrency: getCurrencyCodeByCountry(targetCountry),
    })
    if (!parsedMoney || parsedMoney.amount <= 0) {
      throw new Error('commission_payout 金额格式非法')
    }

    const normalizedAmount = formatCompactNumber(parsedMoney.amount)
    return {
      commissionType: 'amount',
      commissionValue: normalizedAmount,
      commissionCurrency: parsedMoney.currency,
      commissionPayout: `${getCurrencySymbolByCode(parsedMoney.currency)}${normalizedAmount}`,
    }
  }

  const normalizedPercent = normalizeOfferCommissionPayoutInput(raw, targetCountry, {
    numericMode: 'percent',
  })
  const percentValue = parseNumberish(String(normalizedPercent || ''))
  if (percentValue === null || percentValue <= 0) {
    throw new Error('commission_payout 百分比格式非法')
  }

  return {
    commissionType: 'percent',
    commissionValue: formatCompactNumber(percentValue),
    commissionCurrency: null,
    commissionPayout: `${formatCompactNumber(percentValue)}%`,
  }
}

function areCommissionSemanticallyEqual(
  structured: NormalizedOfferCommission,
  legacy: NormalizedOfferCommission
): boolean {
  if (structured.commissionType !== legacy.commissionType) {
    return false
  }

  const structuredValue = parseNumberish(String(structured.commissionValue || ''))
  const legacyValue = parseNumberish(String(legacy.commissionValue || ''))
  if (structuredValue === null || legacyValue === null) {
    return false
  }

  if (structured.commissionType === 'percent') {
    return Math.abs(structuredValue - legacyValue) <= 0.05
  }

  return structured.commissionCurrency === legacy.commissionCurrency
    && Math.abs(structuredValue - legacyValue) <= 0.01
}

export function normalizeOfferCommissionInput(
  params: NormalizeOfferCommissionInputParams
): NormalizedOfferCommission {
  const structured = parseStructuredCommission(params)
  const legacy = parseLegacyCommission(params.commissionPayout, params.targetCountry)

  if (!structured && !legacy) {
    return {
      commissionType: null,
      commissionValue: null,
      commissionCurrency: null,
      commissionPayout: null,
    }
  }

  if (structured && legacy && !areCommissionSemanticallyEqual(structured, legacy)) {
    throw new Error('commission_type/commission_value 与 commission_payout 语义冲突')
  }

  return structured || legacy || {
    commissionType: null,
    commissionValue: null,
    commissionCurrency: null,
    commissionPayout: null,
  }
}

export type ParsedCommissionPayout =
  | {
    mode: 'percent'
    rate: number
    displayRate: number
  }
  | {
    mode: 'amount'
    amount: number
    currency: string
    explicitCurrency: boolean
  }

export function parseCommissionPayoutValue(
  value: string | null | undefined,
  options?: {
    targetCountry?: string | null
    fallbackCurrency?: string | null
  }
): ParsedCommissionPayout | null {
  const raw = normalizeSpacing(String(value || ''))
  if (!raw) return null

  if (raw.includes('%')) {
    const parsedAmount = parseNumberish(raw)
    if (parsedAmount === null || parsedAmount <= 0) return null
    return {
      mode: 'percent',
      rate: parsedAmount / 100,
      displayRate: parsedAmount,
    }
  }

  if (hasExplicitCurrencyMarker(raw)) {
    const parsedMoney = parseMoneyValue(raw, {
      targetCountry: options?.targetCountry,
      defaultCurrency: options?.fallbackCurrency,
    })
    if (!parsedMoney || parsedMoney.amount <= 0) return null

    return {
      mode: 'amount',
      amount: parsedMoney.amount,
      currency: parsedMoney.currency,
      explicitCurrency: parsedMoney.explicitCurrency,
    }
  }

  const parsedNumeric = parseNumberish(raw)
  if (parsedNumeric === null || parsedNumeric <= 0) return null
  if (parsedNumeric > 1) {
    const fallbackCurrency = normalizeCurrencyCode(
      options?.fallbackCurrency || getCurrencyCodeByCountry(options?.targetCountry)
    )
    return {
      mode: 'amount',
      amount: parsedNumeric,
      currency: fallbackCurrency,
      explicitCurrency: false,
    }
  }

  return {
    mode: 'percent',
    rate: parsedNumeric,
    displayRate: parsedNumeric * 100,
  }
}

export function getCommissionPerConversion(
  params: {
    productPrice: string | null | undefined
    commissionPayout: string | null | undefined
    targetCountry?: string | null
  }
): { amount: number; currency: string; mode: 'percent' | 'amount'; rate?: number } | null {
  const product = parseMoneyValue(params.productPrice, {
    targetCountry: params.targetCountry,
  })

  const commission = parseCommissionPayoutValue(params.commissionPayout, {
    targetCountry: params.targetCountry,
    fallbackCurrency: product?.currency,
  })

  if (!commission) return null

  if (commission.mode === 'amount') {
    return {
      amount: commission.amount,
      currency: commission.currency,
      mode: 'amount',
    }
  }

  if (!product || product.amount <= 0) return null

  return {
    amount: product.amount * commission.rate,
    currency: product.currency,
    mode: 'percent',
    rate: commission.rate,
  }
}

export function parseProductPriceMoney(
  productPrice: string | null | undefined,
  options?: { targetCountry?: string | null; fallbackCurrency?: string | null }
): { amount: number; currency: string } | null {
  const text = String(productPrice || '').trim()
  if (!text) return null

  const parsed = parseMoneyValue(text, {
    targetCountry: options?.targetCountry,
    defaultCurrency: options?.fallbackCurrency,
  })
  if (!parsed) return null

  const strictAmount = parsePrice(text)
  const amount = strictAmount !== null && strictAmount >= 0 ? strictAmount : parsed.amount
  if (amount <= 0) return null

  return {
    amount,
    currency: parsed.currency,
  }
}
