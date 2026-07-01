import { parseBooleanEnv } from './parse-env'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

export function isEnvTrue(value?: string | null): boolean {
  if (!value) return false
  return TRUE_VALUES.has(value.trim().toLowerCase())
}

export function getBooleanFromEnv(key: string, fallback: boolean): boolean {
  return parseBooleanEnv(process.env[key], fallback)
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
