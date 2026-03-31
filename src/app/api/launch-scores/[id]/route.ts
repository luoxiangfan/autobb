import { NextRequest, NextResponse } from 'next/server'
import { findLaunchScoreById, deleteLaunchScore, parseLaunchScoreAnalysis } from '@/lib/launch-scores'

/**
 * GET /api/launch-scores/:id
 * 获取Launch Score详情
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const launchScore = await findLaunchScoreById(parseInt(id, 10), parseInt(userId, 10))

    if (!launchScore) {
      return NextResponse.json(
        {
          error: 'Launch Score不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 解析详细分析数据
    const analysis = parseLaunchScoreAnalysis(launchScore)

    return NextResponse.json({
      success: true,
      launchScore,
      analysis,
    })
  } catch (error: any) {
    console.error('获取Launch Score详情失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Launch Score详情失败',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/launch-scores/:id
 * 删除Launch Score
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const success = deleteLaunchScore(parseInt(id, 10), parseInt(userId, 10))

    if (!success) {
      return NextResponse.json(
        {
          error: 'Launch Score不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Launch Score已删除',
    })
  } catch (error: any) {
    console.error('删除Launch Score失败:', error)

    return NextResponse.json(
      {
        error: error.message || '删除Launch Score失败',
      },
      { status: 500 }
    )
  }
}
