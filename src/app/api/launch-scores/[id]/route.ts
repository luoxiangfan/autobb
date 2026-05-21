import { verifyAuth } from '@/lib/auth'
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

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const launchScore = await findLaunchScoreById(parseInt(id, 10), userId)

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

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const success = deleteLaunchScore(parseInt(id, 10), userId)

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
