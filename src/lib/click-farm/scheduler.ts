// 调度逻辑模块
// src/lib/click-farm/scheduler.ts

import type { ClickFarmTask, SubTask } from '../click-farm-types';
import crypto from 'crypto';
import { createDateInTimezone, getDateInTimezone, getHourInTimezone } from '../timezone-utils';

/**
 * 生成子任务
 * 将每小时的点击数分散到随机的秒级时间点
 *
 * ⚠️ 时区处理：targetHour 相对于 task.timezone（目标时区）的小时
 * 必须使用 createDateInTimezone 确保时间在正确的时区中构造
 *
 * @param task - 点击任务
 * @param targetHour - 目标小时（0-23，相对于task.timezone）
 * @param targetCount - 该小时的点击数
 * @returns 子任务数组
 */
export function generateSubTasks(
  task: ClickFarmTask,
  targetHour: number,
  targetCount: number,
  affiliateLink: string,
  targetCountry: string
): SubTask[] {
  if (targetCount <= 0) return [];

  const tasks: SubTask[] = [];
  // 获取任务时区中的当前日期
  const todayInTimezone = getDateInTimezone(new Date(), task.timezone);

  for (let i = 0; i < targetCount; i++) {
    // 随机分钟（0-59）
    const minute = Math.floor(Math.random() * 60);
    // 随机秒（0-59），避免整点整分整秒
    const second = Math.floor(Math.random() * 60);

    // 🔧 修复：使用 createDateInTimezone 在目标时区中构造时间
    // 这样确保 targetHour 相对于 task.timezone
    // 🆕 使用随机秒数，避免整点整分整秒的触发时间
    const scheduledAt = createDateInTimezone(
      todayInTimezone,
      `${targetHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
      task.timezone,
      second
    );

    tasks.push({
      id: crypto.randomUUID(),
      taskId: task.id,
      url: affiliateLink,
      scheduledAt,
      proxyCountry: targetCountry,
      status: 'pending'
    });
  }

  // 按时间排序
  return tasks.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

/**
 * 检查当前时间是否在任务的执行时间范围内
 *
 * ⚠️ 时区处理：start_time 和 end_time 都是相对于 task.timezone（目标时区）的本地时间
 * 例如：task.timezone = "Asia/Shanghai"，start_time = "06:00"，end_time = "18:00"
 * 表示只在上海时间的 06:00 到 18:00 之间执行
 *
 * ⚠️ 支持跨越午夜的时间范围：
 * start_time = "22:00", end_time = "06:00" 表示从晚上22:00执行到早上06:00
 *
 * @param task - 点击任务
 * @returns 当前时间是否在 [start_time, end_time] 范围内
 */
export function isWithinExecutionTimeRange(task: ClickFarmTask): boolean {
  // 🔧 修复：防御性检查，确保 task 字段有有效值
  if (!task) return false;

  // 获取任务时区的当前小时和分钟
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', {
    timeZone: task.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const [hourStr, minuteStr] = timeStr.split(':');
  const currentHour = parseInt(hourStr);
  const currentMinute = parseInt(minuteStr);

  // 解析 start_time (格式: "HH:mm")
  // 🔧 修复：防御性检查 start_time 是否为有效字符串
  const startTime = task.start_time || '06:00';
  const [startHourStr, startMinuteStr] = startTime.split(':');
  const startHour = parseInt(startHourStr);
  const startMinute = parseInt(startMinuteStr);

  // 解析 end_time (格式: "HH:mm" 或 "24:00")
  // 🔧 修复：防御性检查 end_time 是否为有效字符串
  const endTime = task.end_time || '24:00';
  const [endHourStr, endMinuteStr] = endTime.split(':');
  let endHour = parseInt(endHourStr);
  let endMinute = parseInt(endMinuteStr);

  // 特殊处理 end_time = "24:00"（表示整天到结束）
  if (endTime === '24:00') {
    endHour = 23;
    endMinute = 59;
  }

  // 转换为分钟进行比较
  const currentMinutes = currentHour * 60 + currentMinute;
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  // 🔧 修复：支持跨越午夜的时间范围
  if (startMinutes <= endMinutes) {
    // 正常范围（不跨越午夜）：[start_time, end_time]
    // 例如：[06:00, 18:00] 表示6点到18点
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    // 跨越午夜范围：[start_time, 24:00) 或 [00:00, end_time]
    // 例如：[22:00, 06:00] 表示从晚上22点执行到早上06点
    // 包括：22:00-23:59 或 00:00-06:00
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}

/**
 * 计算任务进度
 *
 * ⚠️ 时区处理：应该按照任务时区计算"完整日期数"，而不是按UTC秒数
 * 与 shouldCompleteTask 使用相同的时区感知逻辑
 *
 * @param task - 点击任务
 * @returns 进度百分比（0-100）
 */
export function calculateProgress(task: ClickFarmTask): number {
  if (task.duration_days === -1) {
    // 无限期任务不显示进度
    return 0;
  }

  // 如果任务还未开始，检查是否还未到开始日期
  if (!task.started_at) {
    // 如果还未开始，则进度为0%
    return 0;
  }

  // 🔧 修复：按任务时区计算"完整日期数"
  // 转换 started_at 为任务时区的本地日期
  const startedAtInTimezone = getDateInTimezone(new Date(task.started_at), task.timezone);
  // 转换 当前时间 为任务时区的本地日期
  const nowInTimezone = getDateInTimezone(new Date(), task.timezone);

  // 解析日期字符串 (格式: "YYYY-MM-DD")
  const [startYear, startMonth, startDay] = startedAtInTimezone.split('-').map(Number);
  const [nowYear, nowMonth, nowDay] = nowInTimezone.split('-').map(Number);

  // 创建纯日期对象（不涉及时间部分）
  const startDate = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
  const nowDate = new Date(nowYear, nowMonth - 1, nowDay, 0, 0, 0, 0);

  // 计算完整日期差
  const elapsedDays = Math.floor(
    (nowDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const progress = Math.min(
    100,
    Math.round((elapsedDays / task.duration_days) * 100)
  );

  return progress;
}

/**
 * 检查任务是否应该完成
 *
 * ⚠️ 时区处理：duration_days 应该按照任务时区计算"完整日期数"，而不是按UTC秒数计算
 * 例如：
 * - task.timezone = "Asia/Shanghai"
 * - started_at = UTC 2024-12-29 22:00:00（对应上海 2024-12-30 06:00:00）
 * - 当前时间 = UTC 2025-01-01 15:00:00（对应上海 2025-01-02 23:00:00）
 * - duration_days = 3
 *
 * ❌ 错误做法：按UTC秒数计算，会得到 2.708...天，floor后是2天，不完成
 * ✅ 正确做法：按上海时区的日期计算，从 2024-12-30 到 2025-01-02 是3个完整日期，应该完成
 *
 * @param task - 点击任务
 * @returns 是否应该完成
 */
export function shouldCompleteTask(task: ClickFarmTask): boolean {
  if (task.duration_days === -1) {
    // 无限期任务不会自动完成
    return false;
  }

  if (!task.started_at) {
    return false;
  }

  // 🔧 修复：使用 UTC 时间戳计算经过的天数，避免时区边界问题
  // 例如：如果 started_at 是 2025-12-31 23:00:00 UTC，duration_days = 1
  // 应该等到 2026-01-01 23:00:00 UTC 才算完成，而不是 2026-01-01 00:00:01 UTC
  const startedAtUTC = new Date(task.started_at).getTime();
  const nowUTC = Date.now();

  // 计算经过的完整天数（向上取整，确保跨过完整的 duration_days 天）
  const elapsedMs = nowUTC - startedAtUTC;
  const elapsedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));

  const shouldComplete = elapsedDays >= task.duration_days;

  // 🔧 添加调试日志
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_CLICK_FARM === 'true') {
    console.log('[shouldCompleteTask] 调试信息:', {
      taskId: task.id,
      timezone: task.timezone,
      startedAtUTC: new Date(startedAtUTC).toISOString(),
      nowUTC: new Date(nowUTC).toISOString(),
      durationDays: task.duration_days,
      elapsedMs,
      elapsedDays,
      shouldComplete
    });
  }

  return shouldComplete;
}

/**
 * 生成下次执行时间
 *
 * ⚠️ 注意：此函数返回的是 Date 对象，其内部存储的是 UTC 时间戳
 * 在 updateTaskStatus 中会通过 toISOString() 转换为 ISO 8601 格式（UTC）存储到数据库
 * 数据库查询时使用 next_run_at <= datetime('now') 进行比较（datetime('now')返回UTC）
 *
 * 🔧 修复(2025-12-31): 所有"下一个整点"的计算必须基于任务时区，而不是服务器本地时间
 *
 * @param timezone - 时区
 * @param task - 可选，任务对象（用于计算首次执行时间）
 * @returns 下次执行时间（Date对象，内部存储为UTC）
 */
export function generateNextRunAt(timezone: string, task?: ClickFarmTask): Date {
  const now = new Date();

  // 🔧 修复(2025-12-31): 防御性检查，确保 task 是有效对象
  if (!task || typeof task !== 'object') {
    console.warn('[generateNextRunAt] 无效的任务对象，返回任务时区的下一个整点');
    return getNextHourInTimezone(now, timezone);
  }

  // 如果提供了任务对象且任务未开始，计算首次执行时间
  if (task.scheduled_start_date && !task.started_at) {
    // 🔧 修复(2025-12-31): 确保 scheduled_start_date 是 "YYYY-MM-DD" 格式的字符串
    // PostgreSQL date 类型返回 Date 对象，需要转换
    let scheduledStartDateStr: string;
    const dateValue = task.scheduled_start_date as any;
    if (typeof dateValue === 'string') {
      // 如果已经是字符串，提取日期部分（处理 "2025-12-31T00:00:00.000Z" 格式）
      scheduledStartDateStr = dateValue.split('T')[0];
    } else if (dateValue instanceof Date) {
      // 如果是 Date 对象，转换为 YYYY-MM-DD 格式
      const year = dateValue.getFullYear();
      const month = String(dateValue.getMonth() + 1).padStart(2, '0');
      const day = String(dateValue.getDate()).padStart(2, '0');
      scheduledStartDateStr = `${year}-${month}-${day}`;
    } else {
      scheduledStartDateStr = String(dateValue);
    }

    // 使用 getDateInTimezone 获取任务时区的当前日期
    const todayInTaskTimezone = getDateInTimezone(new Date(), timezone);

    // 在同一时区进行日期对比
    if (scheduledStartDateStr < todayInTaskTimezone) {
      // 还没有到开始日期，返回任务时区的下一个小时
      return getNextHourInTimezone(now, timezone);
    }

    // 如果已经到了或超过开始日期，计算首次执行时间
    // 找到第一个有点击数的小时
    const hourlyDistribution = task.hourly_distribution || [];
    const firstActiveHour = Array.isArray(hourlyDistribution)
      ? hourlyDistribution.findIndex(count => count > 0)
      : -1;

    if (firstActiveHour !== -1) {
      // 解析 start_time (格式: "HH:mm")
      const startTimeStr = String(task.start_time || '06:00');
      const [startHourStr] = startTimeStr.split(':');
      const startHour = parseInt(startHourStr) || 0;

      // 使用第一个活跃小时和start_time中较大的那个
      const targetHour = Math.max(firstActiveHour, startHour);

      // 🔧 修复(2025-12-31): 使用字符串格式的日期传递给 createDateInTimezone
      const firstRunAt = createDateInTimezone(
        scheduledStartDateStr,
        `${targetHour}:00`,
        timezone
      );

      // 如果计算出的时间是过去，返回任务时区的下一个整点
      if (firstRunAt <= now) {
        return getNextHourInTimezone(now, timezone);
      }

      return firstRunAt;
    }
  }

  // 默认逻辑：返回任务时区中下一个有配额的小时
  // 🔧 优化：直接跳到下一个有配额且在执行范围内的小时，避免逐小时跳过
  return getNextHourWithQuota(now, task);
}

/**
 * 🆕 获取指定时区的下一个整点时间
 *
 * @param now - 当前时间
 * @param timezone - 目标时区
 * @returns 下一个整点的 Date 对象（UTC）
 *
 * @example
 * // 当前 UTC 时间：2025-12-31 03:12:00
 * // 伦敦时间（GMT）：2025-12-31 03:12:00
 * getNextHourInTimezone(now, 'Europe/London')
 * // 返回：伦敦时间 04:00 = UTC 04:00
 */
function getNextHourInTimezone(now: Date, timezone: string): Date {
  // 获取任务时区的当前时间
  const currentHour = getHourInTimezone(now, timezone);
  const currentDate = getDateInTimezone(now, timezone);

  // 计算下一个整点（当前小时 + 1）
  let nextHour = currentHour + 1;
  let nextDate = currentDate;

  // 如果超过 23 点，进入下一天的 0 点
  if (nextHour >= 24) {
    nextHour = 0;
    const [year, month, day] = currentDate.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    dateObj.setDate(dateObj.getDate() + 1);
    nextDate = dateObj.toISOString().split('T')[0];
  }

  // 在任务时区中构造下一个整点的时间
  return createDateInTimezone(
    nextDate,
    `${nextHour.toString().padStart(2, '0')}:00`,
    timezone
  );
}

/**
 * 🆕 获取任务时区中下一个有配额的小时
 * 用于优化 next_run_at，避免逐小时跳过
 *
 * @param now - 当前时间
 * @param task - 任务对象
 * @returns 下一个有配额小时的执行时间（UTC）
 *
 * 🔧 修复(2026-01-05): 添加调试日志追踪调度决策
 */
function getNextHourWithQuota(now: Date, task: ClickFarmTask): Date {
  const currentHour = getHourInTimezone(now, task.timezone);
  const currentDate = getDateInTimezone(now, task.timezone);
  const hourlyDistribution = task.hourly_distribution || [];

  // 解析 start_time 和 end_time
  const startTimeStr = String(task.start_time || '06:00');
  const [startHourStr] = startTimeStr.split(':');
  const startHour = parseInt(startHourStr) || 0;

  const endTimeStr = String(task.end_time || '24:00');
  const [endHourStr] = endTimeStr.split(':');
  let endHour = parseInt(endHourStr) || 0;
  if (endTimeStr === '24:00') {
    endHour = 23; // 24:00 等同于 23:59，使用 23:59 后的下一个整点
  }

  // 🔧 调试日志：记录搜索条件
  const debugInfo = {
    taskId: task.id,
    timezone: task.timezone,
    currentHour,
    currentDate,
    startHour,
    endHour,
    hourlyDistribution: hourlyDistribution.join(',')
  }

  // 从下一个小时开始搜索，找到第一个有配额且在执行范围内的小时
  for (let i = 1; i <= 24; i++) {
    const checkHour = (currentHour + i) % 24;
    const checkDate = currentHour + i >= 24
      ? incrementDate(currentDate)
      : currentDate;

    // 检查是否在执行时间范围内
    const isInTimeRange = startHour <= endHour
      ? checkHour >= startHour && checkHour <= endHour
      : checkHour >= startHour || checkHour <= endHour; // 跨越午夜的情况

    const hasQuota = hourlyDistribution[checkHour] > 0;

    // 🔧 记录每次检查
    if (process.env.DEBUG_CLICK_FARM === 'true') {
      console.log(`[getNextHourWithQuota] 检查: hour=${checkHour}, date=${checkDate}, inRange=${isInTimeRange}, quota=${hourlyDistribution[checkHour]}`)
    }

    if (isInTimeRange && hasQuota) {
      // 🔧 找到目标小时，记录日志
      console.log(`[getNextHourWithQuota] ✅ 找到目标小时: taskId=${task.id}, currentHour=${currentHour}, targetHour=${checkHour}, targetDate=${checkDate}, quota=${hourlyDistribution[checkHour]}`)

      return createDateInTimezone(
        checkDate,
        `${checkHour.toString().padStart(2, '0')}:00`,
        task.timezone
      );
    }
  }

  // 如果没找到今天有配额的小时，返回明天第一个有配额的小时
  // 搜索明天的 0-23 小时
  const tomorrowDate = incrementDate(currentDate);
  for (let hour = 0; hour < 24; hour++) {
    if (hourlyDistribution[hour] > 0) {
      console.log(`[getNextHourWithQuota] ⏩ 今日无配额，跳转到明天: taskId=${task.id}, targetHour=${hour}, targetDate=${tomorrowDate}, quota=${hourlyDistribution[hour]}`)

      return createDateInTimezone(
        tomorrowDate,
        `${hour.toString().padStart(2, '0')}:00`,
        task.timezone
      );
    }
  }

  // 如果没有任何有配额的小时（理论上不应该发生），返回明天的 start_time
  console.log(`[getNextHourWithQuota] ⚠️ 无有效配额，返回明天start_time: taskId=${task.id}, startHour=${startHour}`)

  return createDateInTimezone(
    tomorrowDate,
    `${startHour.toString().padStart(2, '0')}:00`,
    task.timezone
  );
}

/**
 * 🆕 日期字符串 +1 天
 */
function incrementDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  // 使用 UTC 日期运算，避免服务器本地时区导致跨天计算回退到“当天”。
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + 1);
  return utcDate.toISOString().split('T')[0];
}
