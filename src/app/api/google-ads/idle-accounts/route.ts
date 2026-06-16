import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { logGoogleAdsAccountsError } from '@/lib/google-ads/auth/route-logger'
import { getIdleAdsAccounts } from '@/lib/offers/server'

/**
 * GET /api/google-ads/idle-accounts
 * P1-12: 获取闲置的Google Ads账号列表
 * 便于用户识别未被任何Offer使用的账号
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  let userId: number | undefined
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    userId = authResult.user.userId

    const idleAccounts = await getIdleAdsAccounts(userId)

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
    logGoogleAdsAccountsError(
      'get_idle_accounts_failed',
      error,
      userId != null ? { userId } : undefined
    )

    return NextResponse.json(
      {
        error: error.message || '获取闲置Ads账号失败',
      },
      { status: 500 }
    )
  }
}
