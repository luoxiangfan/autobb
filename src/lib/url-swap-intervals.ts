/**
 * Url Swap 间隔配置（前后端共享）
 * - `URL_SWAP_INTERVAL_OPTIONS`：前端下拉框展示的选项
 * - `URL_SWAP_ALLOWED_INTERVALS_MINUTES`：后端允许写入/更新的所有值（包含历史兼容值）
 */

export const URL_SWAP_INTERVAL_OPTIONS = [
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 120, label: '2 小时' },
  { value: 360, label: '6 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '24 小时' },
] as const;

// 历史版本允许但当前 UI 未暴露的值（避免已有任务在“仅改持续天数”等场景下被阻断）
export const URL_SWAP_LEGACY_INTERVALS_MINUTES = [240, 480] as const;

export const URL_SWAP_ALLOWED_INTERVALS_MINUTES: number[] = Array.from(new Set([
  ...URL_SWAP_INTERVAL_OPTIONS.map(o => o.value),
  ...URL_SWAP_LEGACY_INTERVALS_MINUTES,
])).sort((a, b) => a - b);
