/**
 * Click-farm task read/query operations.
 */
import { getDatabase, boolParam } from '@/lib/db'
import { filterRowsByUserPackageExpiry } from '@/lib/common/task-scheduling'
import type { ClickFarmTask, ClickFarmTaskListItem, TaskFilters } from './click-farm-types'
import { parseClickFarmTask } from './click-farm-row'

export async function getClickFarmTaskById(
  id: number | string,
  userId: number
): Promise<ClickFarmTask | null> {
  const db = await getDatabase()

  const task = await db.queryOne<any>(
    `
    SELECT * FROM click_farm_tasks
    WHERE id = ? AND user_id = ? AND is_deleted = FALSE
  `,
    [id, userId]
  )

  if (!task) return null

  return parseClickFarmTask(task)
}

/**
 * 获取任务列表
 */
export async function getClickFarmTasks(
  userId: number,
  filters: TaskFilters = {}
): Promise<{ tasks: ClickFarmTaskListItem[]; total: number }> {
  const db = await getDatabase()

  const whereConditions: string[] = ['cft.user_id = ?']
  const params: any[] = [userId]

  if (!filters.include_deleted) {
    whereConditions.push('cft.is_deleted = FALSE')
  }

  if (filters.status) {
    whereConditions.push('cft.status = ?')
    params.push(filters.status)
  }

  if (filters.offer_id) {
    whereConditions.push('cft.offer_id = ?')
    params.push(filters.offer_id)
  }

  const whereClause = whereConditions.join(' AND ')

  let query = `
    SELECT cft.*, o.target_country, o.offer_name
    FROM click_farm_tasks cft
    LEFT JOIN offers o ON cft.offer_id = o.id
    WHERE ${whereClause}
  `

  // 分页
  const page = filters.page || 1
  const limit = filters.limit || 20
  const offset = (page - 1) * limit

  // 获取总数（注意：count查询需要完整的params，包含userId）
  const countParams = [...params] // 复制完整的params
  const countResult = await db.queryOne<{ count: number }>(
    `
    SELECT COUNT(*) as count
    FROM click_farm_tasks cft
    WHERE ${whereClause}
  `,
    countParams
  )

  const total = countResult?.count || 0

  // 获取任务列表
  query += ' ORDER BY cft.created_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const tasks = await db.query<any>(query, params)

  return {
    tasks: tasks.map(parseClickFarmTask),
    total,
  }
}

export async function getPendingTasks(): Promise<ClickFarmTask[]> {
  const db = await getDatabase()
  const pendingLimit = Math.max(100, Number(process.env.CLICK_FARM_PENDING_LIMIT || 1000) || 1000)

  // � 用户禁用/过期后不再调度其任务（避免继续入队）
  const rows = await db.query<any>(
    `
    SELECT
      cft.*,
      u.package_expires_at as user_package_expires_at
    FROM click_farm_tasks cft
    INNER JOIN users u ON u.id = cft.user_id
    WHERE cft.status IN ('pending', 'running')
      AND cft.is_deleted = FALSE
      AND (cft.next_run_at IS NULL OR cft.next_run_at <= NOW())
      AND u.is_active = ?
    ORDER BY
      CASE WHEN cft.next_run_at IS NULL THEN 0 ELSE 1 END,
      cft.next_run_at ASC,
      cft.created_at ASC
    LIMIT ${pendingLimit}
  `,
    [boolParam(true)]
  )

  const tasks = filterRowsByUserPackageExpiry(rows)

  // 添加调试日志
  if (process.env.DEBUG_CLICK_FARM === 'true') {
    console.log('[getPendingTasks] 查询结果:', {
      count: tasks.length,
      now: new Date().toISOString(),
      tasks: tasks.map((t) => ({
        id: t.id,
        status: t.status,
        next_run_at: t.next_run_at,
        started_at: t.started_at,
        duration_days: t.duration_days,
      })),
    })
  }

  return tasks.map(parseClickFarmTask)
}

/**
 * 新增 : 根据 Offer ID 获取补点击任务
 */
export async function getClickFarmTaskByOfferId(
  offerId: number,
  userId: number
): Promise<ClickFarmTask | null> {
  const db = await getDatabase()

  const isDeletedCondition = '(is_deleted = FALSE OR is_deleted IS NULL)'

  const task = (await db.queryOne(
    `
    SELECT * FROM click_farm_tasks
    WHERE offer_id = ? AND user_id = ? AND ${isDeletedCondition}
    ORDER BY created_at DESC
    LIMIT 1
  `,
    [offerId, userId]
  )) as any

  if (!task) {
    return null
  }

  return parseClickFarmTask(task)
}
