/**
 * Url-swap task read/query operations.
 */
import { getDatabase, boolParam } from '@/lib/db'
import { filterRowsByUserPackageExpiry } from '@/lib/common/task-scheduling'
import type { UrlSwapTask, UrlSwapTaskStatus, UrlSwapTaskListItem } from './url-swap-types'
import { parseUrlSwapTask } from './url-swap-row'

/**
 * 获取任务（带权限验证）
 */
export async function getUrlSwapTaskById(id: string, userId: number): Promise<UrlSwapTask | null> {
  const db = await getDatabase()

  const isDeletedCondition = '(is_deleted = FALSE OR is_deleted IS NULL)'

  const task =
    userId === 0
      ? await db.queryOne<any>(
          `
        SELECT * FROM url_swap_tasks
        WHERE id = ? AND ${isDeletedCondition}
      `,
          [id]
        )
      : await db.queryOne<any>(
          `
        SELECT * FROM url_swap_tasks
        WHERE id = ? AND user_id = ? AND ${isDeletedCondition}
      `,
          [id, userId]
        )

  if (!task) return null

  return parseUrlSwapTask(task)
}

/**
 * 根据Offer ID获取任务
 */
export async function getUrlSwapTaskByOfferId(
  offerId: number,
  userId: number
): Promise<UrlSwapTask | null> {
  const db = await getDatabase()

  const isDeletedCondition = '(is_deleted = FALSE OR is_deleted IS NULL)'

  const task = await db.queryOne<any>(
    `
    SELECT * FROM url_swap_tasks
    WHERE offer_id = ? AND user_id = ? AND ${isDeletedCondition}
    ORDER BY created_at DESC
  `,
    [offerId, userId]
  )

  if (!task) return null

  return parseUrlSwapTask(task)
}

/**
 * 检查Offer是否已有关联任务
 */
export async function hasUrlSwapTask(offerId: number, userId: number): Promise<boolean> {
  const task = await getUrlSwapTaskByOfferId(offerId, userId)
  return task !== null && task.status !== 'completed'
}

/**
 * 获取任务列表
 */
export async function getUrlSwapTasks(
  userId: number,
  options: {
    status?: UrlSwapTaskStatus
    include_deleted?: boolean
    page?: number
    limit?: number
  } = {}
): Promise<{ tasks: UrlSwapTaskListItem[]; total: number }> {
  const db = await getDatabase()
  const page = options.page || 1
  const limit = options.limit || 20
  const offset = (page - 1) * limit

  const isDeletedCondition = 'ust.is_deleted = FALSE'
  let whereClause = 'ust.user_id = ?'
  const params: any[] = [userId]

  if (!options.include_deleted) {
    whereClause += ` AND ${isDeletedCondition}`
  }

  if (options.status) {
    whereClause += ' AND ust.status = ?'
    params.push(options.status)
  }

  // 获取总数
  const countResult = await db.queryOne<{ count: number }>(
    `
    SELECT COUNT(*) as count FROM url_swap_tasks ust
    WHERE ${whereClause}
  `,
    params
  )

  const total = countResult?.count || 0

  // 获取任务列表
  const tasks = await db.query<any>(
    `
    SELECT ust.*, o.offer_name
    FROM url_swap_tasks ust
    LEFT JOIN offers o ON ust.offer_id = o.id
    WHERE ${whereClause}
    ORDER BY ust.created_at DESC
    LIMIT ? OFFSET ?
  `,
    [...params, limit, offset]
  )

  return {
    tasks: tasks.map((row) => {
      const task = parseUrlSwapTask(row) as UrlSwapTaskListItem
      if (row?.offer_name) task.offer_name = row.offer_name
      return task
    }),
    total,
  }
}

/**
 * 获取待处理的任务（用于调度器）
 */
export async function getPendingTasks(): Promise<UrlSwapTask[]> {
  const db = await getDatabase()

  const isDeletedCondition = '(ust.is_deleted = FALSE OR ust.is_deleted IS NULL)'
  const nowCondition = 'CURRENT_TIMESTAMP'

  // 🔒 用户禁用/过期后不再调度其任务（避免继续入队）
  const rows = await db.query<any>(
    `
    SELECT
      ust.*,
      u.package_expires_at as user_package_expires_at
    FROM url_swap_tasks ust
    INNER JOIN users u ON u.id = ust.user_id
    WHERE ust.status = 'enabled'
      AND ust.next_swap_at <= ${nowCondition}
      AND ust.started_at <= ${nowCondition}
      AND ${isDeletedCondition}
      AND u.is_active = ?
    ORDER BY ust.next_swap_at ASC
  `,
    [boolParam(true)]
  )

  const tasks = filterRowsByUserPackageExpiry(rows)

  return tasks.map(parseUrlSwapTask)
}

/**
 * 获取所有任务列表（管理员）
 */
export async function getAllUrlSwapTasks(
  options: {
    status?: UrlSwapTaskStatus
    page?: number
    limit?: number
  } = {}
): Promise<{ tasks: (UrlSwapTask & { username?: string; offer_name?: string })[]; total: number }> {
  const db = await getDatabase()
  const page = options.page || 1
  const limit = options.limit || 20
  const offset = (page - 1) * limit

  const isDeletedCondition = 'ust.is_deleted = FALSE'
  let whereClause = isDeletedCondition
  const params: any[] = []

  if (options.status) {
    whereClause += ' AND ust.status = ?'
    params.push(options.status)
  }

  // 获取总数
  const countResult = await db.queryOne<{ count: number }>(
    `
    SELECT COUNT(*) as count FROM url_swap_tasks ust
    WHERE ${whereClause}
  `,
    params
  )

  const total = countResult?.count || 0

  // 获取任务列表（关联用户表）
  const tasks = await db.query<any>(
    `
    SELECT ust.*, u.username, o.offer_name
    FROM url_swap_tasks ust
    LEFT JOIN users u ON ust.user_id = u.id
    LEFT JOIN offers o ON ust.offer_id = o.id
    WHERE ${whereClause}
    ORDER BY ust.created_at DESC
    LIMIT ? OFFSET ?
  `,
    [...params, limit, offset]
  )

  return {
    tasks: tasks.map((t) => ({
      ...parseUrlSwapTask(t),
      username: t.username,
      offer_name: t.offer_name,
    })),
    total,
  }
}
