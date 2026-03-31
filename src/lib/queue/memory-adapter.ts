import type {
  Task,
  TaskType,
  TaskStatus,
  QueueStats,
  QueueStorageAdapter,
  PendingEligibilityStats,
  RunningConcurrencySnapshot
} from './types'
import { isBackgroundTaskType } from './task-category'

/**
 * 内存队列存储适配器
 *
 * 用于Redis不可用时的回退方案
 */
export class MemoryQueueAdapter implements QueueStorageAdapter {
  private tasks: Map<string, Task> = new Map()
  private pendingQueue: Task[] = []
  private runningTasks: Set<string> = new Set()
  private connected: boolean = false
  private finishedOrder: string[] = []
  private readonly maxFinishedTasks: number = (() => {
    const n = parseInt(process.env.MEMORY_QUEUE_MAX_FINISHED_TASKS || '5000', 10)
    return Number.isFinite(n) && n > 0 ? n : 5000
  })()

  private isEphemeralTaskType(type: Task['type']): boolean {
    return type === 'click-farm' || type === 'click-farm-trigger' || type === 'click-farm-batch'
  }

  private recordFinished(taskId: string) {
    this.finishedOrder.push(taskId)
    while (this.finishedOrder.length > this.maxFinishedTasks) {
      const oldestId = this.finishedOrder.shift()
      if (!oldestId) continue
      const t = this.tasks.get(oldestId)
      // 仅驱逐已完成/失败任务，避免误删仍在 pending/running 的任务
      if (t && (t.status === 'completed' || t.status === 'failed')) {
        this.tasks.delete(oldestId)
      }
    }
  }

  async connect(): Promise<void> {
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
    this.tasks.clear()
    this.pendingQueue = []
    this.runningTasks.clear()
  }

  isConnected(): boolean {
    return this.connected
  }

  async enqueue(task: Task): Promise<void> {
    if (!this.connected) {
      throw new Error('MemoryQueueAdapter: not connected')
    }

    // 任务可能从 running/finished 状态回到 pending（并发受限退回、重试等）
    // 必须清理 running 索引，否则 getRunningTasks() 会把 pending 任务误算为 running
    this.runningTasks.delete(task.id)

    // 防御：避免同一 taskId 在 pendingQueue 中出现重复条目
    this.pendingQueue = this.pendingQueue.filter((t) => t.id !== task.id)

    this.tasks.set(task.id, task)
    this.pendingQueue.push(task)

    // 排序规则与 Redis 一致：
    // 1) 先按可执行时间（notBefore/createdAt）排序，避免未来任务阻塞当前可执行任务
    // 2) 同一时间点内按优先级排序（high > normal > low）
    // 3) 最后按 createdAt 兜底
    this.pendingQueue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 }
      const aAvailableAt = (a as any).notBefore ?? a.createdAt
      const bAvailableAt = (b as any).notBefore ?? b.createdAt
      if (aAvailableAt !== bAvailableAt) return aAvailableAt - bAvailableAt
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return a.createdAt - b.createdAt
    })
  }

  async dequeue(type?: TaskType): Promise<Task | null> {
    if (!this.connected || this.pendingQueue.length === 0) {
      return null
    }

    const now = Date.now()

    // 查找第一个“已到可执行时间”的任务（如果指定类型，则同时匹配类型）
    const index = type
      ? this.pendingQueue.findIndex((t) => t.type === type && (((t as any).notBefore ?? 0) <= now))
      : this.pendingQueue.findIndex((t) => (((t as any).notBefore ?? 0) <= now))

    if (index === -1) return null

    const task = this.pendingQueue.splice(index, 1)[0]
    task.status = 'running'
    task.startedAt = Date.now()
    delete (task as any).notBefore
    delete (task as any).deferCount
    this.runningTasks.add(task.id)
    this.tasks.set(task.id, task)

    return task
  }

  async peek(): Promise<Task | null> {
    if (!this.connected || this.pendingQueue.length === 0) {
      return null
    }
    return this.pendingQueue[0]
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    error?: string
  ): Promise<void> {
    if (!this.connected) {
      throw new Error('MemoryQueueAdapter: not connected')
    }

    const task = this.tasks.get(taskId)
    if (!task) return

    task.status = status
    if (error) task.error = error
    if (status === 'completed' || status === 'failed') {
      task.completedAt = Date.now()
      this.runningTasks.delete(taskId)
      if (this.isEphemeralTaskType(task.type)) {
        // click-farm 系列为高频任务：完成即清理，避免内存队列膨胀
        this.tasks.delete(taskId)
        return
      }
      this.recordFinished(taskId)
    }

    this.tasks.set(taskId, task)
  }

  async getTask(taskId: string): Promise<Task | null> {
    if (!this.connected) return null
    return this.tasks.get(taskId) || null
  }

  async getStats(): Promise<QueueStats> {
    if (!this.connected) {
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

    // 🔥 修复：过滤有效用户，确保全局和用户统计一致
    const allTasks = Array.from(this.tasks.values()).filter(
      (task) => task.userId && task.userId > 0
    )

    const byType: Record<TaskType, number> = {} as Record<TaskType, number>
    const byTypeRunning: Record<TaskType, number> = {} as Record<TaskType, number>
    const byUser: Record<number, any> = {}

    // 状态计数器
    let totalPending = 0
    let totalRunning = 0
    let totalCompleted = 0
    let totalFailed = 0

    allTasks.forEach((task) => {
      // 按类型统计
      byType[task.type] = (byType[task.type] || 0) + 1
      if (task.status === 'running') {
        byTypeRunning[task.type] = (byTypeRunning[task.type] || 0) + 1
      }

      // 按用户统计
      if (!byUser[task.userId]) {
        byUser[task.userId] = {
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
      byUser[task.userId][task.status]++
      if (task.status === 'completed') {
        if (isBackgroundTaskType(task.type)) byUser[task.userId].backgroundCompleted++
        else byUser[task.userId].coreCompleted++
      } else if (task.status === 'failed') {
        if (isBackgroundTaskType(task.type)) byUser[task.userId].backgroundFailed++
        else byUser[task.userId].coreFailed++
      }

      // 全局状态统计（与用户统计使用相同逻辑）
      if (task.status === 'pending') totalPending++
      else if (task.status === 'running') totalRunning++
      else if (task.status === 'completed') totalCompleted++
      else if (task.status === 'failed') totalFailed++
    })

    return {
      total: allTasks.length,
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
    if (!this.connected) return []
    return Array.from(this.runningTasks)
      .map((id) => this.tasks.get(id))
      .filter((t): t is Task => t !== undefined)
  }

  async getRunningConcurrencySnapshot(params: {
    userId: number
    type: TaskType
    excludeTaskId?: string
  }): Promise<RunningConcurrencySnapshot> {
    if (!this.connected) {
      return {
        globalCoreRunning: 0,
        userCoreRunning: 0,
        typeRunning: 0,
      }
    }

    const { userId, type, excludeTaskId } = params
    let globalCoreRunning = 0
    let userCoreRunning = 0
    let typeRunning = 0

    for (const taskId of this.runningTasks) {
      if (excludeTaskId && taskId === excludeTaskId) continue
      const task = this.tasks.get(taskId)
      if (!task || task.status !== 'running') continue

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
    if (!this.connected) return []
    if (type) {
      return this.pendingQueue.filter((t) => t.type === type)
    }
    return [...this.pendingQueue]
  }

  async getPendingEligibilityStats(): Promise<PendingEligibilityStats> {
    if (!this.connected) {
      return { pendingTotal: 0, eligiblePending: 0, delayedPending: 0 }
    }

    const now = Date.now()
    let eligiblePending = 0
    let delayedPending = 0
    let nextEligibleAt: number | undefined

    for (const task of this.pendingQueue) {
      const notBefore = (task as any).notBefore as number | undefined
      const availableAt = typeof notBefore === 'number' ? notBefore : 0
      if (availableAt <= now) {
        eligiblePending++
      } else {
        delayedPending++
        if (nextEligibleAt === undefined || availableAt < nextEligibleAt) {
          nextEligibleAt = availableAt
        }
      }
    }

    return {
      pendingTotal: this.pendingQueue.length,
      eligiblePending,
      delayedPending,
      nextEligibleAt
    }
  }

  async clearCompleted(): Promise<number> {
    if (!this.connected) return 0
    let count = 0
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'completed') {
        this.tasks.delete(id)
        count++
      }
    }
    return count
  }

  async clearFailed(): Promise<number> {
    if (!this.connected) return 0
    let count = 0
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'failed') {
        this.tasks.delete(id)
        count++
      }
    }
    return count
  }

  /**
   * 🔥 按类型和状态删除任务（用于服务重启时清理特定任务）
   *
   * @param type 任务类型（如 'url-swap'）
   * @param status 任务状态（'pending' 或 'running'）
   * @returns 删除的任务数量
   */
  async deleteTasksByTypeAndStatus(
    type: TaskType,
    status: 'pending' | 'running'
  ): Promise<number> {
    if (!this.connected) return 0

    let deletedCount = 0

    if (status === 'pending') {
      // 过滤出非指定类型的任务（保留其他任务）
      const originalLength = this.pendingQueue.length
      this.pendingQueue = this.pendingQueue.filter((task) => {
        if (task.type === type) {
          // 从tasks Map中删除
          this.tasks.delete(task.id)
          return false  // 不保留
        }
        return true  // 保留
      })

      deletedCount = originalLength - this.pendingQueue.length
    } else {
      // running状态
      const runningTasksToDelete: string[] = []

      // 找出需要删除的running任务
      for (const taskId of this.runningTasks) {
        const task = this.tasks.get(taskId)
        if (task && task.type === type) {
          runningTasksToDelete.push(taskId)
        }
      }

      // 删除任务
      for (const taskId of runningTasksToDelete) {
        this.runningTasks.delete(taskId)
        this.tasks.delete(taskId)
        deletedCount++
      }
    }

    if (deletedCount > 0) {
      console.log(`[Memory] 删除 ${deletedCount} 个 type=${type} status=${status} 的任务`)
    }

    return deletedCount
  }

  /**
   * 🔥 获取所有pending任务（用于批量任务取消）
   */
  async getAllPendingTasks(): Promise<Task[]> {
    if (!this.connected) return []
    return [...this.pendingQueue]
  }

  /**
   * 🔥 按 user + types 批量移除 pending 任务
   */
  async removePendingTasksByUserAndTypes(
    userId: number,
    types: TaskType[]
  ): Promise<{ removedCount: number; removedTaskIds: string[] }> {
    if (!this.connected) return { removedCount: 0, removedTaskIds: [] }

    const typeSet = new Set(types)
    const removedTaskIds: string[] = []

    this.pendingQueue = this.pendingQueue.filter((task) => {
      if (task.userId === userId && typeSet.has(task.type)) {
        removedTaskIds.push(task.id)
        this.tasks.delete(task.id)
        this.runningTasks.delete(task.id)
        return false
      }
      return true
    })

    if (removedTaskIds.length > 0) {
      console.log(`🗑️ 已从内存队列移除任务: userId=${userId}, removed=${removedTaskIds.length}`)
    }

    return { removedCount: removedTaskIds.length, removedTaskIds }
  }

  /**
   * 🔥 从队列中移除指定任务（用于批量任务取消）
   */
  async removeTask(taskId: string): Promise<void> {
    if (!this.connected) return

    // 从pending队列中移除
    const index = this.pendingQueue.findIndex((t) => t.id === taskId)
    if (index !== -1) {
      this.pendingQueue.splice(index, 1)
      console.log(`🗑️ 已从内存队列移除任务: ${taskId}`)
    }

    // 从tasks map中删除
    this.tasks.delete(taskId)

    // 从running set中删除（如果存在）
    this.runningTasks.delete(taskId)
  }
}
