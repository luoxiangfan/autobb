type GoogleAdsErrorEntryLike = {
  message?: unknown
  error_code?: unknown
  errorCode?: unknown
  details?: unknown
}

const QUOTA_MESSAGE_PATTERNS = [
  'too many requests',
  'quota_error',
  'number of operations for explorer access',
]

const RETRY_IN_SECONDS_PATTERN = /retry in\s+(\d+)\s+seconds/i

function coercePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.ceil(value)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const direct = Number.parseInt(trimmed, 10)
    if (Number.isFinite(direct) && direct > 0) return direct

    const fallbackMatch = trimmed.match(/\d+/)
    if (fallbackMatch) {
      const parsed = Number.parseInt(fallbackMatch[0], 10)
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
    return null
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const candidateKeys = [
      'seconds',
      '_seconds',
      'value',
      '_value',
      'low',
      '_low',
      'high',
      '_high',
      'unsigned',
      '_unsigned',
    ]

    for (const key of candidateKeys) {
      if (!(key in obj)) continue
      const parsed = coercePositiveInteger(obj[key])
      if (parsed !== null) return parsed
    }
  }

  return null
}

function extractMessages(error: unknown): string[] {
  const messages: string[] = []

  if (!error || typeof error !== 'object') {
    if (typeof error === 'string') {
      messages.push(error)
    }
    return messages
  }

  const root = error as Record<string, unknown>
  if (typeof root.message === 'string') {
    messages.push(root.message)
  }

  const entries = root.errors
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue
      const msg = (entry as Record<string, unknown>).message
      if (typeof msg === 'string') {
        messages.push(msg)
      }
    }
  }

  return messages
}

function extractRetryDelayFromDetails(details: unknown): number | null {
  if (!details || typeof details !== 'object') return null

  const detailsObj = details as Record<string, unknown>
  const quotaErrorDetails =
    (detailsObj.quota_error_details as Record<string, unknown> | undefined)
    || (detailsObj.quotaErrorDetails as Record<string, unknown> | undefined)

  if (!quotaErrorDetails || typeof quotaErrorDetails !== 'object') return null

  const retryDelay =
    (quotaErrorDetails.retry_delay as Record<string, unknown> | undefined)
    || (quotaErrorDetails.retryDelay as Record<string, unknown> | undefined)

  if (!retryDelay || typeof retryDelay !== 'object') return null

  const retryDelayObj = retryDelay as Record<string, unknown>
  const seconds = coercePositiveInteger(retryDelayObj.seconds ?? retryDelayObj._seconds)
  if (seconds !== null) return seconds

  return coercePositiveInteger(retryDelayObj)
}

function hasQuotaErrorCode(entry: GoogleAdsErrorEntryLike): boolean {
  const code = entry.error_code ?? entry.errorCode
  if (!code || typeof code !== 'object') return false
  const codeObj = code as Record<string, unknown>
  return 'quota_error' in codeObj || 'quotaError' in codeObj
}

export function extractGoogleAdsRetryDelaySeconds(error: unknown): number | null {
  for (const message of extractMessages(error)) {
    const match = message.match(RETRY_IN_SECONDS_PATTERN)
    if (!match) continue
    const parsed = Number.parseInt(match[1], 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  if (!error || typeof error !== 'object') return null
  const entries = (error as Record<string, unknown>).errors
  if (!Array.isArray(entries)) return null

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const seconds = extractRetryDelayFromDetails((entry as GoogleAdsErrorEntryLike).details)
    if (seconds !== null) return seconds
  }

  return null
}

export function isGoogleAdsQuotaRateError(error: unknown): boolean {
  const messages = extractMessages(error)
  if (messages.some((message) => {
    const normalized = message.toLowerCase()
    return QUOTA_MESSAGE_PATTERNS.some((pattern) => normalized.includes(pattern))
  })) {
    return true
  }

  if (!error || typeof error !== 'object') return false
  const entries = (error as Record<string, unknown>).errors
  if (!Array.isArray(entries)) return false

  return entries.some((entry) => {
    if (!entry || typeof entry !== 'object') return false
    return hasQuotaErrorCode(entry as GoogleAdsErrorEntryLike)
  })
}
