import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getIdleAdsAccounts } from '@/lib/offers/server'
import { getDatabase } from '@/lib/db'

// 强制动态渲染（使用了request.headers）
export const dynamic = 'force-dynamic'

/**
 * GET /api/ads-accounts/idle
 * 获取闲置的Ads账号列表
 * 需求25: 无关联关系的Ads账号放入闲置Ads账号列表
 */
export const GET = withAuth(async (_request, user) => {
  try {
    const userId = user.userId

    // 获取闲置账号列表
    const accounts = await getIdleAdsAccounts(userId)

    // 为每个账号添加额外信息（最后使用的Offer、历史统计等）
    const db = await getDatabase()
    const enrichedAccounts = await Promise.all(
      accounts.map(async (account: any) => {
        // 获取该账号最后关联的Offer信息
        const lastOffer = await db.queryOne<any>(
          `
          SELECT DISTINCT o.id, o.offer_name, o.brand, o.target_country
          FROM campaigns c
          JOIN offers o ON c.offer_id = o.id
          WHERE c.google_ads_account_id = ?
            AND c.user_id = ?
          ORDER BY c.updated_at DESC
          LIMIT 1
          `,
          [account.id, userId]
        )

        // 获取该账号的历史Campaign统计
        const stats = await db.queryOne<any>(
          `
          SELECT
            COUNT(DISTINCT c.id) as total_campaigns,
            COUNT(DISTINCT c.offer_id) as total_offers,
            MAX(c.updated_at) as last_used_at
          FROM campaigns c
          WHERE c.google_ads_account_id = ?
            AND c.user_id = ?
          `,
          [account.id, userId]
        )

        return {
          id: account.id,
          customerId: account.customer_id,
          accountName: account.account_name,
          currency: account.currency,
          timezone: account.timezone,
          isActive: account.is_active === true,
          lastSyncAt: account.last_sync_at,
          lastOffer: lastOffer || null,
          statistics: {
            totalCampaigns: stats?.total_campaigns || 0,
            totalOffers: stats?.total_offers || 0,
            lastUsedAt: stats?.last_used_at || null,
          },
          createdAt: account.created_at,
          updatedAt: account.updated_at,
        }
      })
    )

    return NextResponse.json({
      success: true,
      data: {
        accounts: enrichedAccounts,
        total: enrichedAccounts.length,
      },
    })
  } catch (error: any) {
    console.error('获取闲置账号列表失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取闲置账号列表失败',
      },
      { status: 500 }
    )
  }
})
