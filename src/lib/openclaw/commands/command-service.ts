import { randomUUID } from 'crypto'
import { getDatabase } from '@/lib/db'
import { boolParam, nowFunc } from '@/lib/db-helpers'
import { getQueueManagerForTaskType, isBackgroundQueueSplitEnabled } from '@/lib/queue/queue-routing'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'
import { isBackgroundWorkerAlive } from '@/lib/queue/background-worker-heartbeat'
import { failStaleQueuedCommandRuns } from './queued-timeout'
import type { OpenclawCommandRiskLevel } from './risk-policy'
import { deriveOpenclawCommandRiskLevel, requiresOpenclawCommandConfirmation } from './risk-policy'
import { assertOpenclawCommandRouteAllowed } from '@/lib/openclaw/canonical-routes'
import { normalizeOpenclawCommandPayload, normalizeOpenclawCommandQuery } from './payload-policy'
import {
  consumeCommandConfirmation,
  consumeCommandConfirmationByOwner,
  createOrRefreshCommandConfirmation,
  expireStaleCommandConfirmations,
  recordOpenclawCallbackEvent,
} from './confirm-service'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

function isEnvTrue(value?: string | null): boolean {
  if (!value) return false
  return TRUE_VALUES.has(value.toLowerCase())
}

async function resolveOpenclawCommandQueueManager() {
  const routedQueue = getQueueManagerForTaskType('openclaw-command')

  // split 模式 + web 进程下，若 background worker 心跳缺失，自动降级到 core 队列，
  // 避免命令任务长时间卡在 queued。
  if (isBackgroundQueueSplitEnabled() && !isEnvTrue(process.env.QUEUE_BACKGROUND_WORKER)) {
    const backgroundAlive = await isBackgroundWorkerAlive()
    if (!backgroundAlive) {
      console.warn(
        '[OpenClawCommand] 背景 worker 心跳缺失，命令任务降级到 core queue 执行'
      )
      return getQueueManager()
    }
  }

  return routedQueue
}

async function enqueueCommandRun(params: {
  runId: string
  userId: number
  riskLevel: OpenclawCommandRiskLevel
  parentRequestId?: string | null
  trigger: 'direct' | 'confirm'
}): Promise<string> {
  const priority = params.riskLevel === 'critical' || params.riskLevel === 'high' ? 'high' : 'normal'
  const queue = await resolveOpenclawCommandQueueManager()
  return queue.enqueue(
    'openclaw-command',
    {
      runId: params.runId,
      userId: params.userId,
      trigger: params.trigger,
    },
    params.userId,
    {
      priority,
      maxRetries: 0,
      parentRequestId: params.parentRequestId || undefined,
    }
  )
}

type AuthType = 'session' | 'user-token' | 'gateway-binding'

function normalizeCommandChannel(channel: string | null | undefined, authType: AuthType): string {
  const normalized = String(channel || '').trim().toLowerCase()
  if (normalized) return normalized

  if (authType === 'session') return 'web'
  if (authType === 'user-token') return 'user-token'
  return 'feishu'
}

function normalizeSenderId(senderId: string | null | undefined): string | null {
  const normalized = String(senderId || '').trim()
  return normalized || null
}

type ExecuteCommandInput = {
  userId: number
  authType: AuthType
  method: string
  path: string
  query?: Record<string, string | number | boolean | null | undefined>
  body?: any
  channel?: string | null
  senderId?: string | null
  intent?: string | null
  idempotencyKey?: string | null
  parentRequestId?: string | null
}

type QueueResult = {
  status: 'queued'
  runId: string
  taskId: string
  riskLevel: OpenclawCommandRiskLevel
}

type PendingConfirmResult = {
  status: 'pending_confirm'
  runId: string
  riskLevel: OpenclawCommandRiskLevel
  confirmToken: string
  expiresAt: string
}

type DuplicateResult = {
  status: 'duplicate'
  runId: string
  runStatus: string
  riskLevel: OpenclawCommandRiskLevel
  taskId?: string | null
}

export type ExecuteCommandResult = QueueResult | PendingConfirmResult | DuplicateResult

type OpenclawCommandRunSnapshot = {
  id: string
  status: string
  risk_level: OpenclawCommandRiskLevel
  queue_task_id: string | null
}

async function findRunByIdempotency(params: {
  userId: number
  idempotencyKey: string
}) {
  const db = await getDatabase()
  return db.queryOne<OpenclawCommandRunSnapshot>(
    `SELECT id, status, risk_level, queue_task_id
     FROM openclaw_command_runs
     WHERE user_id = ? AND idempotency_key = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [params.userId, params.idempotencyKey]
  )
}

async function findRunById(params: {
  db: Awaited<ReturnType<typeof getDatabase>>
  userId: number
  runId: string
}) {
  return params.db.queryOne<OpenclawCommandRunSnapshot>(
    `SELECT id, status, risk_level, queue_task_id
     FROM openclaw_command_runs
     WHERE user_id = ? AND id = ?
     LIMIT 1`,
    [params.userId, params.runId]
  )
}

async function autoConfirmAndQueueCommandRun(params: {
  db: Awaited<ReturnType<typeof getDatabase>>
  nowSql: string
  runId: string
  userId: number
  riskLevel: OpenclawCommandRiskLevel
  parentRequestId?: string | null
}): Promise<QueueResult | DuplicateResult> {
  await createOrRefreshCommandConfirmation({
    runId: params.runId,
    userId: params.userId,
  })

  const consumeResult = await consumeCommandConfirmationByOwner({
    runId: params.runId,
    userId: params.userId,
    decision: 'confirm',
  })

  if (!consumeResult.ok) {
    if (consumeResult.code !== 'already_processed') {
      throw new Error(`[OpenClawCommand] auto-confirm failed: ${consumeResult.code}`)
    }

    const latestRun = await findRunById({
      db: params.db,
      userId: params.userId,
      runId: params.runId,
    })
    const runStatus = latestRun?.status || consumeResult.runStatus || 'queued'
    const runRisk = latestRun?.risk_level || params.riskLevel
    const taskId = latestRun?.queue_task_id || null

    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        `[OpenClawCommand] auto-confirm 命中并发幂等，runId=${params.runId}, runStatus=${runStatus}`
      )
    }

    return {
      status: 'duplicate',
      runId: params.runId,
      runStatus,
      riskLevel: runRisk,
      taskId,
    }
  }

  if (consumeResult.status !== 'confirmed') {
    throw new Error(`[OpenClawCommand] auto-confirm failed: ${consumeResult.status}`)
  }

  const confirmedRiskLevel = consumeResult.riskLevel as OpenclawCommandRiskLevel

  try {
    const taskId = await enqueueCommandRun({
      runId: params.runId,
      userId: params.userId,
      riskLevel: confirmedRiskLevel,
      parentRequestId: params.parentRequestId,
      trigger: 'confirm',
    })

    await params.db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'queued', queue_task_id = ?, updated_at = ${params.nowSql}
       WHERE id = ? AND user_id = ?`,
      [taskId, params.runId, params.userId]
    )

    return {
      status: 'queued',
      runId: params.runId,
      taskId,
      riskLevel: confirmedRiskLevel,
    }
  } catch (error: any) {
    const message = error?.message || 'enqueue failed'
    await params.db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'failed', error_message = ?, completed_at = ${params.nowSql}, updated_at = ${params.nowSql}
       WHERE id = ? AND user_id = ?`,
      [message, params.runId, params.userId]
    )
    throw error
  }
}

export async function executeOpenclawCommand(input: ExecuteCommandInput): Promise<ExecuteCommandResult> {
  const db = await getDatabase()
  const nowSql = nowFunc(db.type)

  await expireStaleCommandConfirmations({ userId: input.userId })

  const validated = assertOpenclawCommandRouteAllowed({
    method: input.method || 'GET',
    path: String(input.path || '').trim(),
  })

  const method = validated.method
  const path = validated.normalizedPath

  const normalizedCommandPayload = normalizeOpenclawCommandPayload({
    method,
    path,
    body: input.body,
  })
  const normalizedCommandQuery = normalizeOpenclawCommandQuery({
    method,
    path,
    query: input.query,
  })

  const riskLevel = deriveOpenclawCommandRiskLevel({ method, path, strictCanonicalWrite: true })
  const requireConfirm = requiresOpenclawCommandConfirmation(riskLevel)
  const idempotencyKey = String(input.idempotencyKey || '').trim() || null

  const staleQueuedCount = await failStaleQueuedCommandRuns({
    db,
    userId: input.userId,
  })
  if (staleQueuedCount > 0 && process.env.NODE_ENV !== 'test') {
    console.warn(`[OpenClawCommand] 已自动收敛 ${staleQueuedCount} 条超时 queued 命令`)
  }

  if (idempotencyKey) {
    const existing = await findRunByIdempotency({ userId: input.userId, idempotencyKey })
    if (existing) {
      if (existing.status === 'pending_confirm') {
        return autoConfirmAndQueueCommandRun({
          db,
          nowSql,
          runId: existing.id,
          userId: input.userId,
          riskLevel: existing.risk_level,
          parentRequestId: input.parentRequestId,
        })
      }

      return {
        status: 'duplicate',
        runId: existing.id,
        runStatus: existing.status,
        riskLevel: existing.risk_level,
        taskId: existing.queue_task_id,
      }
    }
  }

  const runId = randomUUID()

  const normalizedChannel = normalizeCommandChannel(input.channel, input.authType)
  const normalizedSenderId = normalizeSenderId(input.senderId)

  await db.exec(
    `INSERT INTO openclaw_command_runs
     (id, user_id, auth_type, channel, sender_id, intent,
      request_method, request_path, request_query_json, request_body_json,
      risk_level, status, confirm_required, idempotency_key, parent_request_id,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowSql}, ${nowSql})`,
    [
      runId,
      input.userId,
      input.authType,
      normalizedChannel,
      normalizedSenderId,
      input.intent || null,
      method,
      path,
      normalizedCommandQuery.query ? JSON.stringify(normalizedCommandQuery.query) : null,
      normalizedCommandPayload.body === undefined ? null : JSON.stringify(normalizedCommandPayload.body),
      riskLevel,
      requireConfirm ? 'pending_confirm' : 'draft',
      boolParam(requireConfirm, db.type),
      idempotencyKey,
      input.parentRequestId || null,
    ]
  )

  if (requireConfirm) {
    return autoConfirmAndQueueCommandRun({
      db,
      nowSql,
      runId,
      userId: input.userId,
      riskLevel,
      parentRequestId: input.parentRequestId,
    })
  }

  try {
    const taskId = await enqueueCommandRun({
      runId,
      userId: input.userId,
      riskLevel,
      parentRequestId: input.parentRequestId,
      trigger: 'direct',
    })

    await db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'queued', queue_task_id = ?, updated_at = ${nowSql}
       WHERE id = ? AND user_id = ?`,
      [taskId, runId, input.userId]
    )

    return {
      status: 'queued',
      runId,
      taskId,
      riskLevel,
    }
  } catch (error: any) {
    const message = error?.message || 'enqueue failed'
    await db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'failed', error_message = ?, completed_at = ${nowSql}, updated_at = ${nowSql}
       WHERE id = ? AND user_id = ?`,
      [message, runId, input.userId]
    )
    throw error
  }
}

type ConfirmInput = {
  runId: string
  userId: number
  confirmToken: string
  decision: 'confirm' | 'cancel'
  channel?: string | null
  callbackEventId?: string | null
  callbackEventType?: string | null
  callbackPayload?: any
  parentRequestId?: string | null
}

type ConfirmResult =
  | {
      status: 'queued'
      runId: string
      taskId: string
      riskLevel: OpenclawCommandRiskLevel
    }
  | {
      status: 'canceled'
      runId: string
    }
  | {
      status: 'expired'
      runId: string
    }
  | {
      status: 'already_processed'
      runId: string
      confirmStatus?: string
      runStatus?: string
    }
  | {
      status: 'duplicate_event'
      runId: string
      runStatus: string
    }
  | {
      status: 'invalid_token' | 'not_found'
      runId: string
    }

export async function confirmOpenclawCommand(input: ConfirmInput): Promise<ConfirmResult> {
  const db = await getDatabase()
  const nowSql = nowFunc(db.type)

  const staleQueuedCount = await failStaleQueuedCommandRuns({
    db,
    userId: input.userId,
  })
  if (staleQueuedCount > 0 && process.env.NODE_ENV !== 'test') {
    console.warn(`[OpenClawCommand] confirm 前已自动收敛 ${staleQueuedCount} 条超时 queued 命令`)
  }

  await expireStaleCommandConfirmations({ userId: input.userId })

  const run = await db.queryOne<{
    id: string
    status: string
    risk_level: OpenclawCommandRiskLevel
  }>(
    `SELECT id, status, risk_level
     FROM openclaw_command_runs
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [input.runId, input.userId]
  )

  if (!run) {
    return { status: 'not_found', runId: input.runId }
  }

  if (input.callbackEventId) {
    const callbackResult = await recordOpenclawCallbackEvent({
      userId: input.userId,
      channel: (input.channel || 'feishu').trim() || 'feishu',
      eventId: input.callbackEventId,
      eventType: input.callbackEventType || null,
      payloadJson: input.callbackPayload === undefined ? null : JSON.stringify(input.callbackPayload),
    })

    if (!callbackResult.accepted) {
      return {
        status: 'duplicate_event',
        runId: input.runId,
        runStatus: run.status,
      }
    }
  }

  const consumeResult = await consumeCommandConfirmation({
    runId: input.runId,
    userId: input.userId,
    confirmToken: input.confirmToken,
    decision: input.decision,
    callbackEventId: input.callbackEventId,
  })

  if (!consumeResult.ok) {
    if (consumeResult.code === 'expired') {
      return { status: 'expired', runId: input.runId }
    }
    if (consumeResult.code === 'already_processed') {
      return {
        status: 'already_processed',
        runId: input.runId,
        confirmStatus: consumeResult.confirmStatus,
        runStatus: consumeResult.runStatus,
      }
    }
    return { status: consumeResult.code, runId: input.runId }
  }

  if (consumeResult.status === 'canceled') {
    return {
      status: 'canceled',
      runId: input.runId,
    }
  }

  try {
    const taskId = await enqueueCommandRun({
      runId: input.runId,
      userId: input.userId,
      riskLevel: consumeResult.riskLevel as OpenclawCommandRiskLevel,
      parentRequestId: input.parentRequestId,
      trigger: 'confirm',
    })

    await db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'queued', queue_task_id = ?, updated_at = ${nowSql}
       WHERE id = ? AND user_id = ?`,
      [taskId, input.runId, input.userId]
    )

    return {
      status: 'queued',
      runId: input.runId,
      taskId,
      riskLevel: consumeResult.riskLevel as OpenclawCommandRiskLevel,
    }
  } catch (error: any) {
    const message = error?.message || 'enqueue failed'
    await db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'failed', error_message = ?, completed_at = ${nowSql}, updated_at = ${nowSql}
       WHERE id = ? AND user_id = ?`,
      [message, input.runId, input.userId]
    )
    throw error
  }
}

type OwnerConfirmInput = {
  runId: string
  userId: number
  decision: 'confirm' | 'cancel'
  parentRequestId?: string | null
}

export async function confirmOpenclawCommandByOwner(input: OwnerConfirmInput): Promise<ConfirmResult> {
  const db = await getDatabase()
  const nowSql = nowFunc(db.type)

  const staleQueuedCount = await failStaleQueuedCommandRuns({
    db,
    userId: input.userId,
  })
  if (staleQueuedCount > 0 && process.env.NODE_ENV !== 'test') {
    console.warn(`[OpenClawCommand] owner confirm 前已自动收敛 ${staleQueuedCount} 条超时 queued 命令`)
  }

  await expireStaleCommandConfirmations({ userId: input.userId })

  const run = await db.queryOne<{
    id: string
    status: string
    risk_level: OpenclawCommandRiskLevel
  }>(
    `SELECT id, status, risk_level
     FROM openclaw_command_runs
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [input.runId, input.userId]
  )

  if (!run) {
    return { status: 'not_found', runId: input.runId }
  }

  const consumeResult = await consumeCommandConfirmationByOwner({
    runId: input.runId,
    userId: input.userId,
    decision: input.decision,
  })

  if (!consumeResult.ok) {
    if (consumeResult.code === 'expired') {
      return { status: 'expired', runId: input.runId }
    }
    if (consumeResult.code === 'already_processed') {
      return {
        status: 'already_processed',
        runId: input.runId,
        confirmStatus: consumeResult.confirmStatus,
        runStatus: consumeResult.runStatus,
      }
    }
    return { status: consumeResult.code, runId: input.runId }
  }

  if (consumeResult.status === 'canceled') {
    return {
      status: 'canceled',
      runId: input.runId,
    }
  }

  try {
    const taskId = await enqueueCommandRun({
      runId: input.runId,
      userId: input.userId,
      riskLevel: consumeResult.riskLevel as OpenclawCommandRiskLevel,
      parentRequestId: input.parentRequestId,
      trigger: 'confirm',
    })

    await db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'queued', queue_task_id = ?, updated_at = ${nowSql}
       WHERE id = ? AND user_id = ?`,
      [taskId, input.runId, input.userId]
    )

    return {
      status: 'queued',
      runId: input.runId,
      taskId,
      riskLevel: consumeResult.riskLevel as OpenclawCommandRiskLevel,
    }
  } catch (error: any) {
    const message = error?.message || 'enqueue failed'
    await db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'failed', error_message = ?, completed_at = ${nowSql}, updated_at = ${nowSql}
       WHERE id = ? AND user_id = ?`,
      [message, input.runId, input.userId]
    )
    throw error
  }
}
