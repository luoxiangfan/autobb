// GET /api/url-swap/stats - 获取当前用户的换链统计

import { NextRequest, NextResponse } from 'next/server'
import { getUrlSwapUserStats } from '@/lib/url-swap'

export const dynamic = 'force-dynamic'

/**
 * GET - 获取当前用户的换链统计
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized', message: '未登录' }, { status: 401 })
    }

    const stats = await getUrlSwapUserStats(parseInt(userId, 10))

    // 兼容前端：既返回 data 包装，也保留扁平字段
    return NextResponse.json({ ...stats, success: true, data: stats })
  } catch (error: any) {
    console.error('[url-swap] 获取统计失败:', error)
    return NextResponse.json(
      { error: 'internal_error', message: '获取统计失败: ' + (error?.message || String(error)) },
      { status: 500 }
    )
  }
}
