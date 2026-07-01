import { getDatabase } from '@/lib/db'

const MAX_LOG_BODY = 20000
const REDACT_PATTERNS: Array<[RegExp, string]> = [
  [/oc_[A-Za-z0-9_-]{16,}/g, 'oc_***'],
  [/("apiKey"\s*:\s*")([^"]+)(")/gi, '$1***$3'],
  [/("appSecret"\s*:\s*")([^"]+)(")/gi, '$1***$3'],
  [/("token"\s*:\s*")([^"]+)(")/gi, '$1***$3'],
  [/("accessToken"\s*:\s*")([^"]+)(")/gi, '$1***$3'],
  [/("refreshToken"\s*:\s*")([^"]+)(")/gi, '$1***$3'],
  [/("authorization"\s*:\s*")([^"]+)(")/gi, '$1***$3'],
  [/(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1***'],
]

export function redactOpenclawActionLogText(value: string | null | undefined): string | null {
  if (!value) return null

  let normalized = value
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    normalized = normalized.replace(pattern, replacement)
  }

  return normalized
}

export function sanitizeOpenclawActionLogText(
  value: string | null | undefined,
  maxLength: number = MAX_LOG_BODY
): string | null {
  const redacted = redactOpenclawActionLogText(value)
  if (!redacted) return null
  if (redacted.length <= maxLength) return redacted
  return `${redacted.slice(0, maxLength)}...`
}

export async function recordOpenclawAction(params: {
  userId: number
  channel?: string | null
  senderId?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  requestBody?: string | null
  responseBody?: string | null
  status?: 'success' | 'error'
  errorMessage?: string | null
  runId?: string | null
  riskLevel?: string | null
  confirmStatus?: string | null
  latencyMs?: number | null
}): Promise<void> {
  const db = await getDatabase()
  const latencyMs = typeof params.latencyMs === 'number' && Number.isFinite(params.latencyMs)
    ? Math.max(0, Math.round(params.latencyMs))
    : null

  await db.exec(
    `INSERT INTO openclaw_action_logs
     (user_id, channel, sender_id, action, target_type, target_id, request_body, response_body, status, error_message, run_id, risk_level, confirm_status, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.userId,
      params.channel || null,
      params.senderId || null,
      params.action,
      params.targetType || null,
      params.targetId || null,
      sanitizeOpenclawActionLogText(params.requestBody),
      sanitizeOpenclawActionLogText(params.responseBody),
      params.status || 'success',
      sanitizeOpenclawActionLogText(params.errorMessage || null),
      params.runId || null,
      params.riskLevel || null,
      params.confirmStatus || null,
      latencyMs,
    ]
  )
}
