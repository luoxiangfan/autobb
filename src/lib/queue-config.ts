/**
 * 队列配置管理
 *
 * 从system_settings表读取并发限制配置
 * 支持全局配置和用户级配置
 */

import { getDatabase } from './db'
import { QueueConfig } from './scrape-queue-manager'

/**
 * 获取队列配置（优先级：用户配置 > 全局配置 > 默认配置）
 */
export async function getQueueConfig(userId?: number): Promise<Partial<QueueConfig>> {
  const db = await getDatabase()
  const config: Partial<QueueConfig> = {}

  try {
    // 1. 读取全局配置
    const globalSettings = await db.query(`
      SELECT config_key, config_value
      FROM system_settings
      WHERE category = 'queue'
        AND user_id IS NULL
    `, []) as Array<{ config_key: string; config_value: string }>

    for (const setting of globalSettings) {
      switch (setting.config_key) {
        case 'global_concurrency':
          config.globalConcurrency = parseInt(setting.config_value, 10)
          break
        case 'per_user_concurrency':
          config.perUserConcurrency = parseInt(setting.config_value, 10)
          break
        case 'max_queue_size':
          config.maxQueueSize = parseInt(setting.config_value, 10)
          break
        case 'task_timeout':
          config.taskTimeout = parseInt(setting.config_value, 10)
          break
        case 'enable_priority':
          config.enablePriority = setting.config_value === 'true'
          break
      }
    }

    // 2. 如果提供了userId，读取用户级配置（覆盖全局配置）
    if (userId !== undefined) {
      const userSettings = await db.query(`
        SELECT config_key, config_value
        FROM system_settings
        WHERE category = 'queue'
          AND user_id = ?
      `, [userId]) as Array<{ config_key: string; config_value: string }>

      for (const setting of userSettings) {
        switch (setting.config_key) {
          case 'per_user_concurrency':
            config.perUserConcurrency = parseInt(setting.config_value, 10)
            break
          case 'task_timeout':
            config.taskTimeout = parseInt(setting.config_value, 10)
            break
        }
      }
    }

    console.log(`[QueueConfig] 加载配置 (userId=${userId}):`, config)
  } catch (error: any) {
    console.error('[QueueConfig] 加载配置失败:', error.message)
  }

  return config
}

/**
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
      await db.exec(`
        INSERT INTO system_settings (category, config_key, config_value, user_id)
        VALUES ('queue', ?, ?, ?)
      `, [setting.key, setting.value, effectiveUserId])
    }

    console.log(`[QueueConfig] 保存配置成功 (userId=${userId}):`, config)
  } catch (error: any) {
    console.error('[QueueConfig] 保存配置失败:', error.message)
    throw error
  }
}

/**
 * 初始化默认配置（如果不存在）
 */
export async function initializeDefaultQueueConfig(): Promise<void> {
  const db = await getDatabase()

  try {
    // 检查是否已有配置
    const existing = await db.queryOne(`
      SELECT COUNT(*) as count
      FROM system_settings
      WHERE category = 'queue'
    `, []) as { count: number }

    if (existing.count > 0) {
      console.log('[QueueConfig] 配置已存在，跳过初始化')
      return
    }

    // 插入默认配置
    const defaultSettings = [
      { key: 'global_concurrency', value: '8', description: '全局并发限制（所有用户）' },
      { key: 'per_user_concurrency', value: '2', description: '单用户并发限制' },
      { key: 'max_queue_size', value: '1000', description: '队列最大长度' },
      { key: 'task_timeout', value: '300000', description: '任务超时时间（毫秒）' },
      { key: 'enable_priority', value: 'true', description: '是否启用优先级队列' },
    ]

    for (const setting of defaultSettings) {
      await db.exec(`
        INSERT INTO system_settings (category, config_key, config_value, user_id, description)
        VALUES ('queue', ?, ?, NULL, ?)
      `, [setting.key, setting.value, setting.description])
    }

    console.log('[QueueConfig] 默认配置初始化成功')
  } catch (error: any) {
    console.error('[QueueConfig] 初始化默认配置失败:', error.message)
  }
}
