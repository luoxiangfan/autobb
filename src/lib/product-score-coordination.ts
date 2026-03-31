import { randomUUID } from 'crypto'

import { REDIS_PREFIX_CONFIG } from '@/lib/config'
import type { Task } from '@/lib/queue/types'
import { getRedisClient } from '@/lib/redis-client'

export type ProductScoreTrigger = 'manual' | 'schedule' | 'sync-complete'

export interface ProductScoreRequeueRequest {
  includeSeasonalityAnalysis: boolean
  forceFullRescore: boolean
  trigger: ProductScoreTrigger
  updatedAt: string
}

export interface ProductScoreExecutionMutex {
  acquired: boolean
  token: string
  refresh: () => Promise<boolean>
  release: () => Promise<void>
}

const PRODUCT_SCORE_MUTEX_TTL_FALLBACK_MS = 20 * 60 * 1000
const PRODUCT_SCORE_REQUEUE_TTL_SECONDS = 6 * 60 * 60

function getProductScoreMutexKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.queueBackground}mutex:product-score-calculation:user:${userId}`
}

function getProductScoreRequeueKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}product-score:requeue:user:${userId}`
}

function normalizeTrigger(trigger?: ProductScoreTrigger): ProductScoreTrigger {
  if (trigger === 'manual' || trigger === 'sync-complete') {
    return trigger
  }

  return 'schedule'
}

function mergeTrigger(
  existing?: ProductScoreTrigger,
  incoming?: ProductScoreTrigger
): ProductScoreTrigger {
  if (existing === 'manual' || incoming === 'manual') {
    return 'manual'
  }

  if (existing === 'sync-complete' || incoming === 'sync-complete') {
    return 'sync-complete'
  }

  return 'schedule'
}

function parseRequeueRequest(raw: string | null): ProductScoreRequeueRequest | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<ProductScoreRequeueRequest>
    return {
      includeSeasonalityAnalysis: parsed.includeSeasonalityAnalysis !== false,
      forceFullRescore: Boolean(parsed.forceFullRescore),
      trigger: normalizeTrigger(parsed.trigger),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export async function findExistingProductScoreTask(
  queue: {
    initialize?: () => Promise<void>
    getRunningTasks: () => Promise<Task[]>
    getPendingTasks: () => Promise<Task[]>
  },
  userId: number,
  excludeTaskId?: string
): Promise<Task | null> {
  if (typeof queue.initialize === 'function') {
    await queue.initialize()
  }

  const [runningTasks, pendingTasks] = await Promise.all([
    queue.getRunningTasks(),
    queue.getPendingTasks(),
  ])

  const matcher = (task: Task) => (
    task.type === 'product-score-calculation'
    && task.userId === userId
    && task.id !== excludeTaskId
  )

  return runningTasks.find(matcher) || pendingTasks.find(matcher) || null
}

export async function markProductScoreRequeueNeeded(
  userId: number,
  params: {
    includeSeasonalityAnalysis?: boolean
    forceRecalculate?: boolean
    trigger?: ProductScoreTrigger
    productIds?: number[]
  } = {}
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const key = getProductScoreRequeueKey(userId)
  const existing = parseRequeueRequest(await redis.get(key))
  const shouldForceFullRescore = Boolean(
    existing?.forceFullRescore
    || (params.forceRecalculate && (!params.productIds || params.productIds.length === 0))
  )

  const merged: ProductScoreRequeueRequest = {
    includeSeasonalityAnalysis: Boolean(
      existing?.includeSeasonalityAnalysis || params.includeSeasonalityAnalysis
    ),
    forceFullRescore: shouldForceFullRescore,
    trigger: mergeTrigger(existing?.trigger, params.trigger),
    updatedAt: new Date().toISOString(),
  }

  await redis.set(
    key,
    JSON.stringify(merged),
    'EX',
    PRODUCT_SCORE_REQUEUE_TTL_SECONDS
  )
}

export async function consumeProductScoreRequeueRequest(
  userId: number
): Promise<ProductScoreRequeueRequest | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const key = getProductScoreRequeueKey(userId)
  const raw = await redis.get(key)
  if (!raw) return null

  await redis.del(key)
  return parseRequeueRequest(raw)
}

export async function acquireProductScoreExecutionMutex(
  userId: number,
  ownerId: string,
  ttlMs: number = PRODUCT_SCORE_MUTEX_TTL_FALLBACK_MS
): Promise<ProductScoreExecutionMutex> {
  const redis = getRedisClient()
  const token = `${ownerId}:${randomUUID()}`

  if (!redis) {
    return {
      acquired: true,
      token,
      refresh: async () => true,
      release: async () => {},
    }
  }

  const key = getProductScoreMutexKey(userId)
  const safeTtlMs = Math.max(60_000, ttlMs)
  const acquired = await redis.set(key, token, 'PX', safeTtlMs, 'NX') === 'OK'

  const refresh = async (): Promise<boolean> => {
    const result = await redis.eval(
      `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('PEXPIRE', KEYS[1], ARGV[2])
        end
        return 0
      `,
      1,
      key,
      token,
      String(safeTtlMs)
    )

    return Number(result) === 1
  }

  const release = async (): Promise<void> => {
    await redis.eval(
      `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        end
        return 0
      `,
      1,
      key,
      token
    )
  }

  return {
    acquired,
    token,
    refresh,
    release,
  }
}
