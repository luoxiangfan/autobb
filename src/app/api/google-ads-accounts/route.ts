import { NextRequest, NextResponse } from 'next/server'
import {
  createGoogleAdsAccount,
  findGoogleAdsAccountsByUserId,
  findActiveGoogleAdsAccounts,
} from '@/lib/google-ads-accounts'

/**
 * GET /api/google-ads-accounts
 * 获取用户的Google Ads账号列表
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
    const activeOnly = searchParams.get('activeOnly') === 'true'

    const accounts = activeOnly
      ? await findActiveGoogleAdsAccounts(parseInt(userId, 10))
      : await findGoogleAdsAccountsByUserId(parseInt(userId, 10))

    return NextResponse.json({
      success: true,
      accounts,
      count: accounts.length,
    })
  } catch (error: any) {
    console.error('获取Google Ads账号列表失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取账号列表失败',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/google-ads-accounts
 * 创建Google Ads账号绑定
 */
export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const {
      customerId,
      accountName,
      currency,
      timezone,
      isManagerAccount,
      accessToken,
      refreshToken,
      tokenExpiresAt,
    } = body

    if (!customerId) {
      return NextResponse.json(
        {
          error: 'Customer ID不能为空',
        },
        { status: 400 }
      )
    }

    // 创建账号
    const account = await createGoogleAdsAccount({
      userId: parseInt(userId, 10),
      customerId,
      accountName,
      currency,
      timezone,
      isManagerAccount,
      accessToken,
      refreshToken,
      tokenExpiresAt,
    })

    return NextResponse.json({
      success: true,
      account,
    })
  } catch (error: any) {
    console.error('创建Google Ads账号失败:', error)

    // 检查是否是重复账号错误
    if (error.message && error.message.includes('UNIQUE constraint failed')) {
      return NextResponse.json(
        {
          error: '该Google Ads账号已经绑定',
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: error.message || '创建账号失败',
      },
      { status: 500 }
    )
  }
}
