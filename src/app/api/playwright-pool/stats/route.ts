import { NextResponse } from 'next/server'
import { getPlaywrightPoolStats } from '@/lib/playwright-pool'

/**
 * GET /api/playwright-pool/stats
 * 获取Playwright连接池统计信息
 */
export async function GET() {
  try {
    const stats = getPlaywrightPoolStats()

    return NextResponse.json({
      success: true,
      data: stats,
    })
  } catch (error: any) {
    console.error('获取连接池统计失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取统计信息失败',
      },
      { status: 500 }
    )
  }
}
