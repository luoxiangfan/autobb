/**
 * GET /api/optimization-tasks - 获取优化任务列表
 * POST /api/optimization-tasks/generate - 手动生成优化任务
 */

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import {
  getUserOptimizationTasks,
  generateOptimizationTasksForUser,
  getTaskStatistics,
} from '@/lib/campaign/optimization'

export const dynamic = 'force-dynamic'

/**
 * GET - 获取优化任务列表
 */
export const GET = withAuth(async (request, user) => {
  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') as any

    if (status && !['pending', 'in_progress', 'completed', 'dismissed'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status parameter' }, { status: 400 })
    }

    const tasks = await getUserOptimizationTasks(user.userId, status)
    const statistics = await getTaskStatistics(user.userId)

    return NextResponse.json({
      tasks,
      statistics,
    })
  } catch (error) {
    console.error('Get optimization tasks error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

/**
 * POST - 手动生成优化任务
 */
export const POST = withAuth(async (request, user) => {
  try {
    const taskCount = await generateOptimizationTasksForUser(user.userId)
    const statistics = await getTaskStatistics(user.userId)

    return NextResponse.json({
      success: true,
      generatedTasks: taskCount,
      statistics,
    })
  } catch (error) {
    console.error('Generate optimization tasks error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
