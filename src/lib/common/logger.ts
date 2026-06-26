/**
 * 兼容层：variadic 调用统一转发到 structured-logger，并受 LOG_LEVEL 控制。
 */
import { logger as structuredLogger } from './structured-logger'

type LogFields = Record<string, unknown>

function formatArg(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function normalizeLogArgs(args: unknown[]): { msg: string; fields: LogFields; error?: unknown } {
  if (args.length === 0) return { msg: '', fields: {} }

  let error: unknown | undefined
  const rest = [...args]
  if (rest[rest.length - 1] instanceof Error) {
    error = rest.pop()
  }

  if (rest.length === 1) {
    const first = rest[0]
    return { msg: typeof first === 'string' ? first : formatArg(first), fields: {}, error }
  }

  if (rest.length >= 2 && typeof rest[0] === 'string') {
    const second = rest[1]
    if (second !== null && typeof second === 'object' && !Array.isArray(second)) {
      return { msg: rest[0], fields: second as LogFields, error }
    }
  }

  return { msg: rest.map(formatArg).join(' '), fields: {}, error }
}

export const logger = {
  debug(...args: unknown[]) {
    const { msg, fields } = normalizeLogArgs(args)
    structuredLogger.debug(msg, fields)
  },
  info(...args: unknown[]) {
    const { msg, fields } = normalizeLogArgs(args)
    structuredLogger.info(msg, fields)
  },
  warn(...args: unknown[]) {
    const { msg, fields } = normalizeLogArgs(args)
    structuredLogger.warn(msg, fields)
  },
  error(...args: unknown[]) {
    const { msg, fields, error } = normalizeLogArgs(args)
    structuredLogger.error(msg, fields, error)
  },
}
