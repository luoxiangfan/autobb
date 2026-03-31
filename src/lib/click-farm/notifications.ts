// 补点击通知工具
// src/lib/click-farm/notifications.ts

import { getDatabase } from '@/lib/db';

// 🔧 修复(2025-01-01): PostgreSQL布尔类型兼容性
const IS_DELETED_FALSE = 'IS_DELETED_FALSE'

/**
 * 通知类型
 */
export type ClickFarmNotificationType =
  | 'task_paused'      // 任务已暂停
  | 'task_completed'   // 任务已完成
  | 'task_resumed';    // 任务已恢复

/**
 * 创建通知记录（存储在JSON字段中，用于UI展示）
 */
export interface ClickFarmNotification {
  id: string;
  type: ClickFarmNotificationType;
  task_id: string;
  title: string;
  message: string;
  created_at: string;
  read: boolean;
}

/**
 * 记录任务通知到日志表
 * 注意：这个简化版本只是记录日志，UI从任务状态推断通知
 * 完整版本可以创建独立的notifications表
 */
export async function logClickFarmEvent(
  userId: number,
  taskId: string,
  type: ClickFarmNotificationType,
  title: string,
  message: string
): Promise<void> {
  const db = getDatabase();

  // 记录到任务备注字段（简化方案）
  // 或者可以创建专门的事件日志表
  console.log(`[ClickFarm Notification] User ${userId} - ${type}:`, {
    task_id: taskId,
    title,
    message,
    timestamp: new Date().toISOString()
  });

  // 可选：发送到外部通知服务（邮件、Slack等）
  // await sendExternalNotification(userId, type, title, message);
}

/**
 * 任务暂停通知
 */
export async function notifyTaskPaused(
  userId: number,
  taskId: string,
  reason: string,
  message: string
): Promise<void> {
  await logClickFarmEvent(
    userId,
    taskId,
    'task_paused',
    '补点击任务已暂停',
    `任务 ${taskId} 因 ${reason} 被暂停：${message}`
  );
}

/**
 * 任务完成通知
 */
export async function notifyTaskCompleted(
  userId: number,
  taskId: string,
  totalClicks: number,
  successClicks: number
): Promise<void> {
  const successRate = totalClicks > 0 ? ((successClicks / totalClicks) * 100).toFixed(1) : '0';

  await logClickFarmEvent(
    userId,
    taskId,
    'task_completed',
    '补点击任务已完成',
    `任务 ${taskId} 已完成，总计 ${totalClicks} 次点击，成功率 ${successRate}%`
  );
}

/**
 * 任务恢复通知
 */
export async function notifyTaskResumed(
  userId: number,
  taskId: string
): Promise<void> {
  await logClickFarmEvent(
    userId,
    taskId,
    'task_resumed',
    '补点击任务已恢复',
    `任务 ${taskId} 已恢复运行`
  );
}

/**
 * 批量获取用户的通知（从任务状态推断）
 * 简化版本：返回需要用户关注的任务状态变化
 */
export async function getUserNotifications(userId: number): Promise<ClickFarmNotification[]> {
  const db = getDatabase();

  // 查询最近发生状态变化的任务
  const tasks = await db.query<any>(`
    SELECT
      id,
      status,
      pause_reason,
      pause_message,
      paused_at,
      completed_at,
      updated_at
    FROM click_farm_tasks
    WHERE user_id = ?
      AND IS_DELETED_FALSE
      AND (
        (status = 'paused' AND paused_at > datetime('now', '-24 hours'))
        OR (status = 'completed' AND completed_at > datetime('now', '-24 hours'))
      )
    ORDER BY updated_at DESC
    LIMIT 10
  `, [userId]);

  return tasks.map(task => {
    if (task.status === 'paused') {
      return {
        id: `${task.id}-paused`,
        type: 'task_paused' as ClickFarmNotificationType,
        task_id: task.id,
        title: '任务已暂停',
        message: task.pause_message || '任务已被暂停',
        created_at: task.paused_at,
        read: false,
      };
    } else {
      return {
        id: `${task.id}-completed`,
        type: 'task_completed' as ClickFarmNotificationType,
        task_id: task.id,
        title: '任务已完成',
        message: `任务 #${task.id.slice(0, 8)} 已成功完成`,
        created_at: task.completed_at,
        read: false,
      };
    }
  });
}
