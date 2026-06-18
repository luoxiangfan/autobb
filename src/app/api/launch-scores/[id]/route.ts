import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import {
  findLaunchScoreById,
  deleteLaunchScore,
  parseLaunchScoreAnalysis,
} from '@/lib/launch-score/server'
import { parsePositiveIntegerId } from '@/lib/offers/server'

/**
 * GET /api/launch-scores/:id
 * 获取Launch Score详情
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request, user, context) => {
  try {
    const scoreId = parsePositiveIntegerId(context?.params?.id)
    if (!scoreId) {
      return NextResponse.json({ error: 'Launch Score ID无效' }, { status: 400 })
    }

    const userId = user.userId

    const launchScore = await findLaunchScoreById(scoreId, userId)

    if (!launchScore) {
      return NextResponse.json(
        {
          error: 'Launch Score不存在或无权访问',
        },
        { status: 404 }
      )
    }

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
})

/**
 * DELETE /api/launch-scores/:id
 * 删除Launch Score
 */
export const DELETE = withAuth(async (request, user, context) => {
  try {
    const scoreId = parsePositiveIntegerId(context?.params?.id)
    if (!scoreId) {
      return NextResponse.json({ error: 'Launch Score ID无效' }, { status: 400 })
    }

    const userId = user.userId

    const success = await deleteLaunchScore(scoreId, userId)

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
})
