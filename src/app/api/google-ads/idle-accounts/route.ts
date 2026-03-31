import { NextRequest, NextResponse } from 'next/server'
import { getIdleAdsAccounts } from '@/lib/offers'

/**
 * GET /api/google-ads/idle-accounts
 * P1-12: 获取闲置的Google Ads账号列表
 * 便于用户识别未被任何Offer使用的账号
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const idleAccounts = await getIdleAdsAccounts(parseInt(userId, 10))

    return NextResponse.json({
      success: true,
      accounts: idleAccounts.map((account: any) => ({
        id: account.id,
        customerId: account.customer_id,
        accountName: account.account_name,
        isActive: account.is_active === 1 || account.is_active === true,
        isIdle: true, // 由getIdleAdsAccounts查询逻辑保证返回的都是闲置账号
        createdAt: account.created_at,
        updatedAt: account.updated_at,
      })),
      total: idleAccounts.length,
    })
  } catch (error: any) {
    console.error('获取闲置Ads账号失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取闲置Ads账号失败',
      },
      { status: 500 }
    )
  }
}
