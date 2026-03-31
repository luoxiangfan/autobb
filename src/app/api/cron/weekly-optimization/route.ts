/**
 * POST /api/cron/weekly-optimization
 * 每周定时任务：为所有用户生成优化任务
 *
 * 调用方式：
 * 1. 本地测试：直接POST请求
 * 2. 生产环境：配置Vercel Cron或Cloud Scheduler
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateWeeklyOptimizationTasks, cleanupOldTasks } from '@/lib/optimization-tasks'
import { runCreativeOptimizationLoop } from '@/lib/creative-learning'
import { getDatabase } from '@/lib/db'
import { buildUserExecutionEligibleSql } from '@/lib/user-execution-eligibility'

export async function POST(request: NextRequest) {
  try {
    // 验证Cron密钥（生产环境保护）
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    console.log('[Cron] Starting weekly optimization tasks generation...')

    // 生成Campaign层面的优化任务
    const campaignResult = await generateWeeklyOptimizationTasks()

    console.log('[Cron] Generated campaign optimization tasks:', campaignResult)

    // 运行创意优化闭环（P0-1: 迭代优化机制）
    console.log('[Cron] Starting creative optimization loop...')

    const db = await getDatabase()
    const userEligibleCondition = buildUserExecutionEligibleSql({ dbType: db.type, userAlias: 'u' })
    const users = await db.query<{ user_id: number }>(`
      SELECT DISTINCT c.user_id
      FROM campaigns c
      INNER JOIN users u ON u.id = c.user_id
      WHERE c.status IN ('ENABLED', 'PAUSED')
        AND ${userEligibleCondition}
    `)

    const creativeResults: Record<number, {
      totalCreatives: number
      highPerformers: number
      featuresUpdated: boolean
      avgScore: number
    }> = {}

    let totalCreativesScored = 0
    let totalHighPerformers = 0
    let usersWithFeaturesUpdated = 0

    for (const user of users) {
      try {
        const result = await runCreativeOptimizationLoop(user.user_id)
        creativeResults[user.user_id] = result

        totalCreativesScored += result.totalCreatives
        totalHighPerformers += result.highPerformers
        if (result.featuresUpdated) {
          usersWithFeaturesUpdated++
        }

        console.log(`[Cron] User ${user.user_id} creative optimization:`, result)
      } catch (error) {
        console.error(`[Cron] Creative optimization failed for user ${user.user_id}:`, error)
      }
    }

    console.log('[Cron] Creative optimization summary:', {
      totalUsers: users.length,
      totalCreativesScored,
      totalHighPerformers,
      usersWithFeaturesUpdated
    })

    // 清理过期任务
    const cleanedCount = await cleanupOldTasks()

    console.log('[Cron] Cleaned up old tasks:', cleanedCount)

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      result: {
        // Campaign优化
        campaign: {
          totalUsers: campaignResult.totalUsers,
          totalTasks: campaignResult.totalTasks,
          userTasks: campaignResult.userTasks
        },
        // 创意优化（新增）
        creative: {
          totalUsers: users.length,
          totalCreativesScored,
          totalHighPerformers,
          usersWithFeaturesUpdated,
          userResults: creativeResults
        },
        // 清理统计
        cleanedTasks: cleanedCount
      }
    })

  } catch (error) {
    console.error('[Cron] Weekly optimization error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}

// 允许GET请求用于健康检查
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    service: 'weekly-optimization-cron',
    status: 'healthy',
    schedule: 'Every Monday 00:00 UTC',
    timestamp: new Date().toISOString()
  })
}
