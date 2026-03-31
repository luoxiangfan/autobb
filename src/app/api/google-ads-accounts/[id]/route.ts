import { NextRequest, NextResponse } from 'next/server'
import {
  findGoogleAdsAccountById,
  updateGoogleAdsAccount,
  deleteGoogleAdsAccount,
} from '@/lib/google-ads-accounts'

/**
 * GET /api/google-ads-accounts/:id
 * 获取单个Google Ads账号详情
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

    const account = await findGoogleAdsAccountById(parseInt(id, 10), parseInt(userId, 10))

    if (!account) {
      return NextResponse.json(
        {
          error: '账号不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      account,
    })
  } catch (error: any) {
    console.error('获取Google Ads账号详情失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取账号详情失败',
      },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/google-ads-accounts/:id
 * 更新Google Ads账号
 */
export async function PUT(
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

    const body = await request.json()
    const {
      accountName,
      currency,
      timezone,
      isActive,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      lastSyncAt,
    } = body

    // 验证账号存在且属于当前用户
    const existingAccount = await findGoogleAdsAccountById(parseInt(id, 10), parseInt(userId, 10))

    if (!existingAccount) {
      return NextResponse.json(
        {
          error: '账号不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 准备更新数据
    const updates: any = {}
    if (accountName !== undefined) updates.accountName = accountName
    if (currency !== undefined) updates.currency = currency
    if (timezone !== undefined) updates.timezone = timezone
    if (isActive !== undefined) updates.isActive = isActive
    if (accessToken !== undefined) updates.accessToken = accessToken
    if (refreshToken !== undefined) updates.refreshToken = refreshToken
    if (tokenExpiresAt !== undefined) updates.tokenExpiresAt = tokenExpiresAt
    if (lastSyncAt !== undefined) updates.lastSyncAt = lastSyncAt

    // 更新账号
    const updatedAccount = await updateGoogleAdsAccount(parseInt(id, 10), parseInt(userId, 10), updates)

    return NextResponse.json({
      success: true,
      account: updatedAccount,
    })
  } catch (error: any) {
    console.error('更新Google Ads账号失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新账号失败',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/google-ads-accounts/:id
 * 删除Google Ads账号
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

    // 验证账号存在且属于当前用户
    const existingAccount = await findGoogleAdsAccountById(parseInt(id, 10), parseInt(userId, 10))

    if (!existingAccount) {
      return NextResponse.json(
        {
          error: '账号不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 删除账号
    deleteGoogleAdsAccount(parseInt(id, 10), parseInt(userId, 10))

    return NextResponse.json({
      success: true,
      message: '账号删除成功',
    })
  } catch (error: any) {
    console.error('删除Google Ads账号失败:', error)

    return NextResponse.json(
      {
        error: error.message || '删除账号失败',
      },
      { status: 500 }
    )
  }
}
