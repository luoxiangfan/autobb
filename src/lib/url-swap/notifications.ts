/**
 * URL Swap 通知系统
 * src/lib/url-swap/notifications.ts
 *
 * 功能：发送换链接任务的通知到Dashboard智能洞察
 * - 任务状态变更通知（暂停、完成）
 * - URL变化通知
 * - 错误通知
 *
 * 🆕 新增(2025-01-03): 日志记录
 * 🔧 修改(2025-01-03): 移除邮件和Webhook功能，通知信息直接显示在Dashboard智能洞察中
 */

import { getDatabase } from '@/lib/db'

/**
 * 通知级别
 */
export type NotificationLevel = 'info' | 'warning' | 'error'

/**
 * 发送通知（核心函数）
 *
 * @param userId 用户ID
 * @param level 通知级别
 * @param title 通知标题
 * @param message 通知内容
 * @param metadata 附加元数据
 */
async function sendNotification(
  userId: number,
  level: NotificationLevel,
  title: string,
  message: string,
  metadata?: Record<string, any>
): Promise<void> {
  // 日志通知（用于调试）
  const levelEmoji = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌'
  }

  const prefix = levelEmoji[level] || '📢'
  console.log(`${prefix} [URL Swap Notification] [User ${userId}] ${title}`)
  console.log(`   ${message}`)
  if (metadata) {
    console.log(`   Metadata:`, JSON.stringify(metadata, null, 2))
  }
}

/**
 * 获取任务信息（用于生成通知内容）
 */
async function getTaskInfo(taskId: string): Promise<{
  userId: number
  offerId: number
  googleCampaignId: string | null
  currentFinalUrl: string | null
} | null> {
  const db = await getDatabase()
  const task = await db.queryOne<{
    user_id: number
    offer_id: number
    google_campaign_id: string | null
    current_final_url: string | null
  }>(`
    SELECT user_id, offer_id, google_campaign_id, current_final_url
    FROM url_swap_tasks
    WHERE id = ?
  `, [taskId])

  if (!task) return null

  // 转换为 camelCase
  return {
    userId: task.user_id,
    offerId: task.offer_id,
    googleCampaignId: task.google_campaign_id,
    currentFinalUrl: task.current_final_url
  }
}

// ==================== 公开的通知函数 ====================

/**
 * 任务暂停通知
 *
 * 触发时机：
 * - 任务因错误被自动暂停
 * - 用户手动暂停任务
 * - 达到最大失败次数
 *
 * @param taskId 任务ID
 * @param reason 暂停原因
 *
 * @example
 * await notifyUrlSwapTaskPaused('task-123', '连续失败3次，已自动暂停')
 */
export async function notifyUrlSwapTaskPaused(
  taskId: string,
  reason: string
): Promise<void> {
  const taskInfo = await getTaskInfo(taskId)
  if (!taskInfo) {
    console.error(`❌ Task not found: ${taskId}`)
    return
  }

  await sendNotification(
    taskInfo.userId,
    'warning',
    '换链接任务已暂停',
    `任务 ${taskId.substring(0, 8)}... 已暂停\n原因: ${reason}`,
    {
      taskId,
      offerId: taskInfo.offerId,
      googleCampaignId: taskInfo.googleCampaignId,
      reason
    }
  )
}

/**
 * 任务完成通知
 *
 * 触发时机：
 * - 任务达到 duration_days 限制自动完成
 * - 用户手动标记任务完成
 *
 * @param taskId 任务ID
 *
 * @example
 * await notifyUrlSwapTaskCompleted('task-123')
 */
export async function notifyUrlSwapTaskCompleted(
  taskId: string
): Promise<void> {
  const taskInfo = await getTaskInfo(taskId)
  if (!taskInfo) {
    console.error(`❌ Task not found: ${taskId}`)
    return
  }

  await sendNotification(
    taskInfo.userId,
    'info',
    '换链接任务已完成',
    `任务 ${taskId.substring(0, 8)}... 已完成\nOffer ID: ${taskInfo.offerId}`,
    {
      taskId,
      offerId: taskInfo.offerId,
      googleCampaignId: taskInfo.googleCampaignId
    }
  )
}

/**
 * URL变化通知
 *
 * 触发时机：
 * - 检测到推广链接的 Final URL 或 Final URL Suffix 发生变化
 * - Google Ads Campaign 已成功更新
 *
 * @param taskId 任务ID
 * @param oldUrl 旧的Final URL（含Suffix）
 * @param newUrl 新的Final URL（含Suffix）
 *
 * @example
 * await notifyUrlChanged(
 *   'task-123',
 *   'https://example.com?old=param',
 *   'https://example.com?new=param'
 * )
 */
export async function notifyUrlChanged(
  taskId: string,
  oldUrl: string,
  newUrl: string
): Promise<void> {
  const taskInfo = await getTaskInfo(taskId)
  if (!taskInfo) {
    console.error(`❌ Task not found: ${taskId}`)
    return
  }

  await sendNotification(
    taskInfo.userId,
    'info',
    '推广链接已自动更新',
    `任务 ${taskId.substring(0, 8)}... 检测到链接变化\n` +
    `旧链接: ${oldUrl.substring(0, 60)}...\n` +
    `新链接: ${newUrl.substring(0, 60)}...`,
    {
      taskId,
      offerId: taskInfo.offerId,
      googleCampaignId: taskInfo.googleCampaignId,
      oldUrl,
      newUrl
    }
  )
}

/**
 * 换链错误通知
 *
 * 触发时机：
 * - 推广链接解析失败
 * - Google Ads API更新失败
 * - 域名发生非预期变化
 * - 其他系统错误
 *
 * @param taskId 任务ID
 * @param errorMessage 错误信息
 *
 * @example
 * await notifySwapError('task-123', 'Google Ads API调用失败: 401 Unauthorized')
 */
export async function notifySwapError(
  taskId: string,
  errorMessage: string
): Promise<void> {
  const taskInfo = await getTaskInfo(taskId)
  if (!taskInfo) {
    console.error(`❌ Task not found: ${taskId}`)
    return
  }

  await sendNotification(
    taskInfo.userId,
    'error',
    '换链接任务出错',
    `任务 ${taskId.substring(0, 8)}... 执行失败\n错误: ${errorMessage}`,
    {
      taskId,
      offerId: taskInfo.offerId,
      googleCampaignId: taskInfo.googleCampaignId,
      errorMessage
    }
  )
}

