function tryParseJsonString(value: string): { ok: true; parsed: unknown } | { ok: false } {
  try {
    let parsed: unknown = JSON.parse(value)

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
 * 安全解析 JSON 字段，兼容 JSONB 对象/数组及双重编码的 JSON 字符串。
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
 * 将 JSON 字段值规范化为 PostgreSQL JSONB 可写入值（原生对象/数组）。
 */
export function toDbJsonField(value: unknown): unknown {
  if (value === undefined || value === null) return null

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

/** TEXT 列 JSON 字段：存 JSON 字符串。 */
export function toDbJsonTextField(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null
    return value
  }
  return JSON.stringify(value)
}

/** JSONB 结构化字段：仅允许对象/数组。 */
export function toDbJsonObjectField(value: unknown, fallback: unknown = null): unknown {
  const normalized = toDbJsonField(value)

  if (normalized === null || normalized === undefined) return null

  if (Array.isArray(normalized) || typeof normalized === 'object') {
    return normalized
  }

  return fallback
}

/** JSONB 数组字段：仅允许数组。 */
export function toDbJsonArrayField(value: unknown, fallback: unknown[] = []): unknown {
  const normalized = toDbJsonField(value ?? fallback)

  if (Array.isArray(normalized)) return normalized
  return fallback
}
