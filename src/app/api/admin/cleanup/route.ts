import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, type AuthResult } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * POST /api/admin/cleanup
 *
 * 执行数据清理 - 清理90天前的软删除记录
 *
 * 请求体参数：
 * - tables: 要清理的表数组，默认 ['scraped_products', 'ad_creatives', 'google_ads_accounts']
 * - dryRun: 干运行模式，只返回统计信息不实际删除
 */
export async function POST(request: NextRequest) {
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

    // 解析请求参数
    const body = await request.json().catch(() => ({}))
    const { tables = ['scraped_products', 'ad_creatives', 'google_ads_accounts'], dryRun = false } = body

    // 验证tables参数
    const validTables = ['scraped_products', 'ad_creatives', 'google_ads_accounts']
    const tablesToClean = tables.filter((t: string) => validTables.includes(t))

    if (tablesToClean.length === 0) {
      return NextResponse.json(
        { error: '没有有效的表需要清理' },
        { status: 400 }
      )
    }

    // 🔧 兼容 SQLite 和 PostgreSQL
    const deletedCheck = db.type === 'sqlite' ? 'is_deleted = 1' : 'is_deleted = TRUE'
    const dateCheck = db.type === 'sqlite'
      ? `deleted_at < datetime('now', '-${retentionDays} days')`
      : `deleted_at < NOW() - INTERVAL '${retentionDays} days'`

    const results: Record<string, { count: number; success: boolean; error?: string }> = {}
    let totalDeleted = 0

    // 预览模式
    if (dryRun) {
      for (const table of tablesToClean) {
        const result = await db.queryOne(`
          SELECT COUNT(*) as count
          FROM ${table}
          WHERE ${deletedCheck}
            AND deleted_at IS NOT NULL
            AND ${dateCheck}
        `) as { count: number }
        results[table] = { count: Number(result.count) || 0, success: true }
        totalDeleted += Number(result.count) || 0
      }

      return NextResponse.json({
        mode: 'dry_run',
        retentionDays,
        message: '干运行模式 - 未实际删除任何数据',
        summary: {
          tables: tablesToClean,
          totalRecordsToDelete: totalDeleted,
          results,
        },
      })
    }

    // 实际清理模式
    for (const table of tablesToClean) {
      try {
        const result = await db.exec(`
          DELETE FROM ${table}
          WHERE ${deletedCheck}
            AND deleted_at IS NOT NULL
            AND ${dateCheck}
        `)
        const deletedCount = result.changes || 0
        results[table] = { count: deletedCount, success: true }
        totalDeleted += deletedCount
      } catch (error) {
        results[table] = {
          count: 0,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    return NextResponse.json({
      mode: 'execution',
      retentionDays,
      message: totalDeleted > 0
        ? `已清理 ${totalDeleted} 条软删除记录`
        : '没有需要清理的记录',
      summary: {
        tables: tablesToClean,
        totalRecordsDeleted: totalDeleted,
        results,
      },
    })
  } catch (error) {
    console.error('数据清理失败:', error)
    return NextResponse.json(
      { error: '清理失败', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/cleanup
 *
 * 获取清理统计信息（备用端点）
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
    const isPostgres = db.type === 'postgres'
    const deletedFlag = isPostgres ? 'TRUE' : '1'
    const retentionDays = 90

    // 统计所有软删除记录
    const scrapedProducts = await db.queryOne(`
      SELECT COUNT(*) as count FROM scraped_products WHERE is_deleted = ${deletedFlag}
    `) as { count: number }

    const adCreatives = await db.queryOne(`
      SELECT COUNT(*) as count FROM ad_creatives WHERE is_deleted = ${deletedFlag}
    `) as { count: number }

    const googleAdsAccounts = await db.queryOne(`
      SELECT COUNT(*) as count FROM google_ads_accounts WHERE is_deleted = ${deletedFlag}
    `) as { count: number }

    const campaigns = await db.queryOne(`
      SELECT COUNT(*) as count FROM campaigns WHERE is_deleted = ${deletedFlag}
    `) as { count: number }

    const offers = await db.queryOne(`
      SELECT COUNT(*) as count FROM offers WHERE is_deleted = ${deletedFlag}
    `) as { count: number }

    return NextResponse.json({
      retentionDays,
      softDeletedRecords: {
        scraped_products: Number(scrapedProducts.count) || 0,
        ad_creatives: Number(adCreatives.count) || 0,
        google_ads_accounts: Number(googleAdsAccounts.count) || 0,
        campaigns: Number(campaigns.count) || 0,
        offers: Number(offers.count) || 0,
        total: (
          (Number(scrapedProducts.count) || 0) +
          (Number(adCreatives.count) || 0) +
          (Number(googleAdsAccounts.count) || 0) +
          (Number(campaigns.count) || 0) +
          (Number(offers.count) || 0)
        ),
      },
      cleanableAfterDays: retentionDays,
      note: `超过 ${retentionDays} 天的软删除记录可以被安全清理`,
    })
  } catch (error) {
    console.error('获取清理统计失败:', error)
    return NextResponse.json(
      { error: '获取统计失败', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
