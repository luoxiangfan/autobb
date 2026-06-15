const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off'])

export function isEnvTrue(value?: string | null): boolean {
  if (!value) return false
  return TRUE_VALUES.has(value.trim().toLowerCase())
}

export function getBooleanFromEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key]
  if (!raw) return fallback
  const normalized = raw.trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return fallback
}

export function getPositiveIntFromEnv(key: string, fallback: number): number {
  const raw = process.env[key]
  if (!raw) return fallback

  const parsed = parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback

  return parsed
}

export function getBoundedFloatFromEnv(
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = process.env[key]
  if (!raw) return fallback

  const parsed = parseFloat(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}
