/**
 * GET /api/optimization-tasks - 获取优化任务列表
 * POST /api/optimization-tasks/generate - 手动生成优化任务
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import {
  getUserOptimizationTasks,
  generateOptimizationTasksForUser,
  getTaskStatistics
} from '@/lib/optimization-tasks'

/**
 * GET - 获取优化任务列表
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') as any

    // 验证status参数
    if (status && !['pending', 'in_progress', 'completed', 'dismissed'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status parameter' },
        { status: 400 }
      )
    }

    // 获取任务列表
    const tasks = await getUserOptimizationTasks(auth.user!.userId, status)

    // 获取统计信息
    const statistics = await getTaskStatistics(auth.user!.userId)

    return NextResponse.json({
      tasks,
      statistics
    })

  } catch (error) {
    console.error('Get optimization tasks error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST - 手动生成优化任务
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 生成任务
    const taskCount = await generateOptimizationTasksForUser(auth.user!.userId)

    // 获取更新后的统计
    const statistics = await getTaskStatistics(auth.user!.userId)

    return NextResponse.json({
      success: true,
      generatedTasks: taskCount,
      statistics
    })

  } catch (error) {
    console.error('Generate optimization tasks error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
