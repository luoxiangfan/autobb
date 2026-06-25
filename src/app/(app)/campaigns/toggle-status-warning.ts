const WARNING_CODE_LABEL: Record<string, string> = {
  OFFER_TASK_PAUSE_FAILED: '关联任务暂停失败',
  OFFER_TASK_RESUME_FAILED: '关联任务恢复失败',
  OFFER_NOT_BOUND: '未关联 Offer',
}

/* * 暂停广告系列确认弹窗：关联 Offer 任务副作用说明 */
export const PAUSE_CAMPAIGN_OFFER_TASK_HINTS = [
  '同步暂停关联 Offer 的补点击任务（标记为已停止）',
  '同步禁用关联 Offer 的换链接任务',
] as const

/* * 启用广告系列确认弹窗：关联 Offer 任务恢复/创建说明 */
export const ENABLE_CAMPAIGN_OFFER_TASK_HINTS = [
  '若任务仍存在：按默认参数恢复补点击/换链接任务（队列缺失时由调度器重新入队）',
  '若任务不存在或已完成：按默认参数重新创建补点击与换链接任务',
  '默认参数与批量开启任务一致（补点击每日 10 次、06:00–24:00；换链自动模式、24 小时间隔）',
] as const

export function formatToggleStatusWarnings(
  warnings: Array<{ code?: unknown; message?: unknown }>
): string {
  return warnings
    .map((item) => {
      const code = String(item?.code || '').trim()
      const message = String(item?.message || '').trim()
      if (!message) return ''
      const label = WARNING_CODE_LABEL[code] || code
      return label ? `[${label}] ${message}` : message
    })
    .filter(Boolean)
    .join('；')
}
