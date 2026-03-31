import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, type AuthResult } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/admin/cleanup/preview
 *
 * 预览数据清理 - 显示可清理的软删除记录数量
 * 不实际删除数据，只返回统计信息
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证管理员权限
    const authResult = await verifyAuth(request) as AuthResult
    if (!authResult.authenticated || authResult.user?.role !== 'admin') {
      return NextResponse.json(
        { error: '需要管理员权限' },
        { status: 403 }
      )
    }

    const db = await getDatabase()
    const retentionDays = 90 // 保留90天内的软删除记录

    // 🔧 兼容 SQLite 和 PostgreSQL
    const deletedCheck = db.type === 'sqlite' ? 'is_deleted = 1' : 'is_deleted = TRUE'
    const dateCheck = db.type === 'sqlite'
      ? `deleted_at < datetime('now', '-${retentionDays} days')`
      : `deleted_at < NOW() - INTERVAL '${retentionDays} days'`

    // 统计各表的可清理记录数
    const scrapedProductsCount = await db.queryOne(`
      SELECT COUNT(*) as count
      FROM scraped_products
      WHERE ${deletedCheck}
        AND deleted_at IS NOT NULL
        AND ${dateCheck}
    `) as { count: number }

    const adCreativesCount = await db.queryOne(`
      SELECT COUNT(*) as count
      FROM ad_creatives
      WHERE ${deletedCheck}
        AND deleted_at IS NOT NULL
        AND ${dateCheck}
    `) as { count: number }

    const googleAdsAccountsCount = await db.queryOne(`
      SELECT COUNT(*) as count
      FROM google_ads_accounts
      WHERE ${deletedCheck}
        AND deleted_at IS NOT NULL
        AND ${dateCheck}
    `) as { count: number }

    // 统计所有软删除记录（包括未到清理期的）
    const totalScrapedProducts = await db.queryOne(`
      SELECT COUNT(*) as count
      FROM scraped_products
      WHERE ${deletedCheck}
    `) as { count: number }

    const totalAdCreatives = await db.queryOne(`
      SELECT COUNT(*) as count
      FROM ad_creatives
      WHERE ${deletedCheck}
    `) as { count: number }

    const totalGoogleAdsAccounts = await db.queryOne(`
      SELECT COUNT(*) as count
      FROM google_ads_accounts
      WHERE ${deletedCheck}
    `) as { count: number }

    return NextResponse.json({
      retentionDays,
      cleanable: {
        scraped_products: Number(scrapedProductsCount.count) || 0,
        ad_creatives: Number(adCreativesCount.count) || 0,
        google_ads_accounts: Number(googleAdsAccountsCount.count) || 0,
        total: (
          (Number(scrapedProductsCount.count) || 0) +
          (Number(adCreativesCount.count) || 0) +
          (Number(googleAdsAccountsCount.count) || 0)
        ),
      },
      current: {
        scraped_products: Number(totalScrapedProducts.count) || 0,
        ad_creatives: Number(totalAdCreatives.count) || 0,
        google_ads_accounts: Number(totalGoogleAdsAccounts.count) || 0,
        total: (
          (Number(totalScrapedProducts.count) || 0) +
          (Number(totalAdCreatives.count) || 0) +
          (Number(totalGoogleAdsAccounts.count) || 0)
        ),
      },
    })
  } catch (error) {
    console.error('清理预览失败:', error)
    return NextResponse.json(
      { error: '预览失败', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
