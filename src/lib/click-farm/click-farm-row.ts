/**
 * DB row parsing for click-farm tasks.
 */
import { getDateInTimezone } from '@/lib/common/server'
import { normalizeDateOnly, normalizeTimestampToIso } from '@/lib/db'
import type { ClickFarmTaskListItem } from './click-farm-types'

/**
 * 计算匹配度
 */
export function calculateMatchRate(actual: number[], configured: number[]): number {
  let totalDiff = 0
  let totalConfigured = 0

  for (let i = 0; i < 24; i++) {
    totalDiff += Math.abs(actual[i] - configured[i])
    totalConfigured += configured[i]
  }

  if (totalConfigured === 0) return 100

  const matchRate = ((totalConfigured - totalDiff) / totalConfigured) * 100
  return Math.max(0, parseFloat(matchRate.toFixed(1)))
}

/**
 * 解析数据库任务对象
 * PostgreSQL jsonb 类型会被自动解析为 JS 对象/数组，
 * 不需要再调用 JSON.parse。部分驱动可能返回字符串，需要解析。
 * 额外PostgreSQL time without time zone 类型返回 Date 对象，
 * 需要转换为字符串格式 "HH:mm" 才能使用 split() 方法。
 */
export function parseClickFarmTask(row: any): ClickFarmTaskListItem {
  // 安全解析函数：处理 JSON 字符串或已解析的 jsonb 对象
  // 增强类型检查，确保返回正确类型
  // 处理双重JSON编码问题（PostgreSQL jsonb存储了JSON字符串）
  const safeParse = (value: any, defaultValue: any = null): any => {
    if (value === null || value === undefined) return defaultValue
    if (typeof value === 'string') {
      try {
        let parsed = JSON.parse(value)
        // 如果解析结果仍然是字符串（双重编码），再解析一次
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed)
          } catch (_e) {
            // 第二次解析失败，使用第一次的结果
          }
        }
        // 如果解析结果是数组或对象，直接返回
        if (Array.isArray(parsed) || (typeof parsed === 'object' && parsed !== null)) {
          return parsed
        }
        // 否则返回默认值（不是有效的 JSON 结构）
        console.warn('[parseClickFarmTask] JSON解析结果不是对象/数组:', value)
        return defaultValue
      } catch (_e) {
        console.warn('[parseClickFarmTask] JSON解析失败:', value)
        return defaultValue
      }
    }
    // 如果已经是数组或对象（PostgreSQL jsonb），直接返回
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      return value
    }
    // 其他类型返回默认值
    return defaultValue
  }

  // 安全解析时间字段（PostgreSQL time without time zone 返回 Date 对象）
  // 需要转换为字符串格式 "HH:mm" 才能使用 split() 方法
  const safeParseTime = (value: any, defaultValue: string = '06:00'): string => {
    if (value === null || value === undefined) return defaultValue
    if (typeof value === 'string') {
      // 格式可能是 "06:00:00" 或 "06:00"，取前5个字符
      return value.substring(0, 5)
    }
    if (value instanceof Date) {
      // PostgreSQL time 类型返回的是 Date 对象（只有时间部分）
      const hours = String(value.getHours()).padStart(2, '0')
      const minutes = String(value.getMinutes()).padStart(2, '0')
      return `${hours}:${minutes}`
    }
    // 兜底：转换为字符串
    return String(value).substring(0, 5) || defaultValue
  }

  // 安全解析 referer_config
  let refererConfig: { type: string; referer?: string } | null = null
  if (row.referer_config) {
    refererConfig = safeParse(row.referer_config, null)
  }

  // 动态计算进度（按时间进度，而非数据库中的静态值）
  // 进度计算逻辑
  // pending: 0%
  // paused/stopped: 保持当前时间进度
  // running: (已执行天数 / 总天数) * 100
  // completed: 100%
  let calculatedProgress = 0
  if (row.status === 'completed') {
    calculatedProgress = 100
  } else if (row.status === 'running' && row.started_at && row.duration_days > 0) {
    // 按时间进度计算
    const startedAtUTC = new Date(row.started_at).getTime()
    const nowUTC = Date.now()
    const elapsedMs = nowUTC - startedAtUTC
    const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24)
    calculatedProgress = Math.min(100, Math.round((elapsedDays / row.duration_days) * 100))
  } else if (row.status === 'paused' || row.status === 'stopped') {
    // 已暂停/停止的任务，保持最后的时间进度
    if (row.started_at && row.duration_days > 0) {
      const startedAtUTC = new Date(row.started_at).getTime()
      const pausedAtUTC = row.paused_at ? new Date(row.paused_at).getTime() : Date.now()
      const elapsedMs = pausedAtUTC - startedAtUTC
      const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24)
      calculatedProgress = Math.min(100, Math.round((elapsedDays / row.duration_days) * 100))
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
    scheduled_start_date:
      normalizeDateOnly(row.scheduled_start_date) ||
      getDateInTimezone(new Date(), row.timezone || 'America/New_York'),
    hourly_distribution: safeParse(row.hourly_distribution, []),
    status: row.status,
    pause_reason: row.pause_reason,
    pause_message: row.pause_message,
    paused_at: normalizeTimestampToIso(row.paused_at),
    progress: calculatedProgress, // 使用动态计算的值
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
    updated_at: normalizeTimestampToIso(row.updated_at) || new Date().toISOString(),
  } as ClickFarmTaskListItem

  // 如果有target_country字段（从JOIN查询返回），保留它用于前端显示
  if (row.target_country) {
    task.target_country = row.target_country
  }

  // 如果有offer_name字段（从JOIN查询返回），保留它用于前端显示（产品标识，如 "Eufy_GB_02"）
  if (row.offer_name) {
    task.offer_name = row.offer_name
  }

  if (row.has_enabled_campaign !== undefined && row.has_enabled_campaign !== null) {
    task.has_enabled_campaign = Boolean(row.has_enabled_campaign)
  }

  return task
}
