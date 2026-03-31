// 补点击功能类型定义
// src/lib/click-farm-types.ts

/**
 * 任务状态
 */
export type ClickFarmTaskStatus =
  | 'pending'    // 等待开始
  | 'running'    // 运行中
  | 'paused'     // 已暂停（代理缺失）
  | 'stopped'    // 已暂停（用户手动）
  | 'completed'; // 已完成

/**
 * 暂停原因
 */
export type PauseReason =
  | 'no_proxy'   // 缺少代理
  | 'manual'     // 手动暂停
  | null;

/**
 * 补点击任务
 */
export interface ClickFarmTask {
  id: string;
  user_id: number;
  offer_id: number;

  // 任务配置
  daily_click_count: number;
  /**
   * start_time: "06:00" 表示该时间点是相对于任务的 timezone（目标国家的本地时间）
   * 例如：offer.target_country = "US"，timezone = "America/New_York"
   * 则 start_time: "06:00" 表示 US 东部时间的 06:00，任务不会在这个时间前执行
   * 格式: "HH:mm"（24小时制）
   */
  start_time: string;
  /**
   * end_time: "24:00" 表示该时间点是相对于任务的 timezone（目标国家的本地时间）
   * 任务不会在这个时间后执行
   * 格式: "HH:mm"（24小时制）
   */
  end_time: string;
  duration_days: number;  // -1表示无限期
  /**
   * scheduled_start_date: "2024-12-30" 表示任务的计划开始日期
   * ⚠️ 重要：这是相对于 timezone（目标国家时区）的本地日期，不是 UTC 日期
   * 例如：timezone = "America/New_York"，scheduled_start_date = "2024-12-30"
   * 则任务会在纽约时间 2024-12-30 的 start_time 时刻开始执行
   * 格式: "YYYY-MM-DD"
   */
  scheduled_start_date: string;
  /**
   * hourly_distribution: [10, 5, 8, ..., 12] 长度为24的数组
   * ⚠️ 重要：索引 i（0-23）表示任务 timezone（目标国家时区）的第 i 个小时
   * hourly_distribution[0] = 10 表示该时区的 00:00-01:00 内执行 10 次点击
   * hourly_distribution[6] = 30 表示该时区的 06:00-07:00 内执行 30 次点击
   * ❌ 注意：这不是 UTC 小时数，而是目标时区的本地小时数
   * 例如：timezone = "Asia/Shanghai"，hourly_distribution[6] = 30
   * 表示上海时间 06:00-07:00，而不是 UTC 06:00-07:00
   */
  hourly_distribution: number[];

  // 状态管理
  status: ClickFarmTaskStatus;
  pause_reason: PauseReason;
  pause_message: string | null;
  paused_at: string | null;

  // 实时统计
  progress: number;  // 0-100百分比
  total_clicks: number;
  success_clicks: number;
  failed_clicks: number;

  // 历史数据
  daily_history: DailyHistoryEntry[];

  /**
   * timezone: "America/New_York" 任务执行的目标时区
   * 这是一个 IANA 时区标识符，自动从 offer.target_country（目标国家代码）匹配得到
   * ⚠️ 重要：所有与时间相关的字段都相对于这个 timezone：
   * - start_time: "06:00" 表示该时区的 06:00
   * - end_time: "24:00" 表示该时区的 24:00
   * - scheduled_start_date: "2024-12-30" 表示该时区的 2024-12-30
   * - hourly_distribution[i] 表示该时区的第 i 个小时（0-23）
   * - started_at: 当 Cron 首次在该时区达到 scheduled_start_date 时设置
   * - completed_at: 当任务运行 duration_days 天后自动完成
   *
   * 示例：
   * timezone = "Asia/Shanghai"，scheduled_start_date = "2024-12-30"
   * 则任务在上海时间 2024-12-30 00:00:00 后的下一个 start_time 时刻开始执行
   * 而不是 UTC 的 2024-12-30 00:00:00
   *
   * 常见值: "America/New_York"（US）, "Europe/London"（UK）, "Asia/Shanghai"（CN）, 等
   */
  timezone: string;

  /**
   * 🆕 referer_config: Referer 头配置
   * 控制点击请求的 Referer 头，模拟不同来源的流量
   */
  referer_config: { type: 'none' | 'random' | 'specific' | 'custom'; referer?: string } | null;

  // 软删除
  is_deleted: boolean;
  deleted_at: string | null;

  // 时间戳
  started_at: string | null;
  completed_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 每日历史记录条目
 */
export interface DailyHistoryEntry {
  /**
   * date: "2024-12-30" 表示任务时区的本地日期
   * ⚠️ 重要：必须相对于 task.timezone（目标国家时区）的本地日期
   * 例如：task.timezone = "Asia/Shanghai"
   * 则 date = "2024-12-30" 表示上海时间的 2024-12-30，而不是 UTC 的 2024-12-30
   * 格式: "YYYY-MM-DD"
   */
  date: string;  // YYYY-MM-DD (相对于task.timezone)
  target: number;  // 目标点击数
  actual: number;  // 实际执行数
  success: number;  // 成功次数
  failed: number;  // 失败次数

  /**
   * 🆕 hourly_breakdown：每小时的详细执行数据
   * 用于支持"实际执行分布"vs"配置分布"的对比功能
   * 索引0-23对应0点到23点（相对于task.timezone）
   */
  hourly_breakdown?: {
    target: number;    // 该小时目标点击数
    actual: number;    // 该小时实际执行数
    success: number;   // 该小时成功数
    failed: number;    // 该小时失败数
  }[];
}

/**
 * 创建任务请求
 * ⚠️ 时区说明：所有时间参数都相对于创建时自动匹配的 timezone
 * 系统会从 offer.target_country 自动推导 timezone，用户无需手动指定
 */
export interface CreateClickFarmTaskRequest {
  offer_id: number;
  daily_click_count: number;  // 1-1000，默认216
  /**
   * start_time: "06:00" 相对于该任务的 timezone（目标国家的本地时间）
   * 格式 HH:mm（24小时制），任务不会在这个时间前执行
   */
  start_time: string;
  /**
   * end_time: "24:00" 相对于该任务的 timezone（目标国家的本地时间）
   * 格式 HH:mm（24小时制），任务不会在这个时间后执行
   */
  end_time: string;
  duration_days: number;  // 正整数(7/14/30/etc) 或 -1 表示无限期
  /**
   * scheduled_start_date: "2024-12-30" 相对于该任务的 timezone（目标国家时区的本地日期）
   * 格式 YYYY-MM-DD，默认当天。任务会在该日期的 start_time 时刻开始执行
   * 例如：timezone = "America/New_York"，scheduled_start_date = "2024-12-30"
   * 则任务在纽约时间 2024-12-30 的 start_time 时刻开始
   */
  scheduled_start_date?: string;
  /**
   * hourly_distribution: [10, 5, 8, ..., 12] 长度为24的数组
   * 索引 i（0-23）表示该时区的第 i 个小时的点击数
   * hourly_distribution[6] = 30 表示该时区的 06:00-07:00 内执行 30 次点击
   */
  hourly_distribution: number[];
  /**
   * timezone: IANA 时区标识符，默认从 offer.target_country 自动匹配
   * 可选字段，通常由后端自动设置，无需手动指定
   * 示例: "America/New_York", "Europe/London", "Asia/Shanghai"
   */
  timezone?: string;
  /**
   * 🆕 refererConfig: Referer来源配置
   * 用于防止反爬检测，模拟真实用户来源
   * - none: 不设置Referer头
   * - random: 每次点击随机从社交媒体列表中选择Referer
   * - specific: 使用指定的固定社交媒体Referer URL
   * - custom: 使用用户自定义的Referer URL
   */
  referer_config?: {
    type: 'none' | 'random' | 'specific' | 'custom';
    referer?: string;  // specific/custom类型时的固定Referer URL
  };
}

/**
   * 🆕 Referer配置类型
   */
export type RefererConfigType = 'none' | 'random' | 'specific' | 'custom';

/**
 * 🆕 社交媒体Referer选项（用于UI下拉选择）
 */
export const REFERER_OPTIONS = [
  { value: 'none', label: '留空', description: '不设置Referer头' },
  { value: 'random', label: '随机', description: '随机选择社交媒体来源' },
  { value: 'specific', label: '固定', description: '使用固定社交媒体来源' },
  { value: 'custom', label: '自定义', description: '输入任意Referer URL' },
] as const;

export const SOCIAL_MEDIA_REFERRERS = [
  { value: 'https://www.facebook.com/', label: 'Facebook' },
  { value: 'https://mail.google.com/', label: 'Gmail' },
  { value: 'https://www.instagram.com/', label: 'Instagram' },
  { value: 'https://www.linkedin.com/', label: 'LinkedIn' },
  { value: 'https://medium.com/', label: 'Medium' },
  { value: 'https://www.pinterest.com/', label: 'Pinterest' },
  { value: 'https://www.quora.com/', label: 'Quora' },
  { value: 'https://www.reddit.com/', label: 'Reddit' },
  { value: 'https://www.snapchat.com/', label: 'Snapchat' },
  { value: 'https://www.tiktok.com/', label: 'TikTok' },
  { value: 'https://x.com/', label: 'Twitter/X' },  // 🔥 2026-01-05: Twitter/X 官网已变更为 x.com
  { value: 'https://wa.me/', label: 'WhatsApp' },
  { value: 'https://www.youtube.com/', label: 'YouTube' },
] as const;

/**
 * 更新任务请求
 */
export interface UpdateClickFarmTaskRequest {
  daily_click_count?: number;
  start_time?: string;
  end_time?: string;
  duration_days?: number;
  scheduled_start_date?: string;  // 🆕 YYYY-MM-DD格式
  hourly_distribution?: number[];
  timezone?: string;  // 🆕 允许更新timezone（用于offer变更场景）
  referer_config?: {  // 🆕 Referer配置
    type: 'none' | 'random' | 'specific' | 'custom';
    referer?: string;
  };
}

/**
 * 任务筛选条件
 */
export interface TaskFilters {
  status?: ClickFarmTaskStatus;
  offer_id?: number;
  include_deleted?: boolean;
  page?: number;
  limit?: number;
}

/**
 * 任务列表项 - 用于前端显示，包含Offer的国家和产品信息
 */
export interface ClickFarmTaskListItem extends ClickFarmTask {
  target_country?: string;  // 该任务对应的Offer的目标国家代码（如 "US", "UK", "CN"）
  offer_name?: string;  // 该任务对应的Offer的产品标识（如 "Eufy_GB_02"）
}

/**
 * 任务统计数据
 */
export interface ClickFarmStats {
  today: {
    clicks: number;
    successClicks: number;
    failedClicks: number;
    successRate: number;  // 百分比
    traffic: number;  // bytes
  };
  cumulative: {
    clicks: number;
    successClicks: number;
    failedClicks: number;
    successRate: number;  // 百分比
    traffic: number;  // bytes
  };
  // 🆕 任务状态分布
  taskStatusDistribution: {
    pending: number;    // 等待开始
    running: number;    // 运行中
    paused: number;     // 已暂停
    stopped: number;    // 已暂停（手动）
    completed: number;  // 已完成
    total: number;      // 总任务数（不含已删除）
  };
}

/**
 * 时间分布数据
 */
export interface HourlyDistribution {
  date: string;  // YYYY-MM-DD
  hourlyActual: number[];  // 24个整数，实际执行次数
  hourlyConfigured: number[];  // 24个整数，配置分布
  matchRate: number;  // 匹配度百分比（保留字段，UI暂不显示）
}

/**
 * 子任务（Cron调度器使用）
 */
export interface SubTask {
  id: string;
  taskId: string;
  url: string;
  scheduledAt: Date;
  proxyCountry: string;
  status: 'pending' | 'success' | 'failed';
  errorCode?: string;
  errorMessage?: string;
}

/**
 * 点击结果
 */
export interface ClickResult {
  status: 'success' | 'failed';
  errorCode?: string;
  errorMessage?: string;
}

/**
 * API响应基础类型
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * 代理错误响应
 */
export interface ProxyRequiredError {
  error: 'proxy_required';
  message: string;
  suggestion: string;
  redirectTo: string;
}
