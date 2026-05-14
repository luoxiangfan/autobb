const WARNING_CODE_LABEL: Record<string, string> = {
  OFFER_TASK_PAUSE_FAILED: '关联任务暂停失败',
  OFFER_NOT_BOUND: '未关联 Offer',
}

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
