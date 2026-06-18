import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/gateway/request-auth'
import {
  isProductScoreCalculationPaused,
  setProductScoreCalculationPaused,
} from '@/lib/launch-score/server'

export const GET = withAuth(async (_request, user) => {
  try {
    const userId = user.userId

    const productManagementEnabled = await isProductManagementEnabledForUser(userId)
    if (!productManagementEnabled) {
      return NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 })
    }

    const paused = await isProductScoreCalculationPaused(userId)
    return NextResponse.json({
      success: true,
      paused,
    })
  } catch (error: any) {
    console.error('获取推荐指数暂停状态失败:', error)
    return NextResponse.json(
      {
        error: '获取推荐指数暂停状态失败',
        details: error.message,
      },
      { status: 500 }
    )
  }
})

export const POST = withAuth(async (request, user) => {
  try {
    const userId = user.userId

    const productManagementEnabled = await isProductManagementEnabledForUser(userId)
    if (!productManagementEnabled) {
      return NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const paused = body?.paused
    if (typeof paused !== 'boolean') {
      return NextResponse.json(
        {
          error: '参数错误: paused 必须是布尔值',
        },
        { status: 400 }
      )
    }

    await setProductScoreCalculationPaused(userId, paused)
    return NextResponse.json({
      success: true,
      paused,
    })
  } catch (error: any) {
    console.error('更新推荐指数暂停状态失败:', error)
    return NextResponse.json(
      {
        error: '更新推荐指数暂停状态失败',
        details: error.message,
      },
      { status: 500 }
    )
  }
})
