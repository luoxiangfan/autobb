/**
 * 创意效果评分API
 * GET /api/insights/creative-performance - 获取用户所有创意的评分
 * GET /api/insights/creative-performance?creativeId=123 - 获取单个创意评分
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { scoreCreativePerformance, scoreAllCreatives } from '@/lib/creative-learning'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)
    const creativeId = searchParams.get('creativeId')

    // 单个创意评分
    if (creativeId) {
      const score = scoreCreativePerformance(parseInt(creativeId), userId)

      if (!score) {
        return NextResponse.json(
          { error: '创意不存在或数据不足' },
          { status: 404 }
        )
      }

      return NextResponse.json({
        success: true,
        data: score
      })
    }

    // 批量评分
    const scores = await scoreAllCreatives(userId)

    return NextResponse.json({
      success: true,
      data: {
        total: scores.length,
        excellent: scores.filter((s: any) => s.rating === 'excellent').length,
        good: scores.filter((s: any) => s.rating === 'good').length,
        average: scores.filter((s: any) => s.rating === 'average').length,
        poor: scores.filter((s: any) => s.rating === 'poor').length,
        scores
      }
    })
  } catch (error: any) {
    console.error('创意评分失败:', error)
    return NextResponse.json(
      { error: error.message || '创意评分失败' },
      { status: 500 }
    )
  }
}
