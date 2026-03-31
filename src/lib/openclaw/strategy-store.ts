import crypto from 'crypto'
import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'
import { toDbJsonObjectField } from '@/lib/json-field'

export async function createStrategyRun(params: {
  userId: number
  mode: string
  runDate: string
  configJson?: unknown
}): Promise<string> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const runId = crypto.randomUUID()

  const insertSql = `INSERT INTO strategy_center_runs
     (id, user_id, mode, status, run_date, config_json, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ${nowFunc}, ${nowFunc})`

  await db.exec(insertSql, [
    runId,
    params.userId,
    params.mode,
    params.runDate,
    toDbJsonObjectField(params.configJson ?? null, db.type, null),
  ])

  return runId
}

export async function updateStrategyRun(params: {
  runId: string
  userId: number
  status?: string
  statsJson?: unknown
  errorMessage?: string | null
  startedAt?: string | null
  completedAt?: string | null
}): Promise<void> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const fields: string[] = []
  const values: any[] = []

  if (params.status) {
    fields.push('status = ?')
    values.push(params.status)
  }
  if (params.statsJson !== undefined) {
    fields.push('stats_json = ?')
    values.push(toDbJsonObjectField(params.statsJson, db.type, null))
  }
  if (params.errorMessage !== undefined) {
    fields.push('error_message = ?')
    values.push(params.errorMessage)
  }
  if (params.startedAt !== undefined) {
    fields.push('started_at = ?')
    values.push(params.startedAt)
  }
  if (params.completedAt !== undefined) {
    fields.push('completed_at = ?')
    values.push(params.completedAt)
  }

  if (fields.length === 0) return

  await db.exec(
    `UPDATE strategy_center_runs
     SET ${fields.join(', ')}, updated_at = ${nowFunc}
     WHERE id = ? AND user_id = ?`,
    [...values, params.runId, params.userId]
  )
}

export async function touchStrategyRun(params: {
  runId: string
  userId: number
}): Promise<void> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  await db.exec(
    `UPDATE strategy_center_runs
     SET updated_at = ${nowFunc}
     WHERE id = ? AND user_id = ?`,
    [params.runId, params.userId]
  )
}

export async function recordStrategyAction(params: {
  runId: string
  userId: number
  actionType: string
  targetType?: string | null
  targetId?: string | null
  status?: string
  requestJson?: unknown
  responseJson?: unknown
  errorMessage?: string | null
}): Promise<number> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const insertSql = db.type === 'postgres'
    ? `INSERT INTO strategy_center_actions
       (run_id, user_id, action_type, target_type, target_id, status, request_json, response_json, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc}) RETURNING id`
    : `INSERT INTO strategy_center_actions
       (run_id, user_id, action_type, target_type, target_id, status, request_json, response_json, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc})`

  const result = await db.exec(insertSql, [
    params.runId,
    params.userId,
    params.actionType,
    params.targetType || null,
    params.targetId || null,
    params.status || 'pending',
    toDbJsonObjectField(params.requestJson ?? null, db.type, null),
    toDbJsonObjectField(params.responseJson ?? null, db.type, null),
    params.errorMessage || null,
  ])

  return getInsertedId(result, db.type)
}

export async function updateStrategyAction(params: {
  actionId: number
  userId: number
  status?: string
  responseJson?: unknown
  errorMessage?: string | null
}): Promise<void> {
  const db = await getDatabase()
  const fields: string[] = []
  const values: any[] = []

  if (params.status) {
    fields.push('status = ?')
    values.push(params.status)
  }
  if (params.responseJson !== undefined) {
    fields.push('response_json = ?')
    values.push(toDbJsonObjectField(params.responseJson, db.type, null))
  }
  if (params.errorMessage !== undefined) {
    fields.push('error_message = ?')
    values.push(params.errorMessage)
  }

  if (fields.length === 0) return

  await db.exec(
    `UPDATE strategy_center_actions SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
    [...values, params.actionId, params.userId]
  )
}

// ---------------------------------------------------------------------------
// Knowledge base functions
// ---------------------------------------------------------------------------

export type KnowledgeEntry = {
  report_date: string
  summary_json: unknown
  notes?: string | null
}

export type StrategyMode = 'expand' | 'defensive' | 'hold' | 'insufficient_data'

export async function saveKnowledgeEntry(
  userId: number,
  entry: KnowledgeEntry
): Promise<void> {
  const db = await getDatabase()

  await db.exec(
    `INSERT INTO openclaw_knowledge_base (user_id, report_date, summary_json, notes)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, report_date)
     DO UPDATE SET summary_json = excluded.summary_json, notes = excluded.notes`,
    [userId, entry.report_date, toDbJsonObjectField(entry.summary_json, db.type, null), entry.notes || null]
  )
}

export async function getRecentKnowledge(
  userId: number,
  days: number
): Promise<Array<{ id: number; report_date: string; summary_json: unknown; notes: string | null; created_at: string }>> {
  const db = await getDatabase()

  return db.query(
    `SELECT id, report_date, summary_json, notes, created_at
     FROM openclaw_knowledge_base
     WHERE user_id = ? AND report_date >= date('now', '-${days} days')
     ORDER BY report_date DESC`,
    [userId]
  )
}

function safeParseJson(value: unknown): Record<string, any> {
  if (!value) return {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>
  }
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export async function generateKnowledgeSummary(
  userId: number
): Promise<{
  totalDays: number
  avgRoas: number
  avgSpend: number
  avgRevenue: number
  avgPublishSuccessRate: number
  recentMode: string | null
  discoveries: string[]
  lessons: string[]
}> {
  const entries = await getRecentKnowledge(userId, 30)

  if (entries.length === 0) {
    return {
      totalDays: 0,
      avgRoas: 0,
      avgSpend: 0,
      avgRevenue: 0,
      avgPublishSuccessRate: 0,
      recentMode: null,
      discoveries: [],
      lessons: [],
    }
  }

  let totalRoas = 0
  let totalSpend = 0
  let totalRevenue = 0
  let totalPublishRate = 0
  let validCount = 0
  let recentMode: string | null = null
  const allDiscoveries: string[] = []
  const allLessons: string[] = []

  for (const entry of entries) {
    const summary = safeParseJson(entry.summary_json)
    const s = summary.summary || summary

    if (s.roas !== undefined) {
      totalRoas += Number(s.roas) || 0
      totalSpend += Number(s.spend) || 0
      totalRevenue += Number(s.revenue) || 0
      totalPublishRate += Number(s.publish_success_rate) || 0
      validCount++
    }

    if (!recentMode && s.strategy_mode) {
      recentMode = s.strategy_mode
    }

    if (Array.isArray(summary.discoveries)) {
      allDiscoveries.push(...summary.discoveries.slice(0, 3))
    }
    if (Array.isArray(summary.lessons_learned)) {
      allLessons.push(...summary.lessons_learned.slice(0, 3))
    }
  }

  const count = validCount || 1

  return {
    totalDays: entries.length,
    avgRoas: Math.round((totalRoas / count) * 100) / 100,
    avgSpend: Math.round((totalSpend / count) * 100) / 100,
    avgRevenue: Math.round((totalRevenue / count) * 100) / 100,
    avgPublishSuccessRate: Math.round((totalPublishRate / count) * 100) / 100,
    recentMode,
    discoveries: allDiscoveries.slice(0, 10),
    lessons: allLessons.slice(0, 10),
  }
}

export async function determineStrategyMode(
  userId: number
): Promise<{ mode: StrategyMode; reasoning: string }> {
  const recent = await getRecentKnowledge(userId, 7)

  if (recent.length < 3) {
    return {
      mode: 'insufficient_data',
      reasoning: `Only ${recent.length} day(s) of data available, need at least 3 days to determine strategy mode.`,
    }
  }

  let totalRoas = 0
  let totalPublishRate = 0
  let validCount = 0

  for (const entry of recent.slice(0, 3)) {
    const summary = safeParseJson(entry.summary_json)
    const s = summary.summary || summary
    if (s.roas !== undefined) {
      totalRoas += Number(s.roas) || 0
      totalPublishRate += Number(s.publish_success_rate) || 0
      validCount++
    }
  }

  if (validCount === 0) {
    return {
      mode: 'insufficient_data',
      reasoning: 'No valid ROAS data in recent knowledge entries.',
    }
  }

  const avgRoas = totalRoas / validCount
  const avgPublishRate = totalPublishRate / validCount

  if (avgRoas >= 1.5 && avgPublishRate >= 80) {
    return {
      mode: 'expand',
      reasoning: `3-day avg ROAS ${avgRoas.toFixed(2)} >= 1.5 and publish success rate ${avgPublishRate.toFixed(0)}% >= 80%. Conditions met for expansion.`,
    }
  }

  if (avgRoas < 1.0 || avgPublishRate < 60) {
    return {
      mode: 'defensive',
      reasoning: `3-day avg ROAS ${avgRoas.toFixed(2)} ${avgRoas < 1.0 ? '< 1.0' : ''} or publish success rate ${avgPublishRate.toFixed(0)}% ${avgPublishRate < 60 ? '< 60%' : ''}. Switching to defensive mode.`,
    }
  }

  return {
    mode: 'hold',
    reasoning: `3-day avg ROAS ${avgRoas.toFixed(2)} in 1.0-1.5 range, publish success rate ${avgPublishRate.toFixed(0)}%. Maintaining current parameters.`,
  }
}
