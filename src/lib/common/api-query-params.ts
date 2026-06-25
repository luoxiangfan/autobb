import { parseTruthyFlag } from './parse-truthy-flag'

/**
 * 解析 URL query 中的布尔开关（refresh、noCache 等）。
 * null/空串为 false；支持 true/1/yes/on（大小写不敏感）。
 */
export function parseQueryBooleanParam(value: string | null): boolean {
  if (value === null) return false
  const normalized = value.trim().toLowerCase()
  if (!normalized) return false
  if (normalized === 'on') return true
  return parseTruthyFlag(normalized)
}

/**
 * 校验 query 中的 YYYY-MM-DD 日期；非法或不存在日历日期时返回 null。
 */
export function parseYmdQueryParam(value: string | null): string | null {
  if (!value) return null
  const normalized = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null

  const [year, month, day] = normalized.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return normalized
}

/**
 * 将 DB 时间戳或 ISO 字符串格式化为 YYYY-MM-DD；无法解析时返回 null。
 */
export function formatAsYmd(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value)
  if (!raw.trim()) return null

  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]

  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().slice(0, 10)
}

/** 从 searchParams 读取有限数字 filter；缺失或非法时返回 null。 */
export function parseNumericQueryParam(searchParams: URLSearchParams, key: string): number | null {
  const raw = (searchParams.get(key) || '').trim()
  if (!raw) return null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

/** 从 searchParams 读取 YYYY-MM-DD 日期 filter。 */
export function parseYmdSearchParam(searchParams: URLSearchParams, key: string): string | null {
  return parseYmdQueryParam(searchParams.get(key))
}

/**
 * 从 searchParams 读取国家代码 filter。
 * 空值、ALL 或非法格式时返回 `'all'`。
 */
export function parseCountryCodeQueryParam(searchParams: URLSearchParams, key: string): string {
  const raw = (searchParams.get(key) || '').trim().toUpperCase()
  if (!raw || raw === 'ALL') return 'all'
  if (!/^[A-Z]{2,3}$/.test(raw)) return 'all'
  return raw
}
