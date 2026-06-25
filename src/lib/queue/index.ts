/**
 * 统一队列系统入口
 *
 * 使用方式
 * ```typescript
 * import { getQueueManager } from '@/lib/queue'
 *
 * // 1. 获取队列实例
 * const queue = getQueueManager()
 * await queue.initialize()
 * await queue.start()
 *
 * // 2. 注册执行器
 * queue.registerExecutor('offer-extraction', async (task) => {
 * // 执行 Offer 提取
 * return result
 * })
 *
 * // 3. 添加任务
 * await queue.enqueue('offer-extraction', { offerId: 1 }, userId, {
 * priority: 'high',
 * })
 * ```
 */

export * from './types'
export * from './unified-queue-manager'
export * from './memory-adapter'
export * from './redis-adapter'
export * from './proxy-manager'
export * from './queue-routing'
