/**
 * 统一日志入口：structured-logger 为底层实现，logger 为 variadic 兼容层。
 */
export {
  log,
  logger as structuredLogger,
  shouldEmitLog,
  shouldLogLevel,
  shouldSampleLog,
} from './structured-logger'
export { logger } from './logger'
