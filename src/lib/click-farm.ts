// 补点击功能数据访问层
// src/lib/click-farm.ts

import { getDatabase } from './db';
import { generateNextRunAt } from './click-farm/scheduler';
import { getDateInTimezone, getHourInTimezone, createDateInTimezone } from './timezone-utils';
import { estimateTraffic } from './click-farm/distribution';
import { normalizeDateOnly, normalizeTimestampToIso } from './db-datetime';
import { boolParam, datetimeMinusHours } from './db-helpers';
import { removePendingClickFarmQueueTasksByTaskIds } from './click-farm/queue-cleanup';
import { parseJsonField, toDbJsonObjectField } from './json-field';
import type {
  ClickFarmTask,
  ClickFarmTaskListItem,  // 🆕 导入任务列表项类型
  ClickFarmTaskStatus,  // 🆕 导入状态类型
  CreateClickFarmTaskRequest,
  UpdateClickFarmTaskRequest,
  TaskFilters,
  ClickFarmStats,
  HourlyDistribution,
  DailyHistoryEntry
} from './click-farm-types';

// 🔧 修复(2025-01-01): PostgreSQL布尔类型兼容性
const IS_DELETED_FALSE = 'IS_DELETED_FALSE'
const IS_DELETED_TRUE = 'IS_DELETED_TRUE'

const CLICK_FARM_STATS_BATCH_SIZE = (() => {
  const n = parseInt(process.env.CLICK_FARM_STATS_BATCH_SIZE || '20', 10)
  return Number.isFinite(n) && n > 0 ? n : 20
})()

const CLICK_FARM_STATS_FLUSH_INTERVAL_MS = (() => {
  const n = parseInt(process.env.CLICK_FARM_STATS_FLUSH_INTERVAL_MS || '2000', 10)
  return Number.isFinite(n) && n >= 0 ? n : 2000
})()

const CLICK_FARM_MAX_HISTORY_DAYS = (() => {
  const n = parseInt(process.env.CLICK_FARM_MAX_HISTORY_DAYS || '60', 10)
  return Number.isFinite(n) && n > 0 ? n : 60
})()

type HourlyDelta = { actual: number; success: number; failed: number }

type PendingStatsUpdate = {
  total: number
  success: number
  failed: number
  hourly: Map<number, HourlyDelta>
  timer?: NodeJS.Timeout
}

const pendingStatsUpdates = new Map<string, PendingStatsUpdate>()
const pendingFlushLocks = new Map<string, Promise<void>>()

function shiftDateStr(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().split('T')[0]
}

function pruneDailyHistoryByDays(history: DailyHistoryEntry[], todayStr: string): DailyHistoryEntry[] {
  if (!CLICK_FARM_MAX_HISTORY_DAYS || CLICK_FARM_MAX_HISTORY_DAYS <= 0) return history
  const cutoff = shiftDateStr(todayStr, -(CLICK_FARM_MAX_HISTORY_DAYS - 1))
  return history.filter((entry) => entry?.date && entry.date >= cutoff)
}

function recordHourlyDelta(entry: PendingStatsUpdate, hour: number, success: boolean) {
  const current = entry.hourly.get(hour) || { actual: 0, success: 0, failed: 0 }
  current.actual += 1
  if (success) current.success += 1
  else current.failed += 1
  entry.hourly.set(hour, current)
}

function scheduleStatsFlush(taskId: string, entry: PendingStatsUpdate) {
  if (entry.timer || CLICK_FARM_STATS_FLUSH_INTERVAL_MS <= 0) return
  entry.timer = setTimeout(() => {
    void flushPendingStats(taskId).catch((error) => {
      console.warn(`[click-farm] 批量统计刷新失败: ${taskId}`, error)
    })
  }, CLICK_FARM_STATS_FLUSH_INTERVAL_MS)
  entry.timer.unref?.()
}

async function flushPendingStats(taskId: string): Promise<void> {
  const existing = pendingFlushLocks.get(taskId)
  if (existing) return existing

  const flushPromise = (async () => {
    const entry = pendingStatsUpdates.get(taskId)
    if (!entry || entry.total <= 0) return

    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = undefined
    }

    pendingStatsUpdates.delete(taskId)

    const snapshot: PendingStatsUpdate = {
      total: entry.total,
      success: entry.success,
      failed: entry.failed,
      hourly: new Map(entry.hourly),
    }

    try {
      const db = await getDatabase()
      const taskRow = await db.queryOne<any>(`
        SELECT id, daily_history, hourly_distribution, timezone, started_at
        FROM click_farm_tasks
        WHERE id = ?
      `, [taskId])

      if (!taskRow) {
        return
      }

      const task = parseClickFarmTask(taskRow)
      const todayInTaskTimezone = getTodayInTaskTimezone(task)

      let dailyHistory: DailyHistoryEntry[] = task.daily_history && task.daily_history.length > 0
        ? [...task.daily_history]
        : []

      let todayEntry = dailyHistory.find(entryItem => entryItem.date === todayInTaskTimezone)
      if (!todayEntry) {
        todayEntry = {
          date: todayInTaskTimezone,
          target: task.hourly_distribution.reduce((sum, count) => sum + count, 0),
          actual: 0,
          success: 0,
          failed: 0,
          hourly_breakdown: task.hourly_distribution.map(target => ({
            target,
            actual: 0,
            success: 0,
            failed: 0
          }))
        }
        dailyHistory.push(todayEntry)
      }

      if (!todayEntry.hourly_breakdown || todayEntry.hourly_breakdown.length !== 24) {
        todayEntry.hourly_breakdown = task.hourly_distribution.map(target => ({
          target,
          actual: 0,
          success: 0,
          failed: 0
        }))
      }

      todayEntry.actual += snapshot.total
      todayEntry.success += snapshot.success
      todayEntry.failed += snapshot.failed

      for (const [hour, delta] of snapshot.hourly.entries()) {
        const hourEntry = todayEntry.hourly_breakdown[hour]
        if (!hourEntry) continue
        hourEntry.actual += delta.actual
        hourEntry.success += delta.success
        hourEntry.failed += delta.failed
      }

      dailyHistory = pruneDailyHistoryByDays(dailyHistory, todayInTaskTimezone)

      await db.exec(`
        UPDATE click_farm_tasks
        SET total_clicks = total_clicks + ?,
            success_clicks = success_clicks + ?,
            failed_clicks = failed_clicks + ?,
            daily_history = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `, [
        snapshot.total,
        snapshot.success,
        snapshot.failed,
        toDbJsonObjectField(dailyHistory, db.type, []),
        taskId
      ])
    } catch (error) {
      const merged = pendingStatsUpdates.get(taskId) || {
        total: 0,
        success: 0,
        failed: 0,
        hourly: new Map()
      }
      merged.total += snapshot.total
      merged.success += snapshot.success
      merged.failed += snapshot.failed
      for (const [hour, delta] of snapshot.hourly.entries()) {
        const current = merged.hourly.get(hour) || { actual: 0, success: 0, failed: 0 }
        current.actual += delta.actual
        current.success += delta.success
        current.failed += delta.failed
        merged.hourly.set(hour, current)
      }
      pendingStatsUpdates.set(taskId, merged)
      scheduleStatsFlush(taskId, merged)
      throw error
    }
  })()

  pendingFlushLocks.set(taskId, flushPromise)
  try {
    await flushPromise
  } finally {
    pendingFlushLocks.delete(taskId)
  }
}

/**
 * 创建补点击任务
 */
export async function createClickFarmTask(
  userId: number,
  input: CreateClickFarmTaskRequest
): Promise<ClickFarmTask> {
  const db = await getDatabase();

  // 🆕 scheduled_start_date默认为“任务时区当天”，避免 UTC 日期导致西半球任务延后一天启动
  const taskTimezone = input.timezone || 'America/New_York'
  const scheduledStartDate = input.scheduled_start_date || getDateInTimezone(new Date(), taskTimezone);

  console.log('[createClickFarmTask] 开始插入任务:', {
    userId,
    offer_id: input.offer_id,
    daily_click_count: input.daily_click_count,
    hourly_distribution_length: input.hourly_distribution?.length,
    timezone: input.timezone
  });

  try {
    // 🔧 修复(2025-12-31): 使用标准 UUID 格式（带 -），PostgreSQL 的 uuid 类型可以正确识别
    const taskId = crypto.randomUUID().toLowerCase();

    console.log('[createClickFarmTask] 生成任务ID:', taskId);

    // 🔧 修复(2026-02-20): PostgreSQL JSONB 传原生数组，避免双重编码
    const hourlyDistributionJson = toDbJsonObjectField(input.hourly_distribution, db.type, []);
    const refererConfigJson = input.referer_config ? JSON.stringify(input.referer_config) : null;

    const result = await db.exec(`
      INSERT INTO click_farm_tasks (
        id, user_id, offer_id, daily_click_count, start_time, end_time,
        duration_days, scheduled_start_date, hourly_distribution, timezone, referer_config
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      taskId,  // 🔧 修复：使用标准 UUID 格式
      userId,
      input.offer_id,
      input.daily_click_count,
      input.start_time,
      input.end_time,
      input.duration_days,
      scheduledStartDate,
      hourlyDistributionJson,
      taskTimezone,
      refererConfigJson
    ]);

    console.log('[createClickFarmTask] INSERT结果:', result);

    const insertedId = taskId;
    console.log('[createClickFarmTask] 使用生成的ID:', insertedId);

    const task = (await getClickFarmTaskById(insertedId, userId))!;

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
      hourly_distribution_isArray: Array.isArray(task?.hourly_distribution)
    });

    // 🆕 计算并设置 next_run_at
    const nextRunAt = generateNextRunAt(task.timezone, task);
    await db.exec(`
      UPDATE click_farm_tasks
      SET next_run_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [nextRunAt.toISOString(), task.id]);

    // 重新获取更新后的任务
    return (await getClickFarmTaskById(insertedId, userId))!;
  } catch (error) {
    console.error('[createClickFarmTask] 错误:', error);
    if (error instanceof Error) {
      console.error('[createClickFarmTask] 错误消息:', error.message);
      console.error('[createClickFarmTask] 错误堆栈:', error.stack);
    }
    throw error;
  }
}

/**
 * 获取任务（带权限验证）
 */
export async function getClickFarmTaskById(
  id: number | string,
  userId: number
): Promise<ClickFarmTask | null> {
  const db = await getDatabase();

  const task = await db.queryOne<any>(`
    SELECT * FROM click_farm_tasks
    WHERE id = ? AND user_id = ? AND IS_DELETED_FALSE
  `, [id, userId]);

  if (!task) return null;

  return parseClickFarmTask(task);
}

/**
 * 获取任务列表
 */
export async function getClickFarmTasks(
  userId: number,
  filters: TaskFilters = {}
): Promise<{ tasks: ClickFarmTaskListItem[]; total: number }> {
  const db = await getDatabase();

  const whereConditions: string[] = ['cft.user_id = ?'];
  const params: any[] = [userId];

  if (!filters.include_deleted) {
    whereConditions.push('cft.IS_DELETED_FALSE');
  }

  if (filters.status) {
    whereConditions.push('cft.status = ?');
    params.push(filters.status);
  }

  if (filters.offer_id) {
    whereConditions.push('cft.offer_id = ?');
    params.push(filters.offer_id);
  }

  const whereClause = whereConditions.join(' AND ');

  let query = `
    SELECT cft.*, o.target_country, o.offer_name
    FROM click_farm_tasks cft
    LEFT JOIN offers o ON cft.offer_id = o.id
    WHERE ${whereClause}
  `;

  // 分页
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const offset = (page - 1) * limit;

  // 获取总数（注意：count查询需要完整的params，包含userId）
  const countParams = [...params]; // 复制完整的params
  const countResult = await db.queryOne<{ count: number }>(`
    SELECT COUNT(*) as count
    FROM click_farm_tasks cft
    WHERE ${whereClause}
  `, countParams);

  const total = countResult?.count || 0;

  // 获取任务列表
  query += ' ORDER BY cft.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const tasks = await db.query<any>(query, params);

  return {
    tasks: tasks.map(parseClickFarmTask),
    total
  };
}

/**
 * 更新任务
 */
export async function updateClickFarmTask(
  id: number | string,
  userId: number,
  updates: UpdateClickFarmTaskRequest
): Promise<ClickFarmTask> {
  const db = await getDatabase();

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.daily_click_count !== undefined) {
    fields.push('daily_click_count = ?');
    values.push(updates.daily_click_count);
  }

  if (updates.start_time !== undefined) {
    fields.push('start_time = ?');
    values.push(updates.start_time);
  }

  if (updates.end_time !== undefined) {
    fields.push('end_time = ?');
    values.push(updates.end_time);
  }

  if (updates.duration_days !== undefined) {
    fields.push('duration_days = ?');
    values.push(updates.duration_days);
  }

  // 🆕 支持更新scheduled_start_date
  if (updates.scheduled_start_date !== undefined) {
    fields.push('scheduled_start_date = ?');
    values.push(updates.scheduled_start_date);
  }

  if (updates.hourly_distribution !== undefined) {
    fields.push('hourly_distribution = ?');
    values.push(toDbJsonObjectField(updates.hourly_distribution, db.type, []));
  }

  // 🆕 支持更新timezone
  if (updates.timezone !== undefined) {
    fields.push('timezone = ?');
    values.push(updates.timezone);
  }

  // 🔧 修复(2025-12-30): 支持更新referer_config
  if (updates.referer_config !== undefined) {
    fields.push('referer_config = ?');
    values.push(updates.referer_config ? JSON.stringify(updates.referer_config) : null);
  }

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  fields.push('updated_at = datetime(\'now\')');
  values.push(id, userId);

  await db.exec(`
    UPDATE click_farm_tasks
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ? AND IS_DELETED_FALSE
  `, values);

  return (await getClickFarmTaskById(id, userId))!;
}

/**
 * 删除任务（软删除）
 */
export async function deleteClickFarmTask(
  id: number | string,
  userId: number
): Promise<void> {
  const db = await getDatabase();

  await db.exec(`
    UPDATE click_farm_tasks
    SET is_deleted = TRUE, deleted_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `, [id, userId]);

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
  const db = await getDatabase();

  await db.exec(`
    UPDATE click_farm_tasks
    SET status = 'stopped', updated_at = datetime('now')
    WHERE id = ? AND user_id = ? AND status IN ('pending', 'running', 'paused')
  `, [id, userId]);

  try {
    await removePendingClickFarmQueueTasksByTaskIds([id], userId)
  } catch (error) {
    console.warn(`[click-farm] 停止任务后清理队列失败: ${id}`, error)
  }

  return (await getClickFarmTaskById(id, userId))!;
}

/**
 * 重启任务
 */
export async function restartClickFarmTask(
  id: number | string,
  userId: number
): Promise<ClickFarmTask> {
  const db = await getDatabase();

  await db.exec(`
    UPDATE click_farm_tasks
    SET status = 'running',
        pause_reason = NULL,
        pause_message = NULL,
        paused_at = NULL,
        updated_at = datetime('now')
    WHERE id = ? AND user_id = ? AND status IN ('stopped', 'paused')
  `, [id, userId]);

  return (await getClickFarmTaskById(id, userId))!;
}

/**
 * 暂停任务（代理缺失）
 */
export async function pauseClickFarmTask(
  id: number | string,
  reason: string,
  message: string
): Promise<void> {
  const db = await getDatabase();

  await db.exec(`
    UPDATE click_farm_tasks
    SET status = 'paused',
        pause_reason = ?,
        pause_message = ?,
        paused_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `, [reason, message, id]);
}

/**
 * 获取用户统计数据
 *
 * @param userId - 用户ID
 * @param daysBack - 时间范围，'all'表示全部历史，数字表示最近N天
 */
export async function getClickFarmStats(userId: number, daysBack: number | 'all' = 'all'): Promise<ClickFarmStats> {
  const db = await getDatabase();
  const debug = process.env.CLICK_FARM_DEBUG === '1';

  // 构建日期过滤条件
  let dateFilter = '';
  let dateParams: string[] = [];
  if (daysBack !== 'all') {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    dateFilter = ` AND started_at >= datetime('${cutoffDate.toISOString()}')`;
  }

  // 🔧 修复：获取所有任务及其对应的timezone，在应用层按每个任务的timezone过滤今日数据
  // ⚠️ 注意：每个任务可能有不同的timezone（来自offer的target_country）
  // 必须按每个任务的timezone单独判断"today"，然后聚合统计
  // 仅扫描最近更新的任务，避免解析大量历史任务导致内存暴涨
  const recentCutoff = datetimeMinusHours(48, db.type);
  const allTasksQuery = `
    SELECT timezone, daily_history
    FROM click_farm_tasks
    WHERE user_id = ? AND IS_DELETED_FALSE AND started_at IS NOT NULL ${dateFilter}
      AND updated_at >= ${recentCutoff}
  `;

  const allTasks = await db.query<{
    timezone: string;
    daily_history: string | any[];
  }>(allTasksQuery, [userId]);

  // 🔧 修复：今日统计应该从 daily_history 中按任务的时区查找今天的记录
  // 而不是判断 started_at 是否在今天
  // 今日点击数据
  let todayClicks = 0;
  let todaySuccessClicks = 0;
  let todayFailedClicks = 0;

  // 从每个任务的 daily_history 中提取今日数据
  for (const task of allTasks) {
    let history: any[] = [];
    if (typeof task.daily_history === 'string') {
      try {
        history = JSON.parse(task.daily_history);
      } catch (e) {
        history = [];
      }
    } else if (Array.isArray(task.daily_history)) {
      history = task.daily_history;
    }

    if (history.length > 0 && task.timezone) {
      // 用任务的时区获取今天的日期
      const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone);
      if (debug) {
        console.log('🔍 [click-farm] 任务时区:', task.timezone, '今日日期:', todayInTaskTimezone);
        console.log('🔍 [click-farm] daily_history 前3条:', JSON.stringify(history.slice(0, 3)));
      }

      // 从 daily_history 中找今天的记录
      const todayEntry = history.find((entry: any) => entry.date === todayInTaskTimezone);
      if (todayEntry) {
        if (debug) {
          console.log('🔍 [click-farm] 找到今日记录:', JSON.stringify(todayEntry));
        }
        todayClicks += (todayEntry.actual || 0);
        todaySuccessClicks += (todayEntry.success || 0);
        todayFailedClicks += (todayEntry.failed || 0);
      } else {
        const latestEntry = history[history.length - 1];
        if (debug) {
          console.log('🔍 [click-farm] 未找到今日记录，尝试查找最近日期');
          console.log('🔍 [click-farm] 最新记录:', JSON.stringify(latestEntry));
        }
      }
    } else {
      if (debug) {
        console.log('🔍 [click-farm] 跳过任务: history.length=', history.length, 'timezone=', task.timezone);
      }
    }
  }

  if (debug) {
    console.log('🔍 [click-farm] 今日统计（从daily_history）:', {
      clicks: todayClicks,
      successClicks: todaySuccessClicks,
      failedClicks: todayFailedClicks
    });
  }

  // 累计统计（不含已删除任务）

  const todaySuccessRate = todayClicks > 0
    ? (todaySuccessClicks / todayClicks) * 100
    : 0;

  // 累计统计（不含已删除任务）
  // 如果指定了daysBack，则只统计指定范围内的数据
  let cumulativeFilter = '';
  let cumulativeParams: (string | number)[] = [userId];
  if (daysBack !== 'all') {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    cumulativeFilter = ` AND created_at >= datetime('${cutoffDate.toISOString()}')`;
  }

  // 累计统计（不含已删除任务）
  const cumulativeResult = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(total_clicks), 0) as clicks,
      COALESCE(SUM(success_clicks), 0) as success_clicks,
      COALESCE(SUM(failed_clicks), 0) as failed_clicks
    FROM click_farm_tasks
    WHERE user_id = ? AND IS_DELETED_FALSE ${cumulativeFilter}
  `, cumulativeParams);

  // 🔧 调试日志：查看PostgreSQL返回的原始数据
  if (debug) {
    console.log('🔍 [click-farm] cumulativeResult 原始数据:', JSON.stringify(cumulativeResult));
    console.log('🔍 [click-farm] cumulativeResult 字段:', {
      clicks: cumulativeResult?.clicks,
      success_clicks: cumulativeResult?.success_clicks,
      failed_clicks: cumulativeResult?.failed_clicks,
      successClicks: cumulativeResult?.successClicks,
      failedClicks: cumulativeResult?.failedClicks
    });
  }

  // 🔧 修复: PostgreSQL 列名是小写的（success_clicks 而非 successClicks）
  // 确保所有字段都是数字类型（PostgreSQL numeric 类型可能返回字符串）
  const cumulative = {
    clicks: parseFloat(String(cumulativeResult?.clicks || 0)),
    successClicks: parseFloat(String(cumulativeResult?.success_clicks || 0)),
    failedClicks: parseFloat(String(cumulativeResult?.failed_clicks || 0)),
  };

  if (debug) {
    console.log('🔍 [click-farm] cumulative 解析后:', cumulative);
  }

  const cumulativeSuccessRate = cumulative.clicks > 0
    ? parseFloat(((cumulative.successClicks / cumulative.clicks) * 100).toFixed(1))
    : 0;

  // 🆕 任务状态分布统计（不含已删除任务）
  const statusDistribution = await db.query<{ status: string; count: number }>(`
    SELECT status, COUNT(*) as count
    FROM click_farm_tasks
    WHERE user_id = ? AND IS_DELETED_FALSE ${dateFilter.replace('started_at', 'created_at')}
    GROUP BY status
  `, [userId]);

  // 构建状态分布对象
  const taskStatusDistribution = {
    pending: 0,
    running: 0,
    paused: 0,
    stopped: 0,
    completed: 0,
    total: 0
  };

  statusDistribution.forEach(row => {
    const status = row.status as ClickFarmTaskStatus;
    const count = Number(row.count);  // 🔧 修复：确保count是数字
    taskStatusDistribution[status] = count;
    taskStatusDistribution.total += count;
  });

  return {
    today: {
      clicks: todayClicks,
      successClicks: todaySuccessClicks,
      failedClicks: todayFailedClicks,
      successRate: parseFloat(todaySuccessRate.toFixed(1)),
      traffic: estimateTraffic(todayClicks)  // 🔧 统一使用估算函数
    },
    cumulative: {
      clicks: cumulative.clicks,
      successClicks: cumulative.successClicks,
      failedClicks: cumulative.failedClicks,
      successRate: parseFloat(cumulativeSuccessRate.toFixed(1)),
      traffic: estimateTraffic(cumulative.clicks)  // 🔧 统一使用估算函数
    },
    taskStatusDistribution  // 🆕 任务状态分布
  };
}

/**
 * 获取管理员全局统计数据（支持多时区聚合）
 * ⚠️ 重要：统计"今日"是指在每个任务所在时区的"今日"
 * 例如：
 * - 任务A（America/New_York）的"今日"点击 = 60
 * - 任务B（Asia/Shanghai）的"今日"点击 = 50
 * - 管理员看到的总"今日点击" = 110（聚合所有时区）
 */
export async function getAdminClickFarmStats(): Promise<{
  total_tasks: number;
  active_tasks: number;
  total_clicks: number;
  success_clicks: number;
  success_rate: number;
  today_clicks: number;
  today_success_clicks: number;  // 🆕 今日成功点击数
  today_success_rate: number;    // 🆕 今日成功率
  today_traffic: number;
  total_traffic: number;
  taskStatusDistribution: {
    pending: number;
    running: number;
    paused: number;
    stopped: number;
    completed: number;
    total: number;
  };
}> {
  const db = await getDatabase();

  // 1️⃣ 全局统计（包含已删除任务的历史数据，以便保留历史记录）
  const global = await db.queryOne<any>(`
    SELECT
      COUNT(*) as total_tasks,
      SUM(CASE WHEN status = 'running' AND NOT is_deleted THEN 1 ELSE 0 END) as active_tasks,
      COALESCE(SUM(total_clicks), 0) as total_clicks,
      COALESCE(SUM(success_clicks), 0) as success_clicks,
      COALESCE(SUM(failed_clicks), 0) as failed_clicks
    FROM click_farm_tasks
  `, []);

  const successRate = global.total_clicks > 0
    ? (global.success_clicks / global.total_clicks) * 100
    : 0;

  // 2️⃣ 今日统计（按每个任务的timezone判断）
  // 🔧 修复：从每个任务的 daily_history 中提取今日数据
  // 而不是判断 started_at 是否为今天（started_at 是任务首次开始日期，可能是很久以前）
  // 仅扫描最近更新的任务，避免解析大量历史任务导致内存暴涨
  const recentCutoff = datetimeMinusHours(48, db.type);
  const allTasks = await db.query<{
    timezone: string;
    daily_history: string | any[];
  }>(`
    SELECT timezone, daily_history
    FROM click_farm_tasks
    WHERE IS_DELETED_FALSE AND started_at IS NOT NULL
      AND updated_at >= ${recentCutoff}
  `, []);

  // 从每个任务的 daily_history 中提取今日数据
  let todayClicks = 0;
  let todaySuccessClicks = 0;
  let todayFailedClicks = 0;

  for (const task of allTasks) {
    let history: any[] = [];
    if (typeof task.daily_history === 'string') {
      try {
        history = JSON.parse(task.daily_history);
      } catch (e) {
        history = [];
      }
    } else if (Array.isArray(task.daily_history)) {
      history = task.daily_history;
    }

    if (history.length > 0 && task.timezone) {
      // 用任务的时区获取今天的日期
      const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone);
      // 从 daily_history 中找今天的记录
      const todayEntry = history.find((entry: any) => entry.date === todayInTaskTimezone);
      if (todayEntry) {
        todayClicks += (todayEntry.actual || 0);
        todaySuccessClicks += (todayEntry.success || 0);
        todayFailedClicks += (todayEntry.failed || 0);
      }
    }
  }

  const today = {
    clicks: todayClicks,
    successClicks: todaySuccessClicks,
    failedClicks: todayFailedClicks,
  };

  const todaySuccessRate = today.clicks > 0
    ? (today.successClicks / today.clicks) * 100
    : 0;

  // 3️⃣ 任务状态分布统计（不含已删除任务）
  const statusDistribution = await db.query<{ status: string; count: number }>(`
    SELECT status, COUNT(*) as count
    FROM click_farm_tasks
    WHERE IS_DELETED_FALSE
    GROUP BY status
  `, []);

  // 构建状态分布对象
  const taskStatusDistribution = {
    pending: 0,
    running: 0,
    paused: 0,
    stopped: 0,
    completed: 0,
    total: 0
  };

  statusDistribution.forEach(row => {
    const status = row.status as ClickFarmTaskStatus;
    const count = Number(row.count);  // 🔧 修复：确保count是数字
    taskStatusDistribution[status] = count;
    taskStatusDistribution.total += count;
  });

  return {
    total_tasks: global.total_tasks,
    active_tasks: global.active_tasks,
    total_clicks: global.total_clicks,
    success_clicks: global.success_clicks,
    success_rate: parseFloat(successRate.toFixed(1)),
    today_clicks: today.clicks,
    today_success_clicks: today.successClicks,  // 🆕 今日成功点击数
    today_success_rate: parseFloat(todaySuccessRate.toFixed(1)),  // 🆕 今日成功率
    today_traffic: estimateTraffic(today.clicks),  // 🔧 统一使用估算函数
    total_traffic: estimateTraffic(global.total_clicks),  // 🔧 统一使用估算函数
    taskStatusDistribution
  };
}

/**
 * 获取今日时间分布
 * 🔧 修复P1-5：从daily_history的hourly_breakdown中提取实际执行分布
 * 支持用户查看"配置分布" vs "实际执行分布"的对比
 */
export async function getHourlyDistribution(userId: number): Promise<HourlyDistribution> {
  const db = await getDatabase();

  // 获取今日所有任务的配置分布（汇总）
  const tasks = await db.query<any>(`
    SELECT hourly_distribution, timezone, daily_history, started_at
    FROM click_farm_tasks
    WHERE user_id = ? AND IS_DELETED_FALSE AND status IN ('running', 'completed')
  `, [userId]);

  const hourlyConfigured = new Array(24).fill(0);
  const hourlyActual = new Array(24).fill(0);
  const todayStr = getDateInTimezone(new Date(), 'UTC'); // 使用UTC作为参考

  // 聚合所有任务的配置和实际执行分布
  tasks.forEach((task: any) => {
    const distribution = parseJsonField<number[]>(task.hourly_distribution, []);
    if (!Array.isArray(distribution)) {
      console.warn('[getHourlyDistribution] hourly_distribution 不是数组，已跳过');
      return;
    }
    distribution.forEach((count: number, hour: number) => {
      hourlyConfigured[hour] += Number(count) || 0;
    });

    // 🆕 P1-5：从daily_history的hourly_breakdown中提取实际执行数
    const dailyHistory = parseJsonField<DailyHistoryEntry[]>(task.daily_history, []);
    if (!Array.isArray(dailyHistory)) return;

    // 找到对应今天的daily_history条目
    // 这里使用任务的timezone来确定"今天"
    const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone);
    const todayEntry = dailyHistory.find((entry: DailyHistoryEntry) => entry.date === todayInTaskTimezone);

    if (todayEntry && Array.isArray(todayEntry.hourly_breakdown)) {
      todayEntry.hourly_breakdown.forEach((hourData: any, hour: number) => {
        hourlyActual[hour] += Number(hourData?.actual) || 0;
      });
    }
  });

  // 计算匹配度
  const matchRate = calculateMatchRate(hourlyActual, hourlyConfigured);

  return {
    date: todayStr,
    hourlyActual,
    hourlyConfigured,
    matchRate
  };
}

/**
 * 计算匹配度
 */
function calculateMatchRate(actual: number[], configured: number[]): number {
  let totalDiff = 0;
  let totalConfigured = 0;

  for (let i = 0; i < 24; i++) {
    totalDiff += Math.abs(actual[i] - configured[i]);
    totalConfigured += configured[i];
  }

  if (totalConfigured === 0) return 100;

  const matchRate = ((totalConfigured - totalDiff) / totalConfigured) * 100;
  return Math.max(0, parseFloat(matchRate.toFixed(1)));
}

/**
 * 解析数据库任务对象
 * 🔧 修复(2025-12-31): PostgreSQL jsonb 类型会被自动解析为 JS 对象/数组，
 * 不需要再调用 JSON.parse。SQLite 返回字符串，需要解析。
 * 🔧 额外修复：PostgreSQL time without time zone 类型返回 Date 对象，
 * 需要转换为字符串格式 "HH:mm" 才能使用 split() 方法。
 */
export function parseClickFarmTask(row: any): ClickFarmTaskListItem {
  // 安全解析函数：处理字符串（SQLite）或已解析对象（PostgreSQL jsonb）
  // 🔧 修复(2025-12-31): 增强类型检查，确保返回正确类型
  // 🔧 修复(2026-01-05): 处理双重JSON编码问题（PostgreSQL jsonb存储了JSON字符串）
  const safeParse = (value: any, defaultValue: any = null): any => {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === 'string') {
      try {
        let parsed = JSON.parse(value);
        // 🔧 修复：如果解析结果仍然是字符串（双重编码），再解析一次
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed);
          } catch (e) {
            // 第二次解析失败，使用第一次的结果
          }
        }
        // 如果解析结果是数组或对象，直接返回
        if (Array.isArray(parsed) || (typeof parsed === 'object' && parsed !== null)) {
          return parsed;
        }
        // 否则返回默认值（不是有效的 JSON 结构）
        console.warn('[parseClickFarmTask] JSON解析结果不是对象/数组:', value);
        return defaultValue;
      } catch (e) {
        console.warn('[parseClickFarmTask] JSON解析失败:', value);
        return defaultValue;
      }
    }
    // 如果已经是数组或对象（PostgreSQL jsonb），直接返回
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      return value;
    }
    // 其他类型返回默认值
    return defaultValue;
  };

  // 安全解析时间字段（PostgreSQL time without time zone 返回 Date 对象）
  // 需要转换为字符串格式 "HH:mm" 才能使用 split() 方法
  const safeParseTime = (value: any, defaultValue: string = '06:00'): string => {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === 'string') {
      // 格式可能是 "06:00:00" 或 "06:00"，取前5个字符
      return value.substring(0, 5);
    }
    if (value instanceof Date) {
      // PostgreSQL time 类型返回的是 Date 对象（只有时间部分）
      const hours = String(value.getHours()).padStart(2, '0');
      const minutes = String(value.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    // 兜底：转换为字符串
    return String(value).substring(0, 5) || defaultValue;
  };

  // 安全解析 referer_config
  let refererConfig: { type: string; referer?: string } | null = null;
  if (row.referer_config) {
    refererConfig = safeParse(row.referer_config, null);
  }

  // 🔧 修复：动态计算进度（按时间进度，而非数据库中的静态值）
  // 进度计算逻辑：
  // - pending: 0%
  // - paused/stopped: 保持当前时间进度
  // - running: (已执行天数 / 总天数) * 100
  // - completed: 100%
  let calculatedProgress = 0;
  if (row.status === 'completed') {
    calculatedProgress = 100;
  } else if (row.status === 'running' && row.started_at && row.duration_days > 0) {
    // 按时间进度计算
    const startedAtUTC = new Date(row.started_at).getTime();
    const nowUTC = Date.now();
    const elapsedMs = nowUTC - startedAtUTC;
    const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
    calculatedProgress = Math.min(100, Math.round((elapsedDays / row.duration_days) * 100));
  } else if (row.status === 'paused' || row.status === 'stopped') {
    // 已暂停/停止的任务，保持最后的时间进度
    if (row.started_at && row.duration_days > 0) {
      const startedAtUTC = new Date(row.started_at).getTime();
      const pausedAtUTC = row.paused_at ? new Date(row.paused_at).getTime() : Date.now();
      const elapsedMs = pausedAtUTC - startedAtUTC;
      const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
      calculatedProgress = Math.min(100, Math.round((elapsedDays / row.duration_days) * 100));
    }
  }
  // pending 状态保持 0%

  const task = {
    id: row.id,
    user_id: row.user_id,
    offer_id: row.offer_id,
    daily_click_count: row.daily_click_count,
    start_time: safeParseTime(row.start_time, '06:00'),
    end_time: safeParseTime(row.end_time, '24:00'),
    duration_days: row.duration_days,
    scheduled_start_date: normalizeDateOnly(row.scheduled_start_date) || getDateInTimezone(new Date(), row.timezone || 'America/New_York'),
    hourly_distribution: safeParse(row.hourly_distribution, []),
    status: row.status,
    pause_reason: row.pause_reason,
    pause_message: row.pause_message,
    paused_at: normalizeTimestampToIso(row.paused_at),
    progress: calculatedProgress,  // 🔧 使用动态计算的值
    total_clicks: row.total_clicks,
    success_clicks: row.success_clicks,
    failed_clicks: row.failed_clicks,
    daily_history: safeParse(row.daily_history, []),
    timezone: row.timezone,
    referer_config: refererConfig,
    is_deleted: Boolean(row.is_deleted),
    deleted_at: normalizeTimestampToIso(row.deleted_at),
    started_at: normalizeTimestampToIso(row.started_at),
    completed_at: normalizeTimestampToIso(row.completed_at),
    next_run_at: normalizeTimestampToIso(row.next_run_at),
    created_at: normalizeTimestampToIso(row.created_at) || new Date().toISOString(),
    updated_at: normalizeTimestampToIso(row.updated_at) || new Date().toISOString()
  } as ClickFarmTaskListItem;

  // 如果有target_country字段（从JOIN查询返回），保留它用于前端显示
  if (row.target_country) {
    task.target_country = row.target_country;
  }

  // 🆕 如果有offer_name字段（从JOIN查询返回），保留它用于前端显示（产品标识，如 "Eufy_GB_02"）
  if (row.offer_name) {
    task.offer_name = row.offer_name;
  }

  return task;
}

/**
 * 初始化日历历史记录
 * 当任务首次执行时调用，为从scheduled_start_date到任务完成日期的每一天创建历史记录
 *
 * ⚠️ 时区处理：所有日期都相对于 task.timezone（任务的目标时区）
 * 例如：task.timezone = "Asia/Shanghai"，scheduled_start_date = "2024-12-30"
 * 则初始化的日期都是上海时间的本地日期
 *
 * ⚠️ 大跨度优化：对于无限期任务，只初始化最近7天而不是从开始日期到今天
 * 这样避免在初始化时创建数千条记录导致内存爆炸
 */
export async function initializeDailyHistory(task: ClickFarmTask): Promise<void> {
  const db = await getDatabase();

  // 如果daily_history已经有数据，说明已经初始化过，无需重复初始化
  if (task.daily_history && task.daily_history.length > 0) {
    return;
  }

  // 从scheduled_start_date开始
  // 🔧 修复(2025-12-31): 确保 scheduled_start_date 是字符串格式 YYYY-MM-DD
  let currentDateStr: string;
  const dateValue = task.scheduled_start_date as any;
  if (typeof dateValue === 'string') {
    currentDateStr = dateValue.split('T')[0];
  } else if (dateValue instanceof Date) {
    const year = dateValue.getFullYear();
    const month = String(dateValue.getMonth() + 1).padStart(2, '0');
    const day = String(dateValue.getDate()).padStart(2, '0');
    currentDateStr = `${year}-${month}-${day}`;
  } else {
    currentDateStr = String(dateValue);
  }
  const dailyHistory: DailyHistoryEntry[] = [];

  // 计算应该创建的最后一天
  let endDateStr: string;
  if (task.duration_days > 0) {
    // 有限期任务：计算结束日期
    // 🔧 修复：使用createDateInTimezone确保日期计算在正确的时区
    const startDate = createDateInTimezone(
      currentDateStr,
      '00:00',
      task.timezone
    );
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + task.duration_days - 1);
    endDateStr = getDateInTimezone(endDate, task.timezone);
  } else {
    // 无限期任务：只初始化最近7天（P0-4修复）
    // 避免对于运行很久的任务初始化数千条记录
    const maxDaysToInit = 7;
    const today = getDateInTimezone(new Date(), task.timezone);
    const endDate = new Date(today);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - (maxDaysToInit - 1));

    currentDateStr = startDate.toISOString().split('T')[0];
    endDateStr = today;
  }

  // 为每一天创建历史记录
  while (currentDateStr <= endDateStr) {
    // 计算该天的目标点击数（基于hourly_distribution）
    const targetClicks = task.hourly_distribution.reduce((sum, count) => sum + count, 0);

    // 🆕 P1-5：初始化hourly_breakdown用于跟踪每小时的执行情况
    const hourlyBreakdown = task.hourly_distribution.map(target => ({
      target,
      actual: 0,
      success: 0,
      failed: 0
    }));

    dailyHistory.push({
      date: currentDateStr,  // ⚠️ 这个日期相对于 task.timezone（任务时区的本地日期）
      target: targetClicks,
      actual: 0,
      success: 0,
      failed: 0,
      hourly_breakdown: hourlyBreakdown  // 🆕 添加小时级别追踪
    });

    // 日期递增（直接操作字符串+1天）
    const [year, month, day] = currentDateStr.split('-').map(Number);
    const nextDate = new Date(year, month - 1, day);
    nextDate.setDate(nextDate.getDate() + 1);
    currentDateStr = nextDate.toISOString().split('T')[0];
  }

  // 更新任务的daily_history
  await db.exec(`
    UPDATE click_farm_tasks
    SET daily_history = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `, [toDbJsonObjectField(dailyHistory, db.type, []), task.id]);
}

/**
 * 获取任务在特定时区的今天日期（YYYY-MM-DD格式）
 *
 * ⚠️ 时区处理：返回的日期是相对于 task.timezone 的本地日期
 * 例如：task.timezone = "Asia/Shanghai"，当前UTC = 2024-12-28 16:00:00
 * 则返回 "2024-12-29"（上海时间）
 */
function getTodayInTaskTimezone(task: ClickFarmTask): string {
  return getDateInTimezone(new Date(), task.timezone);
}

/**
 * 更新任务执行统计
 * 包括全局统计和每日历史记录
 *
 * 🔧 修复P1-1：使用原子操作避免竞态条件
 * 🔧 修复P1-5：同时更新hourly_breakdown用于实际执行分布追踪
 * 🆕 内存优化：批量累积统计，避免每次点击都读写daily_history
 */
export async function updateTaskStats(
  id: number | string,
  success: boolean,
  currentHour?: number  // 可选：当前小时（用于更新hourly_breakdown）
): Promise<void> {
  const taskId = String(id)
  const hour = Number.isFinite(currentHour) ? Number(currentHour) : undefined

  const entry = pendingStatsUpdates.get(taskId) || {
    total: 0,
    success: 0,
    failed: 0,
    hourly: new Map()
  }

  entry.total += 1
  if (success) entry.success += 1
  else entry.failed += 1

  if (hour !== undefined && hour >= 0 && hour <= 23) {
    recordHourlyDelta(entry, hour, success)
  }

  pendingStatsUpdates.set(taskId, entry)

  if (CLICK_FARM_STATS_BATCH_SIZE <= 1) {
    await flushPendingStats(taskId)
    return
  }

  if (entry.total >= CLICK_FARM_STATS_BATCH_SIZE) {
    await flushPendingStats(taskId)
    return
  }

  scheduleStatsFlush(taskId, entry)
}

/**
 * 更新任务状态
 */
export async function updateTaskStatus(
  id: number | string,
  status: string,
  nextRunAt?: Date
): Promise<void> {
  const db = await getDatabase();

  if (nextRunAt) {
    await db.exec(`
      UPDATE click_farm_tasks
      SET status = ?,
          next_run_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, [status, nextRunAt.toISOString(), id]);
  } else {
    await db.exec(`
      UPDATE click_farm_tasks
      SET status = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, [status, id]);
  }
}

/**
 * 获取待执行的任务
 * 包括：pending（等待首次执行）+ running（进行中）
 */
export async function getPendingTasks(): Promise<ClickFarmTask[]> {
  const db = await getDatabase();
  const pendingLimit = Math.max(100, Number(process.env.CLICK_FARM_PENDING_LIMIT || 1000) || 1000)

  // 🔒 用户禁用/过期后不再调度其任务（避免继续入队）
  const rows = await db.query<any>(`
    SELECT
      cft.*,
      u.package_expires_at as user_package_expires_at
    FROM click_farm_tasks cft
    INNER JOIN users u ON u.id = cft.user_id
    WHERE cft.status IN ('pending', 'running')
      AND cft.IS_DELETED_FALSE
      AND (cft.next_run_at IS NULL OR cft.next_run_at <= datetime('now'))
      AND u.is_active = ?
    ORDER BY
      CASE WHEN cft.next_run_at IS NULL THEN 0 ELSE 1 END,
      cft.next_run_at ASC,
      cft.created_at ASC
    LIMIT ${pendingLimit}
  `, [boolParam(true, db.type)]);

  const now = Date.now();
  const tasks = rows.filter((row: any) => {
    const expiresAt = row.user_package_expires_at as string | null | undefined;
    if (!expiresAt) return true;
    const expiry = new Date(expiresAt);
    if (!Number.isFinite(expiry.getTime())) return false;
    return expiry.getTime() >= now;
  });

  // 🔧 添加调试日志
  if (process.env.DEBUG_CLICK_FARM === 'true') {
    console.log('[getPendingTasks] 查询结果:', {
      count: tasks.length,
      now: new Date().toISOString(),
      tasks: tasks.map(t => ({
        id: t.id,
        status: t.status,
        next_run_at: t.next_run_at,
        started_at: t.started_at,
        duration_days: t.duration_days
      }))
    });
  }

  return tasks.map(parseClickFarmTask);
}
