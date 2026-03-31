import { NextRequest, NextResponse } from 'next/server'
import { getOAuthUrl } from '@/lib/google-ads-api'

/**
 * GET /api/auth/google-ads/authorize?customerId=xxx
 * 启动Google Ads OAuth流程
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const customerId = searchParams.get('customerId')

    // 构建state参数（包含用户信息和customer_id）
    const stateData = {
      userId: parseInt(userId, 10),
      customerId: customerId || null,
      timestamp: Date.now(),
    }

    const state = Buffer.from(JSON.stringify(stateData)).toString('base64')

    // 获取OAuth URL
    const authUrl = getOAuthUrl(state)

    // 重定向到Google OAuth页面
    return NextResponse.redirect(authUrl)
  } catch (error: any) {
    console.error('Google Ads OAuth authorize error:', error)

    return NextResponse.json(
      {
        error: error.message || '启动OAuth流程失败',
      },
      { status: 500 }
    )
  }
}
