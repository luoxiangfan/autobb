/**
 * 队列配置管理
 *
 * 从system_settings表读取并发限制配置
 * 支持全局配置和用户级配置
 */

import { getDatabase } from '../db'
import type { QueueConfig } from './types' /**
 * 保存队列配置
 */
export async function saveQueueConfig(
  config: Partial<QueueConfig>,
  userId?: number
): Promise<void> {
  const db = await getDatabase()
  const effectiveUserId = userId ?? null

  try {
    const settings: Array<{ key: string; value: string }> = []

    if (config.globalConcurrency !== undefined && userId === undefined) {
      settings.push({ key: 'global_concurrency', value: config.globalConcurrency.toString() })
    }

    if (config.perUserConcurrency !== undefined) {
      settings.push({ key: 'per_user_concurrency', value: config.perUserConcurrency.toString() })
    }

    if (config.maxQueueSize !== undefined && userId === undefined) {
      settings.push({ key: 'max_queue_size', value: config.maxQueueSize.toString() })
    }

    if (config.taskTimeout !== undefined) {
      settings.push({ key: 'task_timeout', value: config.taskTimeout.toString() })
    }

    if (config.enablePriority !== undefined && userId === undefined) {
      settings.push({ key: 'enable_priority', value: config.enablePriority.toString() })
    }

    // 保存到数据库（使用DELETE+INSERT替代UPSERT，因为表没有唯一约束）
    for (const setting of settings) {
      // 1. 先删除已存在的配置
      let deleteSql = `
        DELETE FROM system_settings
        WHERE category = 'queue'
          AND config_key = ?
      `
      const deleteParams: any[] = [setting.key]

      if (effectiveUserId === null) {
        deleteSql += ` AND user_id IS NULL`
      } else {
        deleteSql += ` AND user_id = ?`
        deleteParams.push(effectiveUserId)
      }

      await db.exec(deleteSql, deleteParams)

      // 2. 插入新配置
      await db.exec(
        `
        INSERT INTO system_settings (category, config_key, config_value, user_id)
        VALUES ('queue', ?, ?, ?)
      `,
        [setting.key, setting.value, effectiveUserId]
      )
    }

    console.log(`[QueueConfig] 保存配置成功 (userId=${userId}):`, config)
  } catch (error: any) {
    console.error('[QueueConfig] 保存配置失败:', error.message)
    throw error
  }
}
