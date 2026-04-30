/**
 * 统一队列系统类型定义
 *
 * 支持Redis优先 + 内存回退架构
 * 支持代理IP池管理
 */

/**
 * 任务类型枚举
 */
export type TaskType =
  | 'scrape'          // 网页抓取
  | 'ai-analysis'     // AI分析（Enhanced优化）
  | 'sync'            // Google Ads数据同步
  | 'backup'          // 数据库备份
  | 'email'           // 邮件发送
  | 'export'          // 报表导出
  | 'link-check'      // 链接可用性检查
  | 'cleanup'         // 数据清理
  | 'offer-extraction'      // Offer信息提取（完整流程：URL解析 + 品牌识别 + AI分析）
  | 'batch-offer-creation'  // 批量Offer创建（父任务：协调多个offer-extraction子任务）
  | 'ad-creative'           // 广告创意生成（多轮优化 + Ad Strength评估）
  | 'campaign-publish'      // 🆕 广告系列发布到Google Ads（异步处理，避免504超时）
  | 'click-farm-trigger'    // 🆕 补点击触发请求（控制面任务：仅触发调度，不直接执行点击）
  | 'click-farm-batch'      // 🆕 补点击批次分发（将整小时点击拆分为小批量滚动入队）
  | 'click-farm'            // 🆕 补点击任务（单次点击执行，带代理和超时控制）
  | 'url-swap'              // 🆕 换链接任务（自动监测和更新Google Ads广告链接）
  | 'openclaw-strategy'      // 🆕 OpenClaw 自进化策略任务
  | 'affiliate-product-sync'  // 🆕 联盟商品同步任务（YP/PB）
  | 'openclaw-command'        // 🆕 OpenClaw 指令执行任务（可含确认流）
  | 'openclaw-affiliate-sync' // 🆕 OpenClaw 联盟成交/佣金快照同步任务
  | 'openclaw-report-send'    // 🆕 OpenClaw 每日报表投递任务
  | 'product-score-calculation' // 🆕 商品推荐指数计算任务
  | 'google-ads-campaign-sync' // 🆕 Google Ads广告系列同步任务
  | 'campaign-batch-create' // 🆕 批量从备份创建广告系列任务

export const ALL_TASK_TYPES: TaskType[] = [
  'scrape',
  'ai-analysis',
  'sync',
  'backup',
  'email',
  'export',
  'link-check',
  'cleanup',
  'offer-extraction',
  'batch-offer-creation',
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
  'product-score-calculation',
  'google-ads-campaign-sync',
  'campaign-batch-create',
]

/**
 * 任务优先级
 */
export type TaskPriority = 'high' | 'normal' | 'low'

/**
 * 任务状态
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

/**
 * 代理配置
 */
export interface ProxyConfig {
  host: string
  port: number
  username?: string
  password?: string
  protocol?: 'http' | 'https' | 'socks5'
  // 原始URL，用于IPRocket等动态代理服务
  originalUrl?: string
  // 国家代码
  country?: string
}

/**
 * 任务基础接口
 */
export interface Task<T = any> {
  id: string
  type: TaskType
  data: T
  userId: number
  /**
   * 触发该任务的上游 requestId（若由一次 HTTP 请求创建）。
   * 用于跨 API → 队列 → 下游服务的排障关联。
   */
  parentRequestId?: string
  priority: TaskPriority
  status: TaskStatus
  requireProxy?: boolean  // 是否需要代理IP
  proxyConfig?: ProxyConfig  // 指定代理配置
  createdAt: number
  /**
   * 任务最早可执行时间（用于并发受限时的退避/让路，避免同一个“不可执行任务”反复被 dequeue 造成饥饿）。
   * 仅影响 pending 队列排序；进入 running 时会被清理。
   */
  notBefore?: number
  /**
   * 因并发限制被退避的次数（用于调试与退避延迟计算）。
   */
  deferCount?: number
  startedAt?: number
  completedAt?: number
  error?: string
  retryCount?: number
  maxRetries?: number
}

/**
 * 任务执行器接口
 */
export interface TaskExecutor<T = any, R = any> {
  (task: Task<T>): Promise<R>
}

/**
 * 队列统计信息
 */
export interface QueueStats {
  total: number
  pending: number
  running: number
  completed: number
  failed: number
  byType: Record<TaskType, number>
  // 🔥 运行中任务按类型统计（用于并发利用率展示）
  byTypeRunning: Record<TaskType, number>
  byUser: Record<number, {
    pending: number
    running: number
    completed: number
    failed: number
    // 🔥 按“核心/非核心”细分完成/失败（用于管理台快速判断SLA风险）
    coreCompleted?: number
    backgroundCompleted?: number
    coreFailed?: number
    backgroundFailed?: number
  }>
}

/**
 * pending 任务可执行性统计
 *
 * 用于区分：
 * - eligiblePending: 当前时间已到，可立即被 dequeue 的 pending 任务
 * - delayedPending: 因 notBefore/scheduledAt/重试延迟/退避而暂不可执行的 pending 任务
 */
export interface PendingEligibilityStats {
  pendingTotal: number
  eligiblePending: number
  delayedPending: number
  /**
   * 最早的“下一次可执行时间”（毫秒时间戳）。
   * 若 delayedPending=0 则为 undefined。
   */
  nextEligibleAt?: number
}

/**
 * 运行中任务并发快照（用于跨进程并发门控）
 */
export interface RunningConcurrencySnapshot {
  globalCoreRunning: number
  userCoreRunning: number
  typeRunning: number
}

/**
 * 队列配置
 */
export interface QueueConfig {
  // 并发控制
  globalConcurrency: number      // 全局最大并发
  perUserConcurrency: number     // 单用户最大并发
  perTypeConcurrency: Record<TaskType, number>  // 单类型最大并发

  /**
   * 是否在 enqueue 时自动启动队列处理循环（并自动注册执行器）。
   *
   * - `true`（默认）：保持旧行为，任何调用 enqueue 的进程都会启动处理循环（适用于单进程/简化部署）。
   * - `false`：仅连接存储并写入 pending；由独立 worker 进程负责 start() 与执行（适用于拆分 worker）。
   */
  autoStartOnEnqueue?: boolean

  // 队列限制
  maxQueueSize: number           // 最大队列长度
  taskTimeout: number            // 任务超时时间(ms)

  // 重试策略
  defaultMaxRetries: number      // 默认最大重试次数
  retryDelay: number             // 重试延迟(ms)

  // Redis配置（可选）
  redisUrl?: string              // Redis连接URL
  redisKeyPrefix?: string        // Redis键前缀

  // 代理配置
  proxyPool?: ProxyConfig[]      // 代理IP池
  proxyRotation?: boolean        // 是否自动轮换代理

  // 队列实例标识（用于日志与诊断）
  instanceName?: string
}

/**
 * 队列存储适配器接口
 */
export interface QueueStorageAdapter {
  // 任务操作
  enqueue(task: Task): Promise<void>
  dequeue(type?: TaskType): Promise<Task | null>
  peek(): Promise<Task | null>

  // 状态管理
  updateTaskStatus(taskId: string, status: TaskStatus, error?: string): Promise<void>
  getTask(taskId: string): Promise<Task | null>

  // 统计查询
  getStats(): Promise<QueueStats>
  getRunningTasks(): Promise<Task[]>
  getPendingTasks(type?: TaskType): Promise<Task[]>
  /**
   * 可选：返回跨进程 running 快照，用于多实例部署下的并发门控。
   * `excludeTaskId` 用于排除当前刚 dequeue 的任务，避免“把自己也算进已在运行”导致误判。
   */
  getRunningConcurrencySnapshot?(params: {
    userId: number
    type: TaskType
    excludeTaskId?: string
  }): Promise<RunningConcurrencySnapshot>

  // 清理操作
  clearCompleted(): Promise<number>
  clearFailed(): Promise<number>

  // 🔥 按类型和状态删除任务（用于服务重启时清理特定任务）
  deleteTasksByTypeAndStatus?(
    type: TaskType,
    status: 'pending' | 'running'
  ): Promise<number>

  // 🔥 启动时清理操作（可选，Redis适配器实现）
  clearAllUnfinished?(): Promise<{
    pendingCleared: number
    runningCleared: number
    userQueuesCleared: number
    totalCleared: number
  }>

  /**
   * 🔥 启动时恢复 running 僵尸任务（可选，Redis适配器实现）
   * 将 running 集合中的任务重新放回 pending 队列（pending:all / pending:type / user pending），避免重启后卡死。
   */
  requeueAllRunningOnStartup?(): Promise<{
    requeuedCount: number
    cleanedMissingCount: number
    taskIds: string[]
  }>

  /**
   * 🔥 修复 pending 索引（可选，Redis适配器实现）
   * 解决 tasks hash 中 status=pending 但未进入 pending zset 的“孤儿任务”，导致队列永远 dequeue 不到。
   */
  repairPendingIndexes?(): Promise<{
    repairedCount: number
    scannedCount: number
  }>

  // 🔥 超时任务清理（可选，Redis适配器实现）
  cleanupStaleRunningTasks?(timeoutMs?: number): Promise<{
    cleanedCount: number
    cleanedTaskIds: string[]
  }>

  // 🔥 无效用户任务清理（可选，Redis适配器实现）
  cleanupInvalidUserTasks?(): Promise<{
    cleanedCount: number
    cleanedTaskIds: string[]
  }>

  // 🔥 批量任务取消支持（可选）
  getAllPendingTasks?(): Promise<Task[]>
  removeTask?(taskId: string): Promise<void>
  removePendingTasksByUserAndTypes?(
    userId: number,
    types: TaskType[]
  ): Promise<{ removedCount: number; removedTaskIds: string[] }>

  /**
   * 🔥 pending 可执行性统计（可选）
   * 用于管理台解释“队列中但不执行”的常见原因（scheduledAt/notBefore）。
   */
  getPendingEligibilityStats?(): Promise<PendingEligibilityStats>

  // 连接管理
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
}

/**
 * 代理管理器接口
 */
export interface ProxyManager {
  // 获取可用代理
  getProxy(): ProxyConfig | null

  // 标记代理状态
  markProxyFailed(proxy: ProxyConfig): void
  markProxySuccess(proxy: ProxyConfig): void

  // 代理池管理
  addProxy(proxy: ProxyConfig): void
  removeProxy(proxy: ProxyConfig): void
  getAvailableProxies(): ProxyConfig[]

  // 统计信息
  getStats(): {
    total: number
    available: number
    failed: number
  }
}
