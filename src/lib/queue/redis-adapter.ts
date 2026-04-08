import Redis from 'ioredis'
import type {
  Task,
  TaskType,
  TaskStatus,
  TaskPriority,
  QueueStats,
  QueueStorageAdapter,
  PendingEligibilityStats,
  RunningConcurrencySnapshot
} from './types'
import { isBackgroundTaskType } from './task-category'

/**
 * Redis队列存储适配器
 *
 * 使用Redis作为持久化队列存储
 * 支持分布式环境和任务持久化
 */
export class RedisQueueAdapter implements QueueStorageAdapter {
  private client: Redis | null = null
  private keyPrefix: string
  private connected: boolean = false

  private reconnectAttempts = 0
  private readonly MAX_RECONNECT_ATTEMPTS = 10

  private isEphemeralTaskType(type: Task['type']): boolean {
    return type === 'click-farm' || type === 'click-farm-trigger' || type === 'click-farm-batch'
  }

  constructor(
    private redisUrl: string,
    keyPrefix: string = 'queue:'
  ) {
    this.keyPrefix = keyPrefix
  }

  async connect(): Promise<void> {
    if (this.connected && this.client?.status === 'ready') return

    try {
      this.client = new Redis(this.redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,

        // 连接保活配置
        keepAlive: 30000,  // 每30秒发送TCP keepalive包
        connectTimeout: 10000,  // 连接超时10秒

        // 重连策略：指数退避，最大延迟10秒
        retryStrategy: (times: number) => {
          this.reconnectAttempts = times

          if (times > this.MAX_RECONNECT_ATTEMPTS) {
            console.error(`❌ Redis队列重连失败，已达到最大重试次数(${this.MAX_RECONNECT_ATTEMPTS})`)
            return null  // 停止重试
          }

          const delay = Math.min(times * 200, 10000)
          if (times <= 3) {
            console.log(`⏳ Redis队列重连中... (第${times}次，${delay}ms后重试)`)
          }
          return delay
        },

        // 自动重连
        autoResubscribe: true,
        autoResendUnfulfilledCommands: true,
      })

      // 连接Redis
      await this.client.connect()

      // 监听连接状态
      this.client.on('connect', () => {
        console.log('🔗 Redis队列正在建立连接...')
      })

      this.client.on('ready', () => {
        this.reconnectAttempts = 0
        this.connected = true
        console.log('✅ Redis队列已连接')
      })

      this.client.on('error', (err) => {
        // 只在首次错误或关键错误时打印
        if (this.reconnectAttempts === 0 || err.message.includes('ECONNREFUSED')) {
          console.error('🔴 Redis队列连接错误:', err.message)
        }
        this.connected = false
      })

      this.client.on('close', () => {
        if (this.reconnectAttempts === 0) {
          console.warn('⚠️ Redis队列连接已关闭，将尝试重连...')
        }
        this.connected = false
      })

      this.client.on('reconnecting', (delay: number) => {
        if (this.reconnectAttempts <= 3) {
          console.log(`🔄 Redis队列正在重连... (延迟${delay}ms)`)
        }
      })

      this.connected = true
    } catch (error: any) {
      console.error('❌ Redis队列连接失败:', error.message)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit()
      this.client = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected && this.client !== null
  }

  private getKey(suffix: string): string {
    return `${this.keyPrefix}${suffix}`
  }

  private getMaxEligibleScore(nowMs: number): number {
    // 与 getPriorityScore 保持一致：availableAt=ms 以秒为主键 + priorityRank + msRemainder
    const seconds = Math.floor(nowMs / 1000)
    const msRemainder = nowMs % 1000
    // low 是最大 priorityRank，确保覆盖所有优先级
    const priorityRankMax = this.getPriorityRank('low')
    return seconds * 10000 + priorityRankMax * 1000 + msRemainder
  }

  private async popEligible(queueKey: string): Promise<string | null> {
    if (!this.client) return null

    const maxScore = this.getMaxEligibleScore(Date.now())
    const script = `
      local items = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
      if #items == 0 then return nil end
      redis.call('ZREM', KEYS[1], items[1])
      return items[1]
    `

    const taskId = await this.client.eval(script, 1, queueKey, String(maxScore)) as unknown
    return typeof taskId === 'string' && taskId.length > 0 ? taskId : null
  }

  private decodeAvailableAtFromScore(score: number): number {
    const seconds = Math.floor(score / 10000)
    const msRemainder = score % 1000
    return seconds * 1000 + msRemainder
  }

  async enqueue(task: Task): Promise<void> {
    if (!this.client) throw new Error('Redis not connected')

    const pipeline = this.client.pipeline()

    // 若任务从 running/finished 状态回到 pending（如并发受限退回、重试），需要清理旧索引
    // 否则 /api/queue/stats 通过 running set 读取会把 pending 任务误算为 running（出现 10/4 这类显示）
    pipeline.srem(this.getKey('running'), task.id)
    pipeline.srem(this.getKey('completed'), task.id)
    pipeline.srem(this.getKey('failed'), task.id)

    // 1. 存储任务详情
    pipeline.hset(
      this.getKey('tasks'),
      task.id,
      JSON.stringify(task)
    )

    // 2. 添加到优先级队列（使用sorted set，分数为优先级+时间戳）
    const priorityScore = this.getPriorityScore(task)
    pipeline.zadd(
      this.getKey(`pending:${task.type}`),
      priorityScore,
      task.id
    )

    // 3. 添加到全局pending队列
    pipeline.zadd(
      this.getKey('pending:all'),
      priorityScore,
      task.id
    )

    // 4. 添加到用户队列
    pipeline.zadd(
      this.getKey(`user:${task.userId}:pending`),
      priorityScore,
      task.id
    )

    const results = await pipeline.exec()
    // ioredis pipeline.exec 不会自动 throw；这里仅记录错误，避免“静默孤儿任务”
    const failed = results?.filter(([err]) => err)
    if (failed && failed.length > 0) {
      const firstErr = failed[0][0] as Error
      console.error('[RedisQueueAdapter] enqueue pipeline partial failure:', firstErr?.message || firstErr)
    }
  }

  async dequeue(type?: TaskType): Promise<Task | null> {
    if (!this.client) return null

    const queueKey = type
      ? this.getKey(`pending:${type}`)
      : this.getKey('pending:all')

    // notBefore 支持：仅弹出“已到可执行时间”的任务，避免未来任务被提前 dequeue
    const taskId = await this.popEligible(queueKey)
    if (!taskId) return null

    // 获取任务详情
    const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
    if (!taskJson) return null

    const task: Task = JSON.parse(taskJson)

    // 更新任务状态为running
    task.status = 'running'
    task.startedAt = Date.now()
    // 进入 running 后清理退避字段，避免后续统计/调试混淆
    delete (task as any).notBefore
    delete (task as any).deferCount

    const pipeline = this.client.pipeline()

    // 1. 更新任务详情
    pipeline.hset(this.getKey('tasks'), task.id, JSON.stringify(task))

    // 2. 添加到running集合
    pipeline.sadd(this.getKey('running'), task.id)

    // 3. 从用户pending队列移除
    pipeline.zrem(this.getKey(`user:${task.userId}:pending`), task.id)

    // 4. 从类型pending队列移除（如果是通过全局队列dequeue的，避免类型队列泄漏）
    pipeline.zrem(this.getKey(`pending:${task.type}`), task.id)

    // 5. 从全局pending队列移除（如果是通过类型队列dequeue的）
    if (type) pipeline.zrem(this.getKey('pending:all'), task.id)

    await pipeline.exec()

    return task
  }

  async peek(): Promise<Task | null> {
    if (!this.client) return null

    // 查看最高优先级任务（不移除）
    const result = await this.client.zrange(
      this.getKey('pending:all'),
      0,
      0
    )
    if (!result || result.length === 0) return null

    const taskId = result[0]
    const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
    if (!taskJson) return null

    return JSON.parse(taskJson)
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    error?: string
  ): Promise<void> {
    if (!this.client) throw new Error('Redis not connected')

    // 获取任务
    const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
    if (!taskJson) return

    const task: Task = JSON.parse(taskJson)
    task.status = status
    if (error) task.error = error
    if (status === 'completed' || status === 'failed') {
      task.completedAt = Date.now()
    }

    const pipeline = this.client.pipeline()

    const shouldPurgeEphemeral =
      (status === 'completed' || status === 'failed') && this.isEphemeralTaskType(task.type)

    if (!shouldPurgeEphemeral) {
      // 1. 更新任务详情
      pipeline.hset(this.getKey('tasks'), task.id, JSON.stringify(task))
    }

    // 2. 从running集合移除
    if (status === 'completed' || status === 'failed') {
      pipeline.srem(this.getKey('running'), taskId)

      // 3. 添加到completed或failed集合
      if (!shouldPurgeEphemeral) {
        const targetSet = status === 'completed' ? 'completed' : 'failed'
        pipeline.sadd(this.getKey(targetSet), taskId)
      } else {
        // click-farm 系列为高频任务：完成即清理，避免 tasks hash 膨胀导致统计 OOM
        pipeline.hdel(this.getKey('tasks'), taskId)
        pipeline.srem(this.getKey('completed'), taskId)
        pipeline.srem(this.getKey('failed'), taskId)
        pipeline.zrem(this.getKey('pending:all'), taskId)
        pipeline.zrem(this.getKey(`pending:${task.type}`), taskId)
        pipeline.zrem(this.getKey(`user:${task.userId}:pending`), taskId)
      }
    }

    await pipeline.exec()
  }

  async getTask(taskId: string): Promise<Task | null> {
    if (!this.client) return null

    const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
    if (!taskJson) return null

    return JSON.parse(taskJson)
  }

  async getStats(): Promise<QueueStats> {
    if (!this.client) {
      return {
        total: 0,
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        byType: {} as Record<TaskType, number>,
        byTypeRunning: {} as Record<TaskType, number>,
        byUser: {}
      }
    }

    // 🔥 修复：统一从任务详情计算统计，确保全局和用户统计一致
    // 🔧 内存优化：使用 HSCAN 分批处理，避免 hvals() 在高任务量时占用巨量内存
    const byType: Record<TaskType, number> = {} as Record<TaskType, number>
    const byTypeRunning: Record<TaskType, number> = {} as Record<TaskType, number>
    const byUser: QueueStats['byUser'] = {}

    // 状态计数器
    let totalPending = 0
    let totalRunning = 0
    let totalCompleted = 0
    let totalFailed = 0

    const tasksKey = this.getKey('tasks')
    const scanCount = 1000
    let cursor = '0'
    do {
      const result = await this.client.hscan(tasksKey, cursor, 'COUNT', String(scanCount))
      cursor = Array.isArray(result) ? String(result[0]) : '0'
      const entries = Array.isArray(result) ? (result[1] as string[]) : []

      for (let i = 1; i < entries.length; i += 2) {
        const taskJson = entries[i]
        if (!taskJson) continue
        let task: Task
        try {
          task = JSON.parse(taskJson)
        } catch {
          continue
        }

        // 🔥 过滤无效用户ID（userId <= 0 是无效的）
        // 无效用户的任务不计入任何统计
        if (!task.userId || task.userId <= 0) {
          continue
        }

        // 按类型统计
        byType[task.type] = (byType[task.type] || 0) + 1
        if (task.status === 'running') {
          byTypeRunning[task.type] = (byTypeRunning[task.type] || 0) + 1
        }

        // 按用户统计
        const uid = task.userId
        let userStats = byUser[uid]
        if (!userStats) {
          userStats = byUser[uid] = {
            pending: 0,
            running: 0,
            completed: 0,
            failed: 0,
            coreCompleted: 0,
            backgroundCompleted: 0,
            coreFailed: 0,
            backgroundFailed: 0,
          }
        }
        userStats[task.status]++
        if (task.status === 'completed') {
          if (isBackgroundTaskType(task.type)) userStats.backgroundCompleted = (userStats.backgroundCompleted ?? 0) + 1
          else userStats.coreCompleted = (userStats.coreCompleted ?? 0) + 1
        } else if (task.status === 'failed') {
          if (isBackgroundTaskType(task.type)) userStats.backgroundFailed = (userStats.backgroundFailed ?? 0) + 1
          else userStats.coreFailed = (userStats.coreFailed ?? 0) + 1
        }

        // 全局状态统计（与用户统计使用相同逻辑）
        if (task.status === 'pending') totalPending++
        else if (task.status === 'running') totalRunning++
        else if (task.status === 'completed') totalCompleted++
        else if (task.status === 'failed') totalFailed++
      }
    } while (cursor !== '0')

    return {
      total: totalPending + totalRunning + totalCompleted + totalFailed,
      pending: totalPending,
      running: totalRunning,
      completed: totalCompleted,
      failed: totalFailed,
      byType,
      byTypeRunning,
      byUser
    }
  }

  async getRunningTasks(): Promise<Task[]> {
    if (!this.client) return []

    const taskIds = await this.client.smembers(this.getKey('running'))
    if (!taskIds || taskIds.length === 0) return []

    const taskJsons = await this.client.hmget(this.getKey('tasks'), ...taskIds)
    const tasks: Task[] = []

    for (const taskJson of taskJsons) {
      if (!taskJson) continue
      try {
        tasks.push(JSON.parse(taskJson))
      } catch {
        // ignore corrupted task JSON
      }
    }

    return tasks
  }

  async getRunningConcurrencySnapshot(params: {
    userId: number
    type: TaskType
    excludeTaskId?: string
  }): Promise<RunningConcurrencySnapshot> {
    if (!this.client) {
      return {
        globalCoreRunning: 0,
        userCoreRunning: 0,
        typeRunning: 0,
      }
    }

    const { userId, type, excludeTaskId } = params
    const taskIds = await this.client.smembers(this.getKey('running'))
    if (!taskIds || taskIds.length === 0) {
      return {
        globalCoreRunning: 0,
        userCoreRunning: 0,
        typeRunning: 0,
      }
    }

    const effectiveTaskIds = excludeTaskId
      ? taskIds.filter((taskId) => taskId !== excludeTaskId)
      : taskIds

    if (effectiveTaskIds.length === 0) {
      return {
        globalCoreRunning: 0,
        userCoreRunning: 0,
        typeRunning: 0,
      }
    }

    const taskJsons = await this.client.hmget(this.getKey('tasks'), ...effectiveTaskIds)
    let globalCoreRunning = 0
    let userCoreRunning = 0
    let typeRunning = 0

    for (const taskJson of taskJsons) {
      if (!taskJson) continue

      let task: Task
      try {
        task = JSON.parse(taskJson) as Task
      } catch {
        continue
      }

      if (task.status !== 'running') continue

      if (!isBackgroundTaskType(task.type)) {
        globalCoreRunning++
        if (task.userId === userId) {
          userCoreRunning++
        }
      }

      if (task.type === type) {
        typeRunning++
      }
    }

    return {
      globalCoreRunning,
      userCoreRunning,
      typeRunning,
    }
  }

  async getPendingTasks(type?: TaskType): Promise<Task[]> {
    if (!this.client) return []

    const queueKey = type
      ? this.getKey(`pending:${type}`)
      : this.getKey('pending:all')

    const taskIds = await this.client.zrange(queueKey, 0, -1)
    const tasks: Task[] = []

    for (const taskId of taskIds) {
      const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
      if (taskJson) {
        tasks.push(JSON.parse(taskJson))
      }
    }

    return tasks
  }

  async clearCompleted(): Promise<number> {
    if (!this.client) return 0

    const taskIds = await this.client.smembers(this.getKey('completed'))
    if (taskIds.length === 0) return 0

    const pipeline = this.client.pipeline()

    for (const taskId of taskIds) {
      pipeline.hdel(this.getKey('tasks'), taskId)
    }
    pipeline.del(this.getKey('completed'))

    await pipeline.exec()
    return taskIds.length
  }

  async clearFailed(): Promise<number> {
    if (!this.client) return 0

    const taskIds = await this.client.smembers(this.getKey('failed'))
    if (taskIds.length === 0) return 0

    const pipeline = this.client.pipeline()

    for (const taskId of taskIds) {
      pipeline.hdel(this.getKey('tasks'), taskId)
    }
    pipeline.del(this.getKey('failed'))

    await pipeline.exec()
    return taskIds.length
  }

  /**
   * 🔥 按类型和状态删除任务（用于服务重启时清理特定任务）
   *
   * 使用场景：服务重启时清理URL Swap任务，避免重复执行
   *
   * @param type 任务类型（如 'url-swap'）
   * @param status 任务状态（'pending' 或 'running'）
   * @returns 删除的任务数量
   */
  async deleteTasksByTypeAndStatus(
    type: TaskType,
    status: 'pending' | 'running'
  ): Promise<number> {
    if (!this.client) return 0

    // 1. 获取指定状态的所有任务ID（pending 优先从类型队列取，避免 pending:all 缺失/不一致导致漏删）
    const taskIds = status === 'pending'
      ? await this.client.zrange(this.getKey(`pending:${type}`), 0, -1)
      : await this.client.smembers(this.getKey('running'))

    if (taskIds.length === 0) return 0

    // 2. 从tasks hash中获取任务详情，过滤出指定type的任务
    const tasksToDelete: string[] = []
    for (const taskId of taskIds) {
      const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
      if (taskJson) {
        const task = JSON.parse(taskJson) as Task
        if (task.type === type) {
          tasksToDelete.push(taskId)
        }
      }
    }

    if (tasksToDelete.length === 0) return 0

    // 3. 批量删除任务（需要先获取任务详情以获取userId）
    const taskDetails = new Map<string, Task>()
    for (const taskId of tasksToDelete) {
      const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
      if (taskJson) {
        taskDetails.set(taskId, JSON.parse(taskJson) as Task)
      }
    }

    // 4. 使用pipeline批量删除
    const pipeline = this.client.pipeline()

    for (const taskId of tasksToDelete) {
      const task = taskDetails.get(taskId)
      if (!task) continue

      // 从tasks hash中删除
      pipeline.hdel(this.getKey('tasks'), taskId)

      // 从状态集合中删除
      if (status === 'pending') {
        pipeline.zrem(this.getKey('pending:all'), taskId)
        pipeline.zrem(this.getKey(`pending:${type}`), taskId)
        pipeline.zrem(this.getKey(`user:${task.userId}:pending`), taskId)
      } else {
        pipeline.srem(this.getKey('running'), taskId)
      }

      // 防御性清理：防止任务散落在其它集合
      pipeline.srem(this.getKey('completed'), taskId)
      pipeline.srem(this.getKey('failed'), taskId)
    }

    await pipeline.exec()

    console.log(`[Redis] 删除 ${tasksToDelete.length} 个 type=${type} status=${status} 的任务`)

    return tasksToDelete.length
  }

  /**
   * 🔥 全面清理所有未完成任务（启动时使用）
   *
   * 解决僵尸任务问题：
   * 1. 清空所有pending队列
   * 2. 清空running集合（关键：服务重启后所有running任务都是僵尸）
   * 3. 清空用户相关队列
   * 4. 从tasks hash中删除未完成任务
   * 5. 保留completed和failed作为历史记录
   */
  async clearAllUnfinished(): Promise<{
    pendingCleared: number
    runningCleared: number
    userQueuesCleared: number
    totalCleared: number
  }> {
    if (!this.client) {
      return {
        pendingCleared: 0,
        runningCleared: 0,
        userQueuesCleared: 0,
        totalCleared: 0
      }
    }

    // 1. 获取所有pending任务ID
    const pendingTaskIds = await this.client.zrange(this.getKey('pending:all'), 0, -1)

    // 2. 获取所有running任务ID（僵尸任务）
    const runningTaskIds = await this.client.smembers(this.getKey('running'))

    // 3. 获取所有用户pending队列
    const userPendingKeys = await this.client.keys(this.getKey('user:*:pending'))

    // 合并并去重
    const allTaskIds = [...new Set([...pendingTaskIds, ...runningTaskIds])]

    const pipeline = this.client.pipeline()

    // 4. 删除所有类型的pending队列
    const taskTypes = [
      'scrape',
      'ai-analysis',
      'offer-extraction',
      'batch-offer-creation',
      'sync',
      'backup',
      'export',
      'email',
      'link-check',
      'cleanup',
      'ad-creative',
      'campaign-publish',
      'click-farm-trigger',
      'click-farm-batch',
      'click-farm',
      'url-swap',
      'openclaw-strategy',
      'affiliate-product-sync',
      'openclaw-command',
      'openclaw-affiliate-sync',
      'openclaw-report-send',
      'google-ads-campaign-sync',
    ]
    for (const taskType of taskTypes) {
      pipeline.del(this.getKey(`pending:${taskType}`))
    }

    // 5. 删除全局pending队列
    pipeline.del(this.getKey('pending:all'))

    // 6. 删除running集合
    pipeline.del(this.getKey('running'))

    // 7. 删除所有用户pending队列
    for (const userKey of userPendingKeys) {
      pipeline.del(userKey)
    }

    // 8. 从tasks hash中删除未完成任务
    for (const taskId of allTaskIds) {
      pipeline.hdel(this.getKey('tasks'), taskId)
    }

    await pipeline.exec()

    return {
      pendingCleared: pendingTaskIds.length,
      runningCleared: runningTaskIds.length,
      userQueuesCleared: userPendingKeys.length,
      totalCleared: allTaskIds.length
    }
  }

  /**
   * 清理超时的running任务（定期调用）
   *
   * @param timeoutMs 超时时间（毫秒），默认30分钟
   */
  async cleanupStaleRunningTasks(timeoutMs: number = 30 * 60 * 1000): Promise<{
    cleanedCount: number
    cleanedTaskIds: string[]
  }> {
    if (!this.client) {
      return { cleanedCount: 0, cleanedTaskIds: [] }
    }

    const now = Date.now()
    const runningTaskIds = await this.client.smembers(this.getKey('running'))
    const cleanedTaskIds: string[] = []

    for (const taskId of runningTaskIds) {
      const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
      if (!taskJson) {
        // 任务详情不存在，是孤立的running记录
        await this.client.srem(this.getKey('running'), taskId)
        cleanedTaskIds.push(taskId)
        continue
      }

      const task: Task = JSON.parse(taskJson)
      const startedAt = task.startedAt || task.createdAt

      // 检查是否超时
      if (startedAt && (now - startedAt) > timeoutMs) {
        // 任务超时，标记为失败并清理
        task.status = 'failed'
        task.error = 'Task timeout - marked as stale'
        task.completedAt = now

        const pipeline = this.client.pipeline()
        pipeline.hset(this.getKey('tasks'), task.id, JSON.stringify(task))
        pipeline.srem(this.getKey('running'), taskId)
        pipeline.sadd(this.getKey('failed'), taskId)
        await pipeline.exec()

        cleanedTaskIds.push(taskId)
        console.log(`⏰ 清理超时任务: ${taskId} (运行时间: ${Math.round((now - startedAt) / 1000 / 60)}分钟)`)
      }
    }

    return {
      cleanedCount: cleanedTaskIds.length,
      cleanedTaskIds
    }
  }

  /**
   * 🔥 清理无效用户的任务数据
   *
   * 删除 userId <= 0 的任务记录
   * 用于清理历史脏数据
   */
  async cleanupInvalidUserTasks(): Promise<{
    cleanedCount: number
    cleanedTaskIds: string[]
  }> {
    if (!this.client) {
      return { cleanedCount: 0, cleanedTaskIds: [] }
    }

    const allTaskIds = await this.client.hkeys(this.getKey('tasks'))
    const cleanedTaskIds: string[] = []

    for (const taskId of allTaskIds) {
      const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
      if (!taskJson) continue

      try {
        const task: Task = JSON.parse(taskJson)

        // 检查是否是无效用户
        if (!task.userId || task.userId <= 0) {
          // 从所有相关集合中删除
          const pipeline = this.client.pipeline()
          pipeline.hdel(this.getKey('tasks'), taskId)
          pipeline.srem(this.getKey('running'), taskId)
          pipeline.srem(this.getKey('completed'), taskId)
          pipeline.srem(this.getKey('failed'), taskId)
          pipeline.zrem(this.getKey('pending:all'), taskId)

          // 删除类型相关队列
          if (task.type) {
            pipeline.zrem(this.getKey(`pending:${task.type}`), taskId)
          }

          await pipeline.exec()
          cleanedTaskIds.push(taskId)
          console.log(`🧹 清理无效用户任务: ${taskId} (userId=${task.userId})`)
        }
      } catch (e) {
        // 解析失败的任务也清理掉
        await this.client.hdel(this.getKey('tasks'), taskId)
        cleanedTaskIds.push(taskId)
        console.log(`🧹 清理损坏任务: ${taskId}`)
      }
    }

    if (cleanedTaskIds.length > 0) {
      console.log(`✅ 共清理 ${cleanedTaskIds.length} 个无效用户任务`)
    }

    return {
      cleanedCount: cleanedTaskIds.length,
      cleanedTaskIds
    }
  }

  /**
   * 🔥 获取所有pending任务（用于批量任务取消）
   */
  async getAllPendingTasks(): Promise<Task[]> {
    if (!this.client) throw new Error('Redis not connected')

    const taskIds = await this.client.zrange(this.getKey('pending:all'), 0, -1)
    const tasks: Task[] = []

    for (const taskId of taskIds) {
      const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
      if (taskJson) {
        try {
          tasks.push(JSON.parse(taskJson))
        } catch (e) {
          console.error(`无法解析任务: ${taskId}`)
        }
      }
    }

    return tasks
  }

  async removePendingTasksByUserAndTypes(
    userId: number,
    types: TaskType[]
  ): Promise<{ removedCount: number; removedTaskIds: string[] }> {
    if (!this.client) {
      return { removedCount: 0, removedTaskIds: [] }
    }

    const typeSet = new Set(types)
    const userPendingKey = this.getKey(`user:${userId}:pending`)
    const taskIds = await this.client.zrange(userPendingKey, 0, -1)

    if (!taskIds || taskIds.length === 0) {
      return { removedCount: 0, removedTaskIds: [] }
    }

    const taskJsons = await this.client.hmget(this.getKey('tasks'), ...taskIds)
    const toRemove: Array<{ id: string; type: TaskType }> = []

    for (let i = 0; i < taskIds.length; i++) {
      const taskJson = taskJsons[i]
      if (!taskJson) continue
      try {
        const task = JSON.parse(taskJson) as Task
        if (task.userId === userId && typeSet.has(task.type)) {
          toRemove.push({ id: task.id, type: task.type })
        }
      } catch {
        // ignore corrupted task JSON
      }
    }

    if (toRemove.length === 0) {
      return { removedCount: 0, removedTaskIds: [] }
    }

    const removedTaskIds: string[] = []
    const BATCH_SIZE = 500

    for (let i = 0; i < toRemove.length; i += BATCH_SIZE) {
      const batch = toRemove.slice(i, i + BATCH_SIZE)
      const pipeline = this.client.pipeline()

      for (const item of batch) {
        pipeline.hdel(this.getKey('tasks'), item.id)
        pipeline.zrem(this.getKey('pending:all'), item.id)
        pipeline.zrem(this.getKey(`pending:${item.type}`), item.id)
        pipeline.zrem(userPendingKey, item.id)
      }

      await pipeline.exec()
      removedTaskIds.push(...batch.map((b) => b.id))
    }

    if (removedTaskIds.length > 0) {
      console.log(`🗑️ 已从Redis队列移除任务: userId=${userId}, removed=${removedTaskIds.length}`)
    }

    return { removedCount: removedTaskIds.length, removedTaskIds }
  }

  async getPendingEligibilityStats(): Promise<PendingEligibilityStats> {
    if (!this.client) {
      return { pendingTotal: 0, eligiblePending: 0, delayedPending: 0 }
    }

    const queueKey = this.getKey('pending:all')
    const pendingTotal = await this.client.zcard(queueKey)
    if (pendingTotal === 0) {
      return { pendingTotal: 0, eligiblePending: 0, delayedPending: 0 }
    }

    const maxScore = this.getMaxEligibleScore(Date.now())
    const eligiblePending = await this.client.zcount(queueKey, '-inf', String(maxScore))
    const delayedPending = Math.max(0, pendingTotal - eligiblePending)

    let nextEligibleAt: number | undefined
    if (delayedPending > 0) {
      const delayed = await this.client.zrangebyscore(
        queueKey,
        `(${maxScore}`,
        '+inf',
        'WITHSCORES',
        'LIMIT',
        0,
        1
      )

      if (Array.isArray(delayed) && delayed.length >= 2) {
        const score = Number(delayed[1])
        if (Number.isFinite(score)) {
          nextEligibleAt = this.decodeAvailableAtFromScore(score)
        }
      }
    }

    return { pendingTotal, eligiblePending, delayedPending, nextEligibleAt }
  }

  /**
   * 🔥 从队列中移除指定任务（用于批量任务取消）
   */
  async removeTask(taskId: string): Promise<void> {
    if (!this.client) throw new Error('Redis not connected')

    // 获取任务信息（用于确定类型）
    const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
    if (!taskJson) {
      console.warn(`任务不存在: ${taskId}`)
      return
    }

    try {
      const task: Task = JSON.parse(taskJson)

      // 从所有相关集合中删除
      const pipeline = this.client.pipeline()
      pipeline.hdel(this.getKey('tasks'), taskId)
      pipeline.zrem(this.getKey('pending:all'), taskId)

      // 删除类型特定队列
      if (task.type) {
        pipeline.zrem(this.getKey(`pending:${task.type}`), taskId)
      }

      // 删除用户队列
      if (task.userId) {
        pipeline.zrem(this.getKey(`user:${task.userId}:pending`), taskId)
      }

      await pipeline.exec()
      console.log(`🗑️ 已移除任务: ${taskId}`)
    } catch (e) {
      console.error(`移除任务失败: ${taskId}`, e)
      throw e
    }
  }

  /**
   * 计算优先级分数
   *
   * 设计目标：
   * - 先按“可执行时间”排序（notBefore/createdAt），避免未来任务阻塞当前可执行任务
   * - 同一秒内按 priority 排序（high > normal > low）
   * - 同一秒内再按毫秒余数排序，尽量保持近似 FIFO
   */
  private getPriorityScore(task: Task): number {
    const availableAt = (task as any).notBefore ?? task.createdAt ?? Date.now()
    const seconds = Math.floor(availableAt / 1000) // ~1e9，安全
    const msRemainder = availableAt % 1000
    const priorityRank = this.getPriorityRank(task.priority)
    // score 范围约为 seconds*10000（~1e13），安全小于 2^53
    return seconds * 10000 + priorityRank * 1000 + msRemainder
  }

  private getPriorityRank(priority: TaskPriority): number {
    // 数字越小优先级越高（ZPOPMIN 取最小）
    return priority === 'high' ? 0 : priority === 'normal' ? 1 : 2
  }

  /**
   * 🔥 启动时将 running 僵尸任务重新放回 pending 队列
   */
  async requeueAllRunningOnStartup(): Promise<{
    requeuedCount: number
    cleanedMissingCount: number
    taskIds: string[]
  }> {
    if (!this.client) {
      return { requeuedCount: 0, cleanedMissingCount: 0, taskIds: [] }
    }

    const runningIds = await this.client.smembers(this.getKey('running'))
    if (runningIds.length === 0) {
      return { requeuedCount: 0, cleanedMissingCount: 0, taskIds: [] }
    }

    const taskIds: string[] = []
    let requeuedCount = 0
    let cleanedMissingCount = 0

    for (const taskId of runningIds) {
      const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
      if (!taskJson) {
        await this.client.srem(this.getKey('running'), taskId)
        cleanedMissingCount++
        continue
      }

      let task: Task
      try {
        task = JSON.parse(taskJson) as Task
      } catch {
        // 损坏任务：从 running 集合中移除，避免阻塞
        await this.client.srem(this.getKey('running'), taskId)
        cleanedMissingCount++
        continue
      }

      // 已完成/失败的任务不应出现在 running
      if (task.status === 'completed' || task.status === 'failed') {
        await this.client.srem(this.getKey('running'), taskId)
        continue
      }

      // 将任务重新置为 pending（重启后无法确认是否仍在执行，以“可重试”为原则）
      task.status = 'pending'
      delete (task as any).startedAt
      const score = this.getPriorityScore(task)

      const pipeline = this.client.pipeline()
      pipeline.hset(this.getKey('tasks'), task.id, JSON.stringify(task))
      pipeline.srem(this.getKey('running'), task.id)
      pipeline.zadd(this.getKey('pending:all'), score, task.id)
      pipeline.zadd(this.getKey(`pending:${task.type}`), score, task.id)
      if (task.userId && task.userId > 0) {
        pipeline.zadd(this.getKey(`user:${task.userId}:pending`), score, task.id)
      }
      await pipeline.exec()

      taskIds.push(task.id)
      requeuedCount++
    }

    return { requeuedCount, cleanedMissingCount, taskIds }
  }

  /**
   * 🔥 修复 pending 索引：把 tasks hash 中的 pending 任务补齐到 pending zset
   */
  async repairPendingIndexes(): Promise<{ repairedCount: number; scannedCount: number }> {
    if (!this.client) {
      return { repairedCount: 0, scannedCount: 0 }
    }

    let cursor = '0'
    let scannedCount = 0
    let repairedCount = 0

    do {
      const [nextCursor, entries] = await this.client.hscan(
        this.getKey('tasks'),
        cursor,
        'COUNT',
        500
      )
      cursor = nextCursor

      if (!entries || entries.length === 0) continue

      // entries: [field, value, field, value...]
      const pipeline = this.client.pipeline()
      let pipelineOps = 0

      for (let i = 0; i < entries.length; i += 2) {
        const taskJson = entries[i + 1]
        scannedCount++

        let task: Task
        try {
          task = JSON.parse(taskJson) as Task
        } catch {
          continue
        }

        if (task.status !== 'pending') continue
        if (!task.userId || task.userId <= 0) continue

        const score = this.getPriorityScore(task)
        pipeline.zadd(this.getKey('pending:all'), score, task.id)
        pipeline.zadd(this.getKey(`pending:${task.type}`), score, task.id)
        pipeline.zadd(this.getKey(`user:${task.userId}:pending`), score, task.id)
        pipelineOps += 3
        repairedCount++
      }

      if (pipelineOps > 0) {
        await pipeline.exec()
      }
    } while (cursor !== '0')

    return { repairedCount, scannedCount }
  }
}
