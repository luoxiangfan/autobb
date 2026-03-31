import util from 'node:util'
import { logger } from './structured-logger'

function findFirstError(args: unknown[]): Error | undefined {
  for (const arg of args) {
    if (arg instanceof Error) return arg
  }
  return undefined
}

/**
 * 将 console.* 统一输出为单行 JSON（stdout），并自动注入 requestId/userId（若存在）。
 */
export function patchConsoleToJsonOnce() {
  const anyConsole = console as unknown as { __jsonPatched?: boolean }
  if (anyConsole.__jsonPatched) return
  anyConsole.__jsonPatched = true

  console.debug = (...args: unknown[]) => logger.debug(util.format(...args))
  console.log = (...args: unknown[]) => logger.info(util.format(...args))
  console.info = (...args: unknown[]) => logger.info(util.format(...args))
  console.warn = (...args: unknown[]) => logger.warn(util.format(...args))
  console.error = (...args: unknown[]) => {
    const error = findFirstError(args)
    logger.error(util.format(...args), {}, error)
  }
}
