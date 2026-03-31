/**
 * DB date/time parsing helpers.
 *
 * The project historically stores timestamps as UTC but uses PostgreSQL `timestamp`
 * (without time zone) in some tables. Some clients (e.g. postgres.js default `date`
 * parser) interpret those values as *local time*, which causes a fixed offset shift
 * when `process.env.TZ` is not UTC.
 *
 * These helpers normalize common SQLite/PostgreSQL textual formats and interpret
 * "no time zone" timestamps as UTC.
 */

export function parseDbDateTimeAsUtc(value: string): Date {
  const raw = value.trim()

  // Date-only: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const iso = `${raw}T00:00:00.000Z`
    const date = new Date(iso)
    if (!Number.isNaN(date.getTime())) return date
    return new Date(raw)
  }

  // Split timezone suffix if present.
  // Supported:
  // - Z
  // - +HH, -HH
  // - +HHMM, -HHMM
  // - +HH:MM, -HH:MM
  const tzMatch = raw.match(/(Z|[+-]\d{2}(?::?\d{2})?)$/i)
  let tz = tzMatch?.[1] ?? 'Z'
  let base = tzMatch ? raw.slice(0, -tz.length) : raw

  // Normalize separator: "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DDTHH:mm:ss"
  base = base.replace(' ', 'T')

  // Normalize timezone offsets for JS Date:
  // +00  -> +00:00
  // +0800 -> +08:00
  if (/^[+-]\d{2}$/i.test(tz)) {
    tz = `${tz}:00`
  } else if (/^[+-]\d{4}$/i.test(tz)) {
    tz = `${tz.slice(0, 3)}:${tz.slice(3)}`
  }

  // Normalize fractional seconds to milliseconds (Date only keeps ms).
  base = base.replace(/\.(\d{1,})$/, (_, digits: string) => {
    const ms = digits.slice(0, 3).padEnd(3, '0')
    return `.${ms}`
  })

  const iso = `${base}${tz}`
  const date = new Date(iso)
  if (!Number.isNaN(date.getTime())) return date

  // Fallback: let JS try (best-effort).
  return new Date(raw)
}

export function normalizeDateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    // "YYYY-MM-DD" or "YYYY-MM-DDTHH..." or "YYYY-MM-DD HH..."
    return value.split('T')[0].split(' ')[0]
  }
  if (value instanceof Date) {
    return value.toISOString().split('T')[0]
  }
  return String(value).split('T')[0].split(' ')[0]
}

export function normalizeTimestampToIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const date = parseDbDateTimeAsUtc(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const asString = String(value)
  const date = parseDbDateTimeAsUtc(asString)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

