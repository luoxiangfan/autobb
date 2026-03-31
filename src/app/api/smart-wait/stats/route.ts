import { NextResponse } from 'next/server'
import { getWaitOptimizationStats } from '@/lib/smart-wait-strategy'

/**
 * GET /api/smart-wait/stats
 * 获取智能等待策略优化统计
 */
export async function GET() {
  try {
    const stats = getWaitOptimizationStats()

    return NextResponse.json({
      success: true,
      data: stats,
      message: `智能等待已优化${stats.totalCalls}次调用，平均节省${stats.improvementPercent}%时间`,
    })
  } catch (error: any) {
    console.error('获取智能等待统计失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取统计信息失败',
      },
      { status: 500 }
    )
  }
}
