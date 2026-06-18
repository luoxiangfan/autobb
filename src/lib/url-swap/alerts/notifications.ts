/**
 * URL Swap 通知系统
 * src/lib/url-swap/alerts/notifications.ts
 *
 * 功能：发送换链接任务的通知到Dashboard智能洞察
 * - 任务状态变更通知（暂停、完成）
 * - URL变化通知
 * - 错误通知
 */

import { getDatabase } from '@/lib/db'

/**
 * 通知级别
 */
export type NotificationLevel = 'info' | 'warning' | 'error'

/**
 * 发送通知（核心函数）
 */
async function sendNotification(
  userId: number,
  level: NotificationLevel,
  title: string,
  message: string,
  metadata?: Record<string, any>
): Promise<void> {
  const levelEmoji = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌',
  }

  const prefix = levelEmoji[level] || '📢'
  console.log(`${prefix} [URL Swap Notification] [User ${userId}] ${title}`)
  console.log(`   ${message}`)
  if (metadata) {
    console.log(`   Metadata:`, JSON.stringify(metadata, null, 2))
  }
}

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
  }>(
    `
    SELECT user_id, offer_id, google_campaign_id, current_final_url
    FROM url_swap_tasks
    WHERE id = ?
  `,
    [taskId]
  )

  if (!task) return null

  return {
    userId: task.user_id,
    offerId: task.offer_id,
    googleCampaignId: task.google_campaign_id,
    currentFinalUrl: task.current_final_url,
  }
}

export async function notifyUrlSwapTaskPaused(taskId: string, reason: string): Promise<void> {
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
      reason,
    }
  )
}

export async function notifySwapError(taskId: string, errorMessage: string): Promise<void> {
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
      errorMessage,
    }
  )
}
