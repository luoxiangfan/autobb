/**
 * 换链接任务系统类型定义
 * src/lib/url-swap-types.ts
 *
 * 功能：自动监测和更新Google Ads广告链接
 * 当Offer的推广链接发生变化时，系统能够自动检测并更新广告系列的Final URL Suffix
 */

/**
 * 换链接任务状态
 */
export type UrlSwapTaskStatus =
  | 'enabled'    // 已启用（正常运行）
  | 'disabled'   // 已禁用（用户手动）
  | 'error'      // 错误（需要用户干预）
  | 'completed'; // 已完成（duration_days到期）

/**
 * 换链方式
 * - auto：方式一，自动访问推广链接解析suffix
 * - manual：方式二，用户配置推广链接列表轮询并解析
 */
export type UrlSwapMode = 'auto' | 'manual'

/**
 * 调度结果状态
 */
export type TriggerResultStatus =
  | 'queued'     // 已入队
  | 'skipped'    // 跳过（状态不是enabled）
  | 'error'      // 错误
  | 'completed'; // 已完成

/**
 * 换链接任务
 */
export interface UrlSwapTask {
  // === 基础信息 ===
  id: string;              // UUID，主键
  user_id: number;         // 用户ID（数据隔离）
  offer_id: number;        // 关联的Offer ID

  // === 任务配置 ===
  swap_interval_minutes: number; // 换链间隔（分钟）：5, 10, 15, 30, 60, 120, 240, 360, 480, 720, 1440
  enabled: boolean;        // 是否启用
  duration_days: number;   // 任务持续天数：-1表示无限期

  // === 换链方式（方式一/方式二） ===
  swap_mode: UrlSwapMode;  // 换链方式：auto/manual
  manual_affiliate_links: string[]; // 手动模式：推广链接列表（完整URL）
  manual_suffix_cursor: number; // 手动模式：轮询游标（下一次要使用的列表索引）

  // === Google Ads关联 ===
  google_customer_id: string | null;   // Google Ads Customer ID
  google_campaign_id: string | null;   // Google Ads Campaign ID

  // === 当前生效的URL ===
  current_final_url: string | null;           // 当前Final URL（不含查询参数）
  current_final_url_suffix: string | null;    // 当前Final URL Suffix（查询参数部分）

  // === 实时统计 ===
  progress: number;         // 完成百分比（0-100）
  total_swaps: number;      // 总执行次数
  success_swaps: number;    // 成功次数
  failed_swaps: number;     // 失败次数
  url_changed_count: number; // URL实际发生变化的次数
  consecutive_failures: number; // 连续失败次数（用于自动暂停策略）

  // === 历史数据（简化版，不需要按小时分布） ===
  swap_history: SwapHistoryEntry[];

  // === 状态管理 ===
  status: UrlSwapTaskStatus;
  error_message: string | null;
  error_at: string | null;

  // === 调度时间（简单UTC时间） ===
  started_at: string | null;     // 首次执行时间
  completed_at: string | null;   // 完成时间
  next_swap_at: string | null;   // 下次执行时间（UTC时间）

  // === 软删除 ===
  is_deleted: boolean;
  deleted_at: string | null;

  // === 时间戳 ===
  created_at: string;
  updated_at: string;

  // === 多目标支持（可选） ===
  targets?: UrlSwapTaskTarget[];
}

/**
 * 换链接任务目标（多Campaign/多账号）
 */
export interface UrlSwapTaskTarget {
  id: string;
  task_id: string;
  offer_id: number;
  google_ads_account_id: number;
  google_customer_id: string;
  google_campaign_id: string;
  status: 'active' | 'paused' | 'removed' | 'invalid';
  consecutive_failures: number;
  last_success_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 任务列表项 - 用于前端显示，包含Offer的产品标识信息
 */
export interface UrlSwapTaskListItem extends UrlSwapTask {
  offer_name?: string; // 该任务对应的Offer的产品标识（如 "Eufy_GB_02"）
}

/**
 * 换链历史记录条目
 */
export interface SwapHistoryEntry {
  swapped_at: string;                  // 换链时间（ISO 8601 UTC）
  previous_final_url: string;          // 之前的Final URL
  previous_final_url_suffix: string;   // 之前的Suffix
  new_final_url: string;               // 新的Final URL
  new_final_url_suffix: string;        // 新的Suffix
  success: boolean;                    // 是否成功
  error_message?: string;              // 错误信息（失败时）
}

/**
 * 调度结果类型
 */
export interface TriggerResult {
  taskId: string;
  status: TriggerResultStatus;
  message: string;
}

/**
 * 队列任务数据类型
 * 传递给统一队列执行器
 */
export interface UrlSwapTaskData {
  taskId: string;
  offerId: number;
  affiliateLink: string;
  targetCountry: string;
  googleCustomerId: string | null;
  googleCampaignId: string | null;
  currentFinalUrl: string | null;
  currentFinalUrlSuffix: string | null;
}

/**
 * 创建换链接任务请求
 */
export interface CreateUrlSwapTaskRequest {
  offer_id: number;
  swap_interval_minutes?: number;  // 可选，默认60
  duration_days?: number;          // 可选，默认7
  google_customer_id?: string | null;
  google_campaign_id?: string | null;
  swap_mode?: UrlSwapMode;         // 可选，默认auto
  manual_affiliate_links?: string[]; // 手动模式：推广链接列表（完整URL）
}

/**
 * 更新换链接任务请求
 */
export interface UpdateUrlSwapTaskRequest {
  swap_interval_minutes?: number;
  duration_days?: number;
  google_customer_id?: string | null;
  google_campaign_id?: string | null;
  swap_mode?: UrlSwapMode;
  manual_affiliate_links?: string[];
}

/**
 * 任务验证结果
 */
export interface UrlSwapValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

/**
 * URL变更检测结果
 */
export interface UrlChangeDetectionResult {
  changed: boolean;
  newFinalUrl?: string;
  newFinalUrlSuffix?: string;
  error?: string;
}

/**
 * 任务级统计
 */
export interface UrlSwapTaskStats {
  // 基本统计
  swap_count: number;          // 总换链次数
  success_count: number;       // 成功次数
  failed_count: number;        // 失败次数
  success_rate: number;        // 成功率百分比

  // 时间信息
  last_swap_at: string | null; // 最后换链时间
  next_swap_at: string | null; // 下次换链时间

  // 当前URL（前端展示）
  current_final_url: string;
  current_final_url_suffix: string;

  // 状态
  status: string;
}

/**
 * 全局统计（管理员视图）
 */
export interface UrlSwapGlobalStats {
  // 任务统计
  total_tasks: number;         // 总任务数
  active_tasks: number;        // 启用的任务数（enabled）
  disabled_tasks: number;      // 禁用的任务数（disabled）
  error_tasks: number;         // 错误的任务数（error）
  completed_tasks: number;     // 已完成的任务数（completed）

  // 操作统计
  total_swaps: number;         // 总换链次数
  success_swaps: number;       // 成功次数
  failed_swaps: number;        // 失败次数
  url_changed_count: number;   // URL实际发生变化的总次数
  success_rate: number;        // 成功率百分比
}
