/**
 * 优化任务管理系统
 *
 * 功能：
 * - 生成每周优化任务清单
 * - 管理任务状态
 * - 追踪任务完成情况
 */

import { getDatabase } from '@/lib/db'
import { dateMinusDays } from '@/lib/db-helpers'
import { createOptimizationEngine, type CampaignMetrics, type OptimizationRecommendation } from './optimization-rules'
import { getCommissionPerConversion as getOfferCommissionPerConversion } from './offer-monetization'
import { buildUserExecutionEligibleSql, getUserExecutionEligibility } from './user-execution-eligibility'

export interface OptimizationTask {
  id: number
  userId: number
  campaignId: number
  taskType: string
  priority: 'high' | 'medium' | 'low'
  reason: string
  action: string
  expectedImpact: string
  metricsSnapshot: string
  status: 'pending' | 'in_progress' | 'completed' | 'dismissed'
  createdAt: string
  completedAt: string | null
  dismissedAt: string | null
  completionNote: string | null
}

export interface OptimizationTaskWithCampaign extends OptimizationTask {
  campaignName: string
  campaignStatus: string
}

/**
 * 为单个用户生成优化任务
 */
export async function generateOptimizationTasksForUser(userId: number): Promise<number> {
  const eligibility = await getUserExecutionEligibility(userId)
  if (!eligibility.eligible) {
    return 0
  }

  const db = await getDatabase()
  const recentCutoffExpr = dateMinusDays(7, db.type)
  const engine = createOptimizationEngine()

  // 获取用户的所有活跃Campaigns（JOIN offers获取转化价值）
  const campaigns = await db.query(
    `
    SELECT
      c.id as campaignId,
      c.campaign_name as campaignName,
      c.status,
      c.created_at,
      o.target_country,
      o.product_price,
      o.commission_payout
    FROM campaigns c
    LEFT JOIN offers o ON c.offer_id = o.id
    WHERE c.user_id = ?
      AND c.status IN ('ENABLED', 'PAUSED')
  `,
    [userId]
  ) as any[]

  if (campaigns.length === 0) {
    return 0
  }

  // 计算过去7天的性能数据
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const startDate = sevenDaysAgo.toISOString().split('T')[0]
  const endDate = new Date().toISOString().split('T')[0]

  const campaignMetrics: CampaignMetrics[] = []

  for (const campaign of campaigns) {
    // 聚合性能数据
    const perf = await db.queryOne(
      `
      SELECT
        COALESCE(SUM(impressions), 0) as impressions,
        COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(cost), 0) as cost,
        COALESCE(SUM(conversions), 0) as conversions
      FROM campaign_performance
      WHERE campaign_id = ?
        AND user_id = ?
        AND date >= ?
        AND date <= ?
    `,
      [campaign.campaignId, userId, startDate, endDate]
    ) as any

    // 计算衍生指标
    const impressions = perf.impressions || 0
    const clicks = perf.clicks || 0
    const cost = perf.cost || 0
    const conversions = perf.conversions || 0

    const ctr = impressions > 0 ? clicks / impressions : 0
    const cpc = clicks > 0 ? cost / clicks : 0
    const cpa = conversions > 0 ? cost / conversions : 0
    const conversionRate = clicks > 0 ? conversions / clicks : 0

    // 计算真实转化价值（基于产品价格和佣金比例）
    let conversionValue = 50 // 默认值$50（降级方案）
    if (campaign.product_price && campaign.commission_payout) {
      try {
        const parsed = getOfferCommissionPerConversion({
          productPrice: campaign.product_price,
          commissionPayout: campaign.commission_payout,
          targetCountry: campaign.target_country,
        })
        if (parsed && parsed.amount > 0) {
          conversionValue = parsed.amount
        }
      } catch (error) {
        console.warn(`计算转化价值失败，使用默认值$50: ${error}`)
      }
    }

    const roi = cost > 0 ? (conversions * conversionValue - cost) / cost : 0

    // 计算运行天数
    const createdDate = new Date(campaign.created_at)
    const daysRunning = Math.floor(
      (new Date().getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    campaignMetrics.push({
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      status: campaign.status,
      impressions,
      clicks,
      cost,
      conversions,
      ctr,
      cpc,
      cpa,
      conversionRate,
      roi,
      daysRunning
    })
  }

  // 使用规则引擎生成建议
  const recommendations = engine.generateBatchRecommendations(campaignMetrics)

  // 过滤掉已存在的pending任务（避免重复）
  const existingTasks = await db.query(
    `
    SELECT campaign_id, task_type
    FROM optimization_tasks
    WHERE user_id = ?
      AND status = 'pending'
      AND created_at >= ${recentCutoffExpr}
  `,
    [userId]
  ) as any[]

  const existingTaskKeys = new Set(
    existingTasks.map(t => `${t.campaign_id}_${t.task_type}`)
  )

  // 插入新任务
  let insertedCount = 0

  for (const rec of recommendations) {
    const taskKey = `${rec.campaignId}_${rec.type}`

    // 跳过已存在的任务
    if (existingTaskKeys.has(taskKey)) {
      continue
    }

    // 找到对应的Campaign指标
    const metrics = campaignMetrics.find(m => m.campaignId === rec.campaignId)
    if (!metrics) continue

    // 保存指标快照
    const metricsSnapshot = JSON.stringify({
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      cost: metrics.cost,
      conversions: metrics.conversions,
      ctr: metrics.ctr,
      cpc: metrics.cpc,
      conversionRate: metrics.conversionRate,
      roi: metrics.roi,
      daysRunning: metrics.daysRunning,
      snapshotDate: endDate
    })

    await db.exec(
      `
      INSERT INTO optimization_tasks (
        user_id,
        campaign_id,
        task_type,
        priority,
        reason,
        action,
        expected_impact,
        metrics_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        userId,
        rec.campaignId,
        rec.type,
        rec.priority,
        rec.reason,
        rec.action,
        rec.expectedImpact,
        metricsSnapshot,
      ]
    )

    insertedCount++
  }

  return insertedCount
}

/**
 * 为所有用户生成优化任务（每周定时任务）
 */
export async function generateWeeklyOptimizationTasks(): Promise<{
  totalUsers: number
  totalTasks: number
  userTasks: Record<number, number>
}> {
  const db = await getDatabase()
  const userEligibleCondition = buildUserExecutionEligibleSql({ dbType: db.type, userAlias: 'u' })

  // 获取所有有活跃Campaign的用户
  const users = await db.query(
    `
    SELECT DISTINCT c.user_id
    FROM campaigns c
    INNER JOIN users u ON u.id = c.user_id
    WHERE c.status IN ('ENABLED', 'PAUSED')
      AND ${userEligibleCondition}
  `,
    []
  ) as { user_id: number }[]

  const userTasks: Record<number, number> = {}
  let totalTasks = 0

  for (const user of users) {
    const taskCount = await generateOptimizationTasksForUser(user.user_id)
    userTasks[user.user_id] = taskCount
    totalTasks += taskCount
  }

  return {
    totalUsers: users.length,
    totalTasks,
    userTasks
  }
}

/**
 * 获取用户的优化任务列表
 */
export async function getUserOptimizationTasks(
  userId: number,
  status?: 'pending' | 'in_progress' | 'completed' | 'dismissed'
): Promise<OptimizationTaskWithCampaign[]> {
  const db = await getDatabase()

  let query = `
    SELECT
      t.*,
      c.campaign_name as campaignName,
      c.status as campaignStatus
    FROM optimization_tasks t
    JOIN campaigns c ON t.campaign_id = c.id
    WHERE t.user_id = ?
  `

  const params: any[] = [userId]

  if (status) {
    query += ` AND t.status = ?`
    params.push(status)
  }

  query += ` ORDER BY
    CASE t.priority
      WHEN 'high' THEN 0
      WHEN 'medium' THEN 1
      WHEN 'low' THEN 2
    END,
    t.created_at DESC
  `

  const tasks = await db.query(query, params) as any[]

  return tasks.map(t => ({
    id: t.id,
    userId: t.user_id,
    campaignId: t.campaign_id,
    taskType: t.task_type,
    priority: t.priority,
    reason: t.reason,
    action: t.action,
    expectedImpact: t.expected_impact,
    metricsSnapshot: t.metrics_snapshot,
    status: t.status,
    createdAt: t.created_at,
    completedAt: t.completed_at,
    dismissedAt: t.dismissed_at,
    completionNote: t.completion_note,
    campaignName: t.campaignName,
    campaignStatus: t.campaignStatus
  }))
}

/**
 * 更新任务状态
 */
export async function updateTaskStatus(
  taskId: number,
  userId: number,
  status: 'in_progress' | 'completed' | 'dismissed',
  note?: string
): Promise<boolean> {
  const db = await getDatabase()

  let query = `
    UPDATE optimization_tasks
    SET status = ?,
        ${status === 'completed' ? "completed_at = datetime('now')," : ''}
        ${status === 'dismissed' ? "dismissed_at = datetime('now')," : ''}
        completion_note = ?
    WHERE id = ? AND user_id = ?
  `

  const params: any[] = [status]
  if (note) params.push(note)
  else params.push(null)
  params.push(taskId, userId)

  const result = await db.exec(query, params)

  return result.changes > 0
}

/**
 * 批量更新任务状态（按Campaign）
 */
export async function updateCampaignTasks(
  campaignId: number,
  userId: number,
  status: 'completed' | 'dismissed',
  note?: string
): Promise<number> {
  const db = await getDatabase()

  const query = `
    UPDATE optimization_tasks
    SET status = ?,
        ${status === 'completed' ? 'completed_at = datetime("now"),' : ''}
        ${status === 'dismissed' ? 'dismissed_at = datetime("now"),' : ''}
        completion_note = ?
    WHERE campaign_id = ?
      AND user_id = ?
      AND status = 'pending'
  `

  const result = await db.exec(query, [status, note || null, campaignId, userId])

  return result.changes
}

/**
 * 获取任务统计
 */
export async function getTaskStatistics(userId: number): Promise<{
  total: number
  pending: number
  inProgress: number
  completed: number
  dismissed: number
  byPriority: {
    high: number
    medium: number
    low: number
  }
}> {
  const db = await getDatabase()
  const recentCutoffExpr = dateMinusDays(30, db.type)

  const stats = await db.queryOne(
    `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgress,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed,
      SUM(CASE WHEN priority = 'high' AND status = 'pending' THEN 1 ELSE 0 END) as highPriority,
      SUM(CASE WHEN priority = 'medium' AND status = 'pending' THEN 1 ELSE 0 END) as mediumPriority,
      SUM(CASE WHEN priority = 'low' AND status = 'pending' THEN 1 ELSE 0 END) as lowPriority
    FROM optimization_tasks
    WHERE user_id = ?
      AND created_at >= ${recentCutoffExpr}
  `,
    [userId]
  ) as any

  return {
    total: stats.total || 0,
    pending: stats.pending || 0,
    inProgress: stats.inProgress || 0,
    completed: stats.completed || 0,
    dismissed: stats.dismissed || 0,
    byPriority: {
      high: stats.highPriority || 0,
      medium: stats.mediumPriority || 0,
      low: stats.lowPriority || 0
    }
  }
}

/**
 * 清理过期任务（30天前的已完成/已忽略任务）
 */
export async function cleanupOldTasks(): Promise<number> {
  const db = await getDatabase()
  const recentCutoffExpr = dateMinusDays(30, db.type)

  const result = await db.exec(
    `
    DELETE FROM optimization_tasks
    WHERE status IN ('completed', 'dismissed')
      AND (
        completed_at < ${recentCutoffExpr}
        OR dismissed_at < ${recentCutoffExpr}
      )
  `,
    []
  )

  return result.changes
}
