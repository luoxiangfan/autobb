const DEFAULT_TIMEZONE = process.env.TZ || 'Asia/Shanghai'

export function formatOpenclawLocalDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function isIsoDateLike(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function normalizeOpenclawReportDate(value?: string | null): string {
  const normalized = String(value || '').trim()
  const today = formatOpenclawLocalDate(new Date())
  if (!isIsoDateLike(normalized)) return today
  return normalized > today ? today : normalized
}

