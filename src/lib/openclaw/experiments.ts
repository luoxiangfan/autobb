import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'
import { toDbJsonObjectField } from '@/lib/json-field'

export type ExperimentResultRecord = {
  id: number
  user_id: number
  experiment_name: string
  experiment_type: string
  offer_id: number | null
  campaign_id: number | null
  variant_a: unknown
  variant_b: unknown
  metrics_a: unknown
  metrics_b: unknown
  winner: string | null
  confidence: number | null
  conclusion: string | null
  status: string
  started_at: string
  ended_at: string | null
  created_at: string
}

export async function listExperiments(
  userId: number,
  opts?: { limit?: number; status?: string }
): Promise<ExperimentResultRecord[]> {
  const db = await getDatabase()
  const limit = Math.min(opts?.limit || 50, 200)
  const conditions: string[] = ['user_id = ?']
  const params: any[] = [userId]

  if (opts?.status) {
    conditions.push('status = ?')
    params.push(opts.status)
  }

  params.push(limit)

  return db.query<ExperimentResultRecord>(
    `SELECT * FROM openclaw_experiment_results
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ?`,
    params
  )
}

export async function createExperiment(
  userId: number,
  data: {
    experiment_name: string
    experiment_type: string
    offer_id?: number | null
    campaign_id?: number | null
    variant_a?: any
    variant_b?: any
    status?: string
  }
): Promise<ExperimentResultRecord> {
  const db = await getDatabase()
  const variantA = toDbJsonObjectField(data.variant_a ?? null, db.type, null)
  const variantB = toDbJsonObjectField(data.variant_b ?? null, db.type, null)

  const result = await db.exec(
    `INSERT INTO openclaw_experiment_results
     (user_id, experiment_name, experiment_type, offer_id, campaign_id, variant_a, variant_b, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      data.experiment_name,
      data.experiment_type,
      data.offer_id ?? null,
      data.campaign_id ?? null,
      variantA,
      variantB,
      data.status ?? 'running',
    ]
  )

  const insertedId = getInsertedId(result, db.type)
  const record = await db.queryOne<ExperimentResultRecord>(
    'SELECT * FROM openclaw_experiment_results WHERE id = ?',
    [insertedId]
  )

  if (!record) {
    throw new Error('Failed to create experiment record')
  }

  return record
}

export async function recordExperimentMetrics(
  userId: number,
  experimentId: number,
  variant: 'a' | 'b',
  metrics: Record<string, any>
): Promise<void> {
  const db = await getDatabase()
  const metricsJson = toDbJsonObjectField(metrics, db.type, {})
  const field = variant === 'a' ? 'metrics_a' : 'metrics_b'

  await db.exec(
    `UPDATE openclaw_experiment_results SET ${field} = ? WHERE id = ? AND user_id = ?`,
    [metricsJson, experimentId, userId]
  )
}

export async function evaluateExperiment(
  userId: number,
  experimentId: number
): Promise<{ winner: string | null; confidence: number; conclusion: string }> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  const experiment = await db.queryOne<ExperimentResultRecord>(
    'SELECT * FROM openclaw_experiment_results WHERE id = ? AND user_id = ?',
    [experimentId, userId]
  )

  if (!experiment) {
    throw new Error(`Experiment ${experimentId} not found`)
  }

  const metricsA = safeParseJson(experiment.metrics_a)
  const metricsB = safeParseJson(experiment.metrics_b)

  // Simple evaluation: compare primary metric (roas, ctr, or conversion_rate)
  const primaryMetric = metricsA.roas !== undefined ? 'roas'
    : metricsA.ctr !== undefined ? 'ctr'
    : metricsA.conversion_rate !== undefined ? 'conversion_rate'
    : null

  let winner: string | null = null
  let confidence = 0
  let conclusion = 'Insufficient metrics data to evaluate.'

  if (primaryMetric && metricsA[primaryMetric] !== undefined && metricsB[primaryMetric] !== undefined) {
    const valA = Number(metricsA[primaryMetric]) || 0
    const valB = Number(metricsB[primaryMetric]) || 0
    const diff = Math.abs(valA - valB)
    const avg = (valA + valB) / 2 || 1

    // Relative difference as confidence proxy
    confidence = Math.min(Math.round((diff / avg) * 100), 100)

    if (valA > valB && confidence >= 10) {
      winner = 'A'
      conclusion = `Variant A outperforms B on ${primaryMetric} (${valA.toFixed(2)} vs ${valB.toFixed(2)}, ${confidence}% relative difference).`
    } else if (valB > valA && confidence >= 10) {
      winner = 'B'
      conclusion = `Variant B outperforms A on ${primaryMetric} (${valB.toFixed(2)} vs ${valA.toFixed(2)}, ${confidence}% relative difference).`
    } else {
      winner = null
      conclusion = `No significant difference between variants on ${primaryMetric} (A: ${valA.toFixed(2)}, B: ${valB.toFixed(2)}).`
    }
  }

  await db.exec(
    `UPDATE openclaw_experiment_results
     SET winner = ?, confidence = ?, conclusion = ?, status = 'completed', ended_at = ${nowFunc}
     WHERE id = ? AND user_id = ?`,
    [winner, confidence, conclusion, experimentId, userId]
  )

  return { winner, confidence, conclusion }
}

export async function getExperimentHistory(
  userId: number,
  offerId?: number | null
): Promise<ExperimentResultRecord[]> {
  const db = await getDatabase()
  const conditions: string[] = ['user_id = ?']
  const params: any[] = [userId]

  if (offerId) {
    conditions.push('offer_id = ?')
    params.push(offerId)
  }

  return db.query<ExperimentResultRecord>(
    `SELECT * FROM openclaw_experiment_results
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 100`,
    params
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
