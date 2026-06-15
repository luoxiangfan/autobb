import { getLogContext } from './log-context'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogFields = Record<string, unknown>

function serializeError(error: unknown): Record<string, unknown> | undefined {
  if (!error) return undefined
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return { message: String(error) }
}

function writeLogLine(payload: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function baseFields(): Record<string, unknown> {
  return {
    ts: new Date().toISOString(),
    service: process.env.SERVICE_NAME || 'autoads',
    env: process.env.NODE_ENV || 'development',
    instanceId: process.env.HOSTNAME || process.env.INSTANCE_ID,
    pid: process.pid,
  }
}

export const logger = {
  debug(msg: string, fields: LogFields = {}) {
    log('debug', msg, fields)
  },
  info(msg: string, fields: LogFields = {}) {
    log('info', msg, fields)
  },
  warn(msg: string, fields: LogFields = {}) {
    log('warn', msg, fields)
  },
  error(msg: string, fields: LogFields = {}, error?: unknown) {
    log('error', msg, fields, error)
  },
}

export function log(level: LogLevel, msg: string, fields: LogFields = {}, error?: unknown) {
  const context = getLogContext()
  const payload: Record<string, unknown> = {
    ...baseFields(),
    level,
    msg,
    ...context,
    ...fields,
  }

  const serialized = serializeError(error)
  if (serialized) payload.err = serialized

  writeLogLine(payload)
}
