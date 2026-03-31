import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { compareAdCreatives } from '@/lib/ad-creative'

/**
 * POST /api/ad-creatives/compare
 * 对比多个广告创意
 */
export async function POST(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    // 解析请求参数
    const body = await request.json()
    const { creative_ids } = body

    if (!Array.isArray(creative_ids) || creative_ids.length < 2) {
      return NextResponse.json(
        { error: '至少需要2个广告创意进行对比' },
        { status: 400 }
      )
    }

    if (creative_ids.length > 3) {
      return NextResponse.json(
        { error: '最多对比3个广告创意' },
        { status: 400 }
      )
    }

    // 对比广告创意
    const result = await compareAdCreatives(creative_ids, authResult.user.userId)

    console.log(`📊 对比广告创意: ${creative_ids.join(', ')}`)
    console.log(`   推荐: #${result.comparison.best_overall}`)

    return NextResponse.json({
      success: true,
      data: result
    })

  } catch (error: any) {
    console.error('对比广告创意失败:', error)

    return NextResponse.json(
      {
        error: '对比广告创意失败',
        message: error.message || '未知错误'
      },
      { status: 500 }
    )
  }
}
