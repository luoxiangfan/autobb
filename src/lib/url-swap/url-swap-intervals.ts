/**
 * Url Swap 间隔配置（前后端共享）
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
] as const

export const URL_SWAP_ALLOWED_INTERVALS_MINUTES: number[] = URL_SWAP_INTERVAL_OPTIONS.map(
  (option) => option.value
)
