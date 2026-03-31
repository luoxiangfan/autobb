import { getDatabase } from '@/lib/db'
import { expireStaleCommandConfirmations } from './confirm-service'
import { failStaleQueuedCommandRuns } from './queued-timeout'

type OpenclawRunStatus =
  | 'draft'
  | 'pending_confirm'
  | 'confirmed'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'expired'

type OpenclawRiskLevel = 'low' | 'medium' | 'high' | 'critical'
type OpenclawRiskLevelFilter = OpenclawRiskLevel | 'high_or_above'

const ALLOWED_STATUSES = new Set<OpenclawRunStatus>([
  'draft',
  'pending_confirm',
  'confirmed',
  'queued',
  'running',
  'completed',
  'failed',
  'canceled',
  'expired',
])

const ALLOWED_RISK_LEVELS = new Set<OpenclawRiskLevelFilter>([
  'low',
  'medium',
  'high',
  'critical',
  'high_or_above',
])

function normalizePage(value?: number): number {
  if (!Number.isFinite(value)) return 1
  const page = Math.floor(Number(value))
  return page > 0 ? page : 1
}

function normalizeLimit(value?: number): number {
  if (!Number.isFinite(value)) return 20
  const limit = Math.floor(Number(value))
  if (limit <= 0) return 20
  return Math.min(limit, 100)
}

function normalizeStatus(value?: string | null): OpenclawRunStatus | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized || normalized === 'all') return null
  if (ALLOWED_STATUSES.has(normalized as OpenclawRunStatus)) {
    return normalized as OpenclawRunStatus
  }
  return null
}

function normalizeRiskLevel(value?: string | null): OpenclawRiskLevelFilter | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized || normalized === 'all') return null
  if (ALLOWED_RISK_LEVELS.has(normalized as OpenclawRiskLevelFilter)) {
    return normalized as OpenclawRiskLevelFilter
  }
  return null
}

function normalizeCreatedAfter(value?: string | null): string | null {
  const normalized = String(value || '').trim()
  if (!normalized) return null

  const parsedAt = Date.parse(normalized)
  if (!Number.isFinite(parsedAt)) {
    return null
  }
  return new Date(parsedAt).toISOString()
}

type ListOpenclawCommandRunsInput = {
  userId: number
  page?: number
  limit?: number
  status?: string | null
  riskLevel?: string | null
  createdAfter?: string | null
}

type OpenclawCommandRunRow = {
  id: string
  intent: string | null
  request_method: string
  request_path: string
  risk_level: OpenclawRiskLevel
  status: OpenclawRunStatus
  confirm_required: number | boolean
  confirm_expires_at: string | null
  queue_task_id: string | null
  response_status: number | null
  response_body_excerpt: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
}

type OpenclawCommandConfirmRow = {
  run_id: string
  status: string
  expires_at: string | null
  callback_event_id: string | null
  updated_at: string
}

export type OpenclawCommandRunListItem = {
  runId: string
  intent: string | null
  request: {
    method: string
    path: string
  }
  riskLevel: OpenclawRiskLevel
  status: OpenclawRunStatus
  confirmRequired: boolean
  confirmExpiresAt: string | null
  confirmStatus: string | null
  confirmCallbackEventId: string | null
  queueTaskId: string | null
  responseStatus: number | null
  responseExcerpt: string | null
  responsePreview: unknown | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

function normalizeResponseExcerpt(value: string | null): string | null {
  const normalized = String(value || '').trim()
  return normalized || null
}

function parseResponsePreview(value: string | null): unknown | null {
  const excerpt = normalizeResponseExcerpt(value)
  if (!excerpt) return null
  try {
    return JSON.parse(excerpt)
  } catch {
    return null
  }
}

export type ListOpenclawCommandRunsResult = {
  items: OpenclawCommandRunListItem[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  filters: {
    status: OpenclawRunStatus | null
    riskLevel: OpenclawRiskLevelFilter | null
    createdAfter: string | null
  }
}

export async function listOpenclawCommandRuns(
  input: ListOpenclawCommandRunsInput
): Promise<ListOpenclawCommandRunsResult> {
  const db = await getDatabase()

  await failStaleQueuedCommandRuns({
    db,
    userId: input.userId,
  })
  await expireStaleCommandConfirmations({ userId: input.userId })

  const page = normalizePage(input.page)
  const limit = normalizeLimit(input.limit)
  const status = normalizeStatus(input.status)
  const riskLevel = normalizeRiskLevel(input.riskLevel)
  const createdAfter = normalizeCreatedAfter(input.createdAfter)
  const offset = (page - 1) * limit

  const whereSqlParts = ['user_id = ?']
  const whereParams: Array<string | number> = [input.userId]

  if (status) {
    whereSqlParts.push('status = ?')
    whereParams.push(status)
  }

  if (riskLevel) {
    if (riskLevel === 'high_or_above') {
      whereSqlParts.push('risk_level IN (?, ?)')
      whereParams.push('high', 'critical')
    } else {
      whereSqlParts.push('risk_level = ?')
      whereParams.push(riskLevel)
    }
  }

  if (createdAfter) {
    whereSqlParts.push('created_at >= ?')
    whereParams.push(createdAfter)
  }

  const whereSql = whereSqlParts.join(' AND ')

  const totalRow = await db.queryOne<{ total: number | string }>(
    `SELECT COUNT(1) AS total
     FROM openclaw_command_runs
     WHERE ${whereSql}`,
    whereParams
  )

  const total = Number(totalRow?.total || 0)

  const runRows = await db.query<OpenclawCommandRunRow>(
    `SELECT
       id,
       intent,
       request_method,
       request_path,
       risk_level,
       status,
       confirm_required,
       confirm_expires_at,
       queue_task_id,
       response_status,
       CASE
         WHEN response_body IS NULL THEN NULL
         ELSE substr(response_body, 1, 2000)
       END AS response_body_excerpt,
       error_message,
       created_at,
       updated_at,
       started_at,
       completed_at
     FROM openclaw_command_runs
     WHERE ${whereSql}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...whereParams, limit, offset]
  )

  const runIds = runRows.map((row) => row.id)

  let confirmByRunId = new Map<string, OpenclawCommandConfirmRow>()
  if (runIds.length > 0) {
    const placeholders = runIds.map(() => '?').join(', ')
    const confirmRows = await db.query<OpenclawCommandConfirmRow>(
      `SELECT run_id, status, expires_at, callback_event_id, updated_at
       FROM openclaw_command_confirms
       WHERE run_id IN (${placeholders})`,
      runIds
    )

    confirmByRunId = new Map(confirmRows.map((row) => [row.run_id, row]))
  }

  const items = runRows.map((row) => {
    const confirm = confirmByRunId.get(row.id)
    const confirmRequired = (row.confirm_required as any) === true || (row.confirm_required as any) === 1

    return {
      runId: row.id,
      intent: row.intent,
      request: {
        method: row.request_method,
        path: row.request_path,
      },
      riskLevel: row.risk_level,
      status: row.status,
      confirmRequired,
      confirmExpiresAt: row.confirm_expires_at,
      confirmStatus: confirm?.status || null,
      confirmCallbackEventId: confirm?.callback_event_id || null,
      queueTaskId: row.queue_task_id,
      responseStatus: row.response_status,
      responseExcerpt: normalizeResponseExcerpt(row.response_body_excerpt),
      responsePreview: parseResponsePreview(row.response_body_excerpt),
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    }
  })

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    filters: {
      status,
      riskLevel,
      createdAfter,
    },
  }
}
