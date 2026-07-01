import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { createGoogleAdsLogger } from '@/lib/google-ads/common/logger'

const accountsLog = createGoogleAdsLogger('accounts')
import { getIdleAdsAccounts } from '@/lib/offers/server'
import { isTruthyFlag } from '@/lib/campaign/publish/publish-route-helpers'

/**
 * GET /api/google-ads/idle-accounts
 * P1-12: 获取闲置的Google Ads账号列表
 * 便于用户识别未被任何Offer使用的账号
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async (_request, user) => {
  const userId = user.userId

  try {
    const idleAccounts = await getIdleAdsAccounts(userId)

    return NextResponse.json({
      success: true,
      accounts: idleAccounts.map((account: any) => ({
        id: account.id,
        customerId: account.customer_id,
        accountName: account.account_name,
        isActive: isTruthyFlag(account.is_active),
        isIdle: true, // 由getIdleAdsAccounts查询逻辑保证返回的都是闲置账号
        createdAt: account.created_at,
        updatedAt: account.updated_at,
      })),
      total: idleAccounts.length,
    })
  } catch (error: any) {
    accountsLog.error('get_idle_accounts_failed', { userId }, error)

    return NextResponse.json(
      {
        error: error.message || '获取闲置Ads账号失败',
      },
      { status: 500 }
    )
  }
})
