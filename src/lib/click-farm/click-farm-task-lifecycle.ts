/**
 * Click-farm task lifecycle: create, update, stop/restart/pause.
 */
import { getDatabase, toDbJsonObjectField } from '@/lib/db'
import { getDateInTimezone } from '@/lib/common/server'
import { generateNextRunAt } from './scheduler'
import { removePendingClickFarmQueueTasksByTaskIds } from './queue-cleanup'
import type {
  ClickFarmTask,
  CreateClickFarmTaskRequest,
  UpdateClickFarmTaskRequest,
  PauseReason,
} from './click-farm-types'
import { getClickFarmTaskById } from './click-farm-queries'

export async function createClickFarmTask(
  userId: number,
  input: CreateClickFarmTaskRequest
): Promise<ClickFarmTask> {
  const db = await getDatabase()

  // 🆕 scheduled_start_date默认为“任务时区当天”，避免 UTC 日期导致西半球任务延后一天启动
  const taskTimezone = input.timezone || 'America/New_York'
  const scheduledStartDate =
    input.scheduled_start_date || getDateInTimezone(new Date(), taskTimezone)

  console.log('[createClickFarmTask] 开始插入任务:', {
    userId,
    offer_id: input.offer_id,
    daily_click_count: input.daily_click_count,
    hourly_distribution_length: input.hourly_distribution?.length,
    timezone: input.timezone,
  })

  try {
    // 🔧 修复(2025-12-31): 使用标准 UUID 格式（带 -），PostgreSQL 的 uuid 类型可以正确识别
    const taskId = crypto.randomUUID().toLowerCase()

    console.log('[createClickFarmTask] 生成任务ID:', taskId)

    // 🔧 修复(2026-02-20): PostgreSQL JSONB 传原生数组，避免双重编码
    const hourlyDistributionJson = toDbJsonObjectField(input.hourly_distribution, [])
    const refererConfigJson = input.referer_config ? JSON.stringify(input.referer_config) : null

    const result = await db.exec(
      `
      INSERT INTO click_farm_tasks (
        id, user_id, offer_id, daily_click_count, start_time, end_time,
        duration_days, scheduled_start_date, hourly_distribution, timezone, referer_config
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        taskId, // 🔧 修复：使用标准 UUID 格式
        userId,
        input.offer_id,
        input.daily_click_count,
        input.start_time,
        input.end_time,
        input.duration_days,
        scheduledStartDate,
        hourlyDistributionJson,
        taskTimezone,
        refererConfigJson,
      ]
    )

    console.log('[createClickFarmTask] INSERT结果:', result)

    const insertedId = taskId
    console.log('[createClickFarmTask] 使用生成的ID:', insertedId)

    const task = (await getClickFarmTaskById(insertedId, userId))!

    // 🔧 修复(2025-12-31): 详细日志追踪问题
    console.log('[createClickFarmTask] 任务对象:', {
      id: task?.id,
      id_type: typeof task?.id,
      start_time: task?.start_time,
      start_time_type: typeof task?.start_time,
      end_time: task?.end_time,
      end_time_type: typeof task?.end_time,
      timezone: task?.timezone,
      timezone_type: typeof task?.timezone,
      scheduled_start_date: task?.scheduled_start_date,
      scheduled_start_date_type: typeof task?.scheduled_start_date,
      hourly_distribution: task?.hourly_distribution,
      hourly_distribution_type: typeof task?.hourly_distribution,
      hourly_distribution_isArray: Array.isArray(task?.hourly_distribution),
    })

    // 🆕 计算并设置 next_run_at
    const nextRunAt = generateNextRunAt(task.timezone, task)
    await db.exec(
      `
      UPDATE click_farm_tasks
      SET next_run_at = ?, updated_at = NOW()
      WHERE id = ?
    `,
      [nextRunAt.toISOString(), task.id]
    )

    // 重新获取更新后的任务
    return (await getClickFarmTaskById(insertedId, userId))!
  } catch (error) {
    console.error('[createClickFarmTask] 错误:', error)
    if (error instanceof Error) {
      console.error('[createClickFarmTask] 错误消息:', error.message)
      console.error('[createClickFarmTask] 错误堆栈:', error.stack)
    }
    throw error
  }
}

export async function updateClickFarmTask(
  id: number | string,
  userId: number,
  updates: UpdateClickFarmTaskRequest
): Promise<ClickFarmTask> {
  const db = await getDatabase()

  const fields: string[] = []
  const values: any[] = []

  if (updates.daily_click_count !== undefined) {
    fields.push('daily_click_count = ?')
    values.push(updates.daily_click_count)
  }

  if (updates.start_time !== undefined) {
    fields.push('start_time = ?')
    values.push(updates.start_time)
  }

  if (updates.end_time !== undefined) {
    fields.push('end_time = ?')
    values.push(updates.end_time)
  }

  if (updates.duration_days !== undefined) {
    fields.push('duration_days = ?')
    values.push(updates.duration_days)
  }

  // 🆕 支持更新scheduled_start_date
  if (updates.scheduled_start_date !== undefined) {
    fields.push('scheduled_start_date = ?')
    values.push(updates.scheduled_start_date)
  }

  if (updates.hourly_distribution !== undefined) {
    fields.push('hourly_distribution = ?')
    values.push(toDbJsonObjectField(updates.hourly_distribution, []))
  }

  // 🆕 支持更新timezone
  if (updates.timezone !== undefined) {
    fields.push('timezone = ?')
    values.push(updates.timezone)
  }

  // 🔧 修复(2025-12-30): 支持更新referer_config
  if (updates.referer_config !== undefined) {
    fields.push('referer_config = ?')
    values.push(updates.referer_config ? JSON.stringify(updates.referer_config) : null)
  }

  if (fields.length === 0) {
    throw new Error('No fields to update')
  }

  fields.push('updated_at = NOW()')
  values.push(id, userId)

  await db.exec(
    `
    UPDATE click_farm_tasks
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ? AND is_deleted = FALSE
  `,
    values
  )

  return (await getClickFarmTaskById(id, userId))!
}

/**
 * 删除任务（软删除）
 */
export async function deleteClickFarmTask(id: number | string, userId: number): Promise<void> {
  const db = await getDatabase()

  await db.exec(
    `
    UPDATE click_farm_tasks
    SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW()
    WHERE id = ? AND user_id = ?
  `,
    [id, userId]
  )

  try {
    await removePendingClickFarmQueueTasksByTaskIds([id], userId)
  } catch (error) {
    console.warn(`[click-farm] 删除任务后清理队列失败: ${id}`, error)
  }
}

/**
 * 暂停任务（手动）
 */
export async function stopClickFarmTask(
  id: number | string,
  userId: number
): Promise<ClickFarmTask> {
  const db = await getDatabase()

  await db.exec(
    `
    UPDATE click_farm_tasks
    SET status = 'stopped', updated_at = NOW()
    WHERE id = ? AND user_id = ? AND status IN ('pending', 'running', 'paused')
  `,
    [id, userId]
  )

  try {
    await removePendingClickFarmQueueTasksByTaskIds([id], userId)
  } catch (error) {
    console.warn(`[click-farm] 停止任务后清理队列失败: ${id}`, error)
  }

  return (await getClickFarmTaskById(id, userId))!
}

/**
 * 重启任务
 */
export async function restartClickFarmTask(
  id: number | string,
  userId: number
): Promise<ClickFarmTask> {
  const db = await getDatabase()

  await db.exec(
    `
    UPDATE click_farm_tasks
    SET status = 'running',
        pause_reason = NULL,
        pause_message = NULL,
        paused_at = NULL,
        updated_at = NOW()
    WHERE id = ? AND user_id = ? AND status IN ('stopped', 'paused', 'pending')
  `,
    [id, userId]
  )

  return (await getClickFarmTaskById(id, userId))!
}

/**
 * 暂停任务（代理缺失）
 */
export async function pauseClickFarmTask(
  id: number | string,
  reason: string,
  message: string
): Promise<void> {
  const db = await getDatabase()

  await db.exec(
    `
    UPDATE click_farm_tasks
    SET status = 'paused',
        pause_reason = ?,
        pause_message = ?,
        paused_at = NOW(),
        updated_at = NOW()
    WHERE id = ?
  `,
    [reason, message, id]
  )

  try {
    await removePendingClickFarmQueueTasksByTaskIds([String(id)])
  } catch (error) {
    console.warn(`[click-farm] 暂停任务后清理队列失败: ${id}`, error)
  }
}

/**
 * 🔧 优化 (2026-04-15): 批量暂停补点击任务（按 offer_id）
 */
export async function pauseClickFarmTasksByOfferId(
  offerId: number,
  options?: {
    reason?: PauseReason
    message?: string | null
  }
): Promise<number> {
  const db = await getDatabase()
  const nowSql = 'NOW()'
  const reason = options?.reason ?? 'offer_deactivated'
  const message = options?.message ?? 'Offer 关联的广告系列已删除'

  const pendingRows = await db.query<{ id: string | number }>(
    `
    SELECT id FROM click_farm_tasks
    WHERE offer_id = ? AND status IN ('pending', 'running') AND is_deleted = FALSE
  `,
    [offerId]
  )
  const taskIdsToClean = (pendingRows || []).map((row) => String(row.id).trim()).filter(Boolean)

  const result = await db.exec(
    `
    UPDATE click_farm_tasks
    SET status = 'paused',
        pause_reason = ?,
        pause_message = ?,
        updated_at = ${nowSql},
        paused_at = ${nowSql}
    WHERE offer_id = ? AND status IN ('pending', 'running') AND is_deleted = FALSE
  `,
    [reason, message, offerId]
  )

  if (taskIdsToClean.length > 0) {
    try {
      await removePendingClickFarmQueueTasksByTaskIds(taskIdsToClean)
    } catch (error) {
      console.warn(`[click-farm] 按 offer 暂停后清理队列失败 (offerId=${offerId}):`, error)
    }
  }

  return result.changes || 0
}

export async function updateTaskStatus(
  id: number | string,
  status: string,
  nextRunAt?: Date
): Promise<void> {
  const db = await getDatabase()

  if (nextRunAt) {
    await db.exec(
      `
      UPDATE click_farm_tasks
      SET status = ?,
          next_run_at = ?,
          updated_at = NOW()
      WHERE id = ?
    `,
      [status, nextRunAt.toISOString(), id]
    )
  } else {
    await db.exec(
      `
      UPDATE click_farm_tasks
      SET status = ?,
          updated_at = NOW()
      WHERE id = ?
    `,
      [status, id]
    )
  }
}
