/**
 * 队列触发器工具函数
 *
 * 提供便捷的方法将任务添加到统一队列系统
 */

import { getQueueManager } from './queue/unified-queue-manager'
import type { SyncTaskData } from './queue/executors/sync-executor'
import type { ScrapeTaskData } from './queue/executors/scrape-executor'
import type { AIAnalysisTaskData } from './queue/executors/ai-analysis-executor'
import type { BackupTaskData } from './queue/executors/backup-executor'
import type { ExportTaskData } from './queue/executors/export-executor'
import type { EmailTaskData } from './queue/executors/email-executor'
import type { LinkCheckTaskData } from './queue/executors/link-check-executor'
import type { CleanupTaskData } from './queue/executors/cleanup-executor'

/**
 * 触发数据同步任务
 *
 * @param userId 用户ID
 * @param options 同步选项
 * @returns 任务ID
 */
export async function triggerDataSync(
  userId: number,
  options: {
    syncType?: 'manual' | 'auto'
    priority?: 'high' | 'normal' | 'low'
    googleAdsAccountId?: number
    startDate?: string
    endDate?: string
    maxRetries?: number
  } = {}
): Promise<string> {
  const queue = getQueueManager()

  const taskData: SyncTaskData = {
    userId,
    syncType: options.syncType || 'manual',
    googleAdsAccountId: options.googleAdsAccountId,
    startDate: options.startDate,
    endDate: options.endDate
  }

  const taskId = await queue.enqueue(
    'sync',
    taskData,
    userId,
    {
      priority: options.priority || (options.syncType === 'manual' ? 'high' : 'normal'),
      maxRetries: options.maxRetries || 3
    }
  )

  console.log(`📥 [SyncTrigger] 同步任务已入队: ${taskId}, 用户 #${userId}, 类型: ${taskData.syncType}`)
  return taskId
}

/**
 * 触发网页抓取任务（使用新队列系统）
 *
 * @param data 抓取任务数据
 * @returns 任务ID
 */
export async function triggerScrapeTask(data: ScrapeTaskData & { userId: number }): Promise<string> {
  const queue = getQueueManager()

  const { userId, ...scrapeData } = data

  const taskId = await queue.enqueue(
    'scrape',
    scrapeData,
    userId,
    {
      priority: 'normal',
      maxRetries: 3,
      requireProxy: true
    }
  )

  console.log(`📥 [ScrapeTrigger] 抓取任务已入队: ${taskId}, Offer #${scrapeData.offerId}`)
  return taskId
}

/**
 * 触发AI分析任务（独立任务）
 *
 * @param data 分析任务数据
 * @returns 任务ID
 */
export async function triggerAIAnalysis(
  data: AIAnalysisTaskData
): Promise<string> {
  const queue = getQueueManager()

  const taskId = await queue.enqueue(
    'ai-analysis',
    data,
    data.userId,
    {
      priority: 'normal',
      maxRetries: 2
    }
  )

  console.log(`📥 [AIAnalysisTrigger] AI分析任务已入队: ${taskId}, Offer #${data.offerId}`)
  return taskId
}

/**
 * 触发数据库备份任务
 *
 * @param data 备份任务数据
 * @returns 任务ID
 */
export async function triggerBackup(data: BackupTaskData & { createdBy?: number }): Promise<string> {
  const queue = getQueueManager()

  const { createdBy, ...backupData } = data

  const taskId = await queue.enqueue(
    'backup',
    backupData,
    createdBy || 0,  // 使用0作为系统任务的用户ID
    {
      priority: 'low',  // 备份通常是低优先级
      maxRetries: 2
    }
  )

  console.log(`📥 [BackupTrigger] 备份任务已入队: ${taskId}, 类型: ${backupData.backupType}`)
  return taskId
}

/**
 * 触发数据导出任务
 *
 * @param data 导出任务数据
 * @returns 任务ID
 */
export async function triggerExport(data: ExportTaskData): Promise<string> {
  const queue = getQueueManager()

  const taskId = await queue.enqueue(
    'export',
    data,
    data.userId,
    {
      priority: 'normal',  // 导出通常是中优先级
      maxRetries: 2
    }
  )

  console.log(`📥 [ExportTrigger] 导出任务已入队: ${taskId}, 类型: ${data.exportType}, 格式: ${data.format}`)
  return taskId
}

/**
 * 触发邮件发送任务
 *
 * @param data 邮件数据
 * @returns 任务ID
 */
export async function triggerEmail(data: EmailTaskData): Promise<string> {
  const queue = getQueueManager()

  const taskId = await queue.enqueue(
    'email',
    data,
    0,  // 使用0作为系统任务的用户ID
    {
      priority: data.type === 'alert' ? 'high' : 'normal',
      maxRetries: 3
    }
  )

  console.log(`📥 [EmailTrigger] 邮件任务已入队: ${taskId}, 收件人: ${data.to}, 类型: ${data.type}`)
  return taskId
}

/**
 * 触发链接检查任务
 *
 * @param data 链接检查数据
 * @returns 任务ID
 */
export async function triggerLinkCheck(data: LinkCheckTaskData): Promise<string> {
  const queue = getQueueManager()

  const taskId = await queue.enqueue(
    'link-check',
    data,
    data.userId || 0,  // 使用0作为系统任务的用户ID
    {
      priority: data.checkType === 'manual' ? 'high' : 'normal',
      maxRetries: 2
    }
  )

  console.log(`📥 [LinkCheckTrigger] 链接检查任务已入队: ${taskId}, 类型: ${data.checkType}`)
  return taskId
}

/**
 * 触发数据清理任务
 *
 * @param data 清理任务数据
 * @returns 任务ID
 */
export async function triggerCleanup(data: CleanupTaskData): Promise<string> {
  const queue = getQueueManager()

  const taskId = await queue.enqueue(
    'cleanup',
    data,
    0,  // 使用0作为系统任务的用户ID
    {
      priority: 'low',  // 清理任务通常是低优先级
      maxRetries: 2
    }
  )

  console.log(`📥 [CleanupTrigger] 数据清理任务已入队: ${taskId}, 类型: ${data.cleanupType}`)
  return taskId
}
