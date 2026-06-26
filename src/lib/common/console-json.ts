import util from 'node:util'
import { logger } from './logger'

function findFirstError(args: unknown[]): Error | undefined {
  for (const arg of args) {
    if (arg instanceof Error) return arg
  }
  return undefined
}

function writeConsoleMessage(level: 'debug' | 'info', message: string) {
  if (level === 'debug') {
    logger.debug(message)
    return
  }
  logger.info(message)
}

/**
 * 将 console.* 统一输出为单行 JSON（stdout），并自动注入 requestId/userId（若存在）。
 * 生产环境 console.log 降为 debug，避免历史调试输出在 LOG_LEVEL=info 时刷屏。
 */
export function patchConsoleToJsonOnce() {
  const anyConsole = console as unknown as { __jsonPatched?: boolean }
  if (anyConsole.__jsonPatched) return
  anyConsole.__jsonPatched = true

  const consoleLogLevel = process.env.NODE_ENV === 'production' ? 'debug' : 'info'

  console.debug = (...args: unknown[]) => logger.debug(util.format(...args))
  console.log = (...args: unknown[]) => writeConsoleMessage(consoleLogLevel, util.format(...args))
  console.info = (...args: unknown[]) => logger.info(util.format(...args))
  console.warn = (...args: unknown[]) => logger.warn(util.format(...args))
  console.error = (...args: unknown[]) => {
    const error = findFirstError(args)
    logger.error(util.format(...args), {}, error)
  }
}
