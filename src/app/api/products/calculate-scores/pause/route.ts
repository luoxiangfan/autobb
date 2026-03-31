import { NextRequest, NextResponse } from 'next/server'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'
import {
  isProductScoreCalculationPaused,
  setProductScoreCalculationPaused,
} from '@/lib/product-score-control'

function parseUserId(request: NextRequest): number | null {
  const userIdRaw = request.headers.get('x-user-id')
  if (!userIdRaw) return null

  const userId = Number(userIdRaw)
  if (!Number.isFinite(userId) || userId <= 0) return null

  return userId
}

export async function GET(request: NextRequest) {
  try {
    const userId = parseUserId(request)
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

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
}

export async function POST(request: NextRequest) {
  try {
    const userId = parseUserId(request)
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

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
}
