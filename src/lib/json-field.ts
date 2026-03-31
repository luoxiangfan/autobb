import type { DatabaseType } from '@/lib/db'

function tryParseJsonString(value: string): { ok: true; parsed: unknown } | { ok: false } {
  try {
    let parsed: unknown = JSON.parse(value)

    // 处理双重 JSON 编码：第一次解析后仍是 JSON 字符串
    for (let i = 0; i < 2; i += 1) {
      if (typeof parsed !== 'string') break
      const nested = parsed.trim()
      if (!nested || nested === 'null' || nested === 'undefined') break
      try {
        parsed = JSON.parse(nested)
      } catch {
        break
      }
    }

    return { ok: true, parsed }
  } catch {
    return { ok: false }
  }
}

/**
 * 安全解析 JSON 字段，兼容以下存储形态：
 * 1) SQLite TEXT(JSON字符串)
 * 2) PostgreSQL JSONB(对象/数组)
 * 3) PostgreSQL JSONB 中误存的 JSON 字符串（双重编码）
 */
export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback

  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return value as T
  }

  if (typeof value !== 'string') return fallback

  const trimmed = value.trim()
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
    return fallback
  }

  const parsed = tryParseJsonString(trimmed)
  if (!parsed.ok) {
    return fallback
  }

  return (parsed.parsed ?? fallback) as T
}

/**
 * 将任意 JSON 字段值规范化为数据库可写入值：
 * - SQLite: 保持字符串（或对对象/数组执行 JSON.stringify）
 * - PostgreSQL: 尽量写入原生对象/数组，避免 jsonb 双重编码
 */
export function toDbJsonField(value: unknown, dbType: DatabaseType): unknown {
  if (value === undefined || value === null) return null

  if (dbType !== 'postgres') {
    return typeof value === 'string' ? value : JSON.stringify(value)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null
    const parsed = tryParseJsonString(trimmed)
    if (parsed.ok) {
      return parsed.parsed
    }
    return value
  }

  return value
}

/**
 * JSONB 结构化字段专用：
 * PostgreSQL 下强制仅允许对象/数组，避免写入 jsonb string。
 */
export function toDbJsonObjectField(
  value: unknown,
  dbType: DatabaseType,
  fallback: unknown = null
): unknown {
  const normalized = toDbJsonField(value, dbType)

  if (dbType !== 'postgres') return normalized
  if (normalized === null || normalized === undefined) return null

  if (Array.isArray(normalized) || typeof normalized === 'object') {
    return normalized
  }

  return fallback
}

/**
 * JSONB 数组字段专用：
 * PostgreSQL 下强制仅允许数组，避免写入 jsonb string 或对象。
 */
export function toDbJsonArrayField(
  value: unknown,
  dbType: DatabaseType,
  fallback: unknown[] = []
): unknown {
  const normalized = toDbJsonField(value ?? fallback, dbType)

  if (dbType !== 'postgres') return normalized
  if (Array.isArray(normalized)) return normalized
  return fallback
}
