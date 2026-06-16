/** Shared batch click-farm / url-swap defaults (client-safe constants). */
export const BATCH_CLICK_FARM_TASK_DEFAULTS: {
  dailyClickCount: number
  startTime: string
  endTime: string
  durationDays: number
} = {
  dailyClickCount: 10,
  startTime: '06:00',
  endTime: '24:00',
  durationDays: 9999,
}

export const BATCH_URL_SWAP_TASK_DEFAULTS: {
  swapMode: 'auto' | 'manual'
  swapIntervalMinutes: number
  durationDays: number
} = {
  swapMode: 'auto',
  swapIntervalMinutes: 1440,
  durationDays: -1,
}
