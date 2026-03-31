import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Convert any value to a proper number type
 * Used at API level to ensure all numeric fields are properly typed before sending to frontend
 * @param value The value to convert (can be number, string, null, undefined, etc.)
 * @param defaultValue Default value if conversion fails (default: 0)
 * @returns Proper number type, or defaultValue if conversion fails
 */
export function toNumber(
  value: any,
  defaultValue: number = 0
): number {
  // Handle null and undefined
  if (value === null || value === undefined) {
    return defaultValue
  }

  // Convert to number
  const numValue = typeof value === 'string' ? parseFloat(value) : Number(value)

  // Check for NaN or infinite values
  if (!isFinite(numValue)) {
    return defaultValue
  }

  return numValue
}

/**
 * Safe toFixed utility that handles null, undefined, strings, and NaN values
 * @param value The value to format (can be number, string, null, or undefined)
 * @param decimals Number of decimal places (default: 2)
 * @returns Formatted string with specified decimal places, or "0" if value is invalid
 */
export function safeToFixed(
  value: string | number | null | undefined,
  decimals: number = 2
): string {
  const numValue = toNumber(value, 0)
  return numValue.toFixed(decimals)
}

/**
 * Format currency with proper symbol based on currency code
 * Supports multi-currency Google Ads accounts
 *
 * @param amount - The amount to format
 * @param currency - Currency code (USD, CNY, EUR, GBP, JPY, etc.)
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted currency string (e.g., "$123.45", "¥123.45", "€123.45")
 *
 * @example
 * formatCurrency(123.45, 'USD') // "$123.45"
 * formatCurrency(123.45, 'CNY') // "¥123.45"
 * formatCurrency(123.45, 'EUR') // "€123.45"
 * formatCurrency(123.45, 'MIXED') // "MIXED 123.45" (mixed currency scenario)
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  currency: string = 'USD',
  decimals: number = 2
): string {
  const numValue = toNumber(amount, 0)
  const formattedAmount = numValue.toFixed(decimals)

  // Currency symbol mapping
  const currencySymbols: Record<string, string> = {
    'USD': '$',
    'CNY': '¥',
    'EUR': '€',
    'GBP': '£',
    'JPY': '¥',
    'CAD': 'C$',
    'AUD': 'A$',
    'CHF': 'CHF',
    'INR': '₹',
    'KRW': '₩',
    'BRL': 'R$',
    'MXN': 'MX$',
    'SGD': 'S$',
    'HKD': 'HK$',
    'TWD': 'NT$',
    'THB': '฿',
    'VND': '₫',
  }

  // Special case: Mixed currencies
  if (currency === 'MIXED') {
    return `Mixed ${formattedAmount}`
  }

  // Get symbol or use currency code if not found
  const symbol = currencySymbols[currency.toUpperCase()] || currency

  return `${symbol}${formattedAmount}`
}

/**
 * Format multiple currency amounts (for mixed currency scenarios)
 * Used when dashboard shows data from accounts with different currencies
 *
 * @param amounts - Array of {currency, amount} objects
 * @returns Formatted string with all currencies
 *
 * @example
 * formatMultiCurrency([
 *   { currency: 'USD', amount: 430.79 },
 *   { currency: 'CNY', amount: 1200.50 }
 * ]) // "$430.79 + ¥1,200.50"
 */
export function formatMultiCurrency(
  amounts: Array<{ currency: string; amount: number }>,
  decimals: number = 2
): string {
  if (amounts.length === 0) {
    return formatCurrency(0, 'USD', decimals)
  }

  if (amounts.length === 1) {
    return formatCurrency(amounts[0].amount, amounts[0].currency, decimals)
  }

  // Multiple currencies - show all
  return amounts
    .map(({ currency, amount }) => formatCurrency(amount, currency, decimals))
    .join(' + ')
}
