/**
 * 将 query/body 中的布尔开关解析为严格的 true/false。
 * 避免 Boolean("false") === true 的陷阱。
 */
export function parseTruthyFlag(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  }
  return false
}
