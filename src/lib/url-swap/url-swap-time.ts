/**
 * 换链接任务时间工具
 * src/lib/url-swap-time.ts
 */

/**
 * 计算下次执行时间（简单UTC时间计算）
 * @param intervalMinutes - 换链间隔（分钟）
 * @returns 下次执行时间
 */
export function calculateNextSwapAt(intervalMinutes: number): Date {
  const now = new Date()
  const intervalMs = intervalMinutes * 60 * 1000
  return new Date(Math.ceil(now.getTime() / intervalMs) * intervalMs)
}
