/**
 * 简单日志工具 - 生产环境自动禁用调试日志
 */

const isDev = process.env.NODE_ENV === 'development'

export const logger = {
  /**
   * 调试日志 - 仅开发环境输出
   */
  debug(...args: any[]) {
    if (isDev) {
      console.log('[DEBUG]', ...args)
    }
  },

  /**
   * 信息日志 - 所有环境输出
   */
  info(...args: any[]) {
    console.log('[INFO]', ...args)
  },

  /**
   * 警告日志 - 所有环境输出
   */
  warn(...args: any[]) {
    console.warn('[WARN]', ...args)
  },

  /**
   * 错误日志 - 所有环境输出
   */
  error(...args: any[]) {
    console.error('[ERROR]', ...args)
  }
}
