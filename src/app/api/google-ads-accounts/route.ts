import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import {
  createGoogleAdsAccount,
  findGoogleAdsAccountsByUserId,
  findActiveGoogleAdsAccounts,
  findGoogleAdsAccountsByUserMcc,
} from '@/lib/google-ads-accounts'

/**
 * GET /api/google-ads-accounts
 * 获取用户的 Google Ads 账号列表
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId  // Already a string
    const userRole = authResult.user.role

    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('activeOnly') === 'true'
    const manager = searchParams.get('manager') === 'true'
    const filterByUserMcc = searchParams.get('filterByUserMcc') === 'true'

    let accounts
    if (filterByUserMcc && userRole !== 'admin') {
      // 🔧 普通用户：只返回用户 MCC 下的 Google Ads 账号（非 MCC 账号）
      // 🔧 管理员：跳过过滤，显示所有账号
      accounts = await findGoogleAdsAccountsByUserMcc(userId, manager)
    } else if (activeOnly) {
      accounts = await findActiveGoogleAdsAccounts(userId, manager)
    } else {
      accounts = await findGoogleAdsAccountsByUserId(userId)
    }

    return NextResponse.json({
      success: true,
      accounts,
      count: accounts.length,
    })
  } catch (error: any) {
    console.error('获取 Google Ads 账号列表失败:', error)

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
 * 创建 Google Ads 账号绑定
 */
export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户 ID
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
          error: 'Customer ID 不能为空',
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
    console.error('创建 Google Ads 账号失败:', error)

    // 检查是否是重复账号错误
    if (error.message && error.message.includes('UNIQUE constraint failed')) {
      return NextResponse.json(
        {
          error: '该 Google Ads 账号已经绑定',
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
