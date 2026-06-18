import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/admin/backups
 * 获取备份历史列表(仅管理员)
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async (request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url)
      const limit = parseInt(searchParams.get('limit') || '30')

      const db = getDatabase()

      const backups = await db.query(
        `
      SELECT * FROM backup_logs
      ORDER BY created_at DESC
      LIMIT ?
    `,
        [limit]
      )

      const stats = (await db.queryOne(`
      SELECT
        COUNT(*) as total_backups,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_backups,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_backups,
        SUM(CASE WHEN status = 'success' THEN file_size_bytes ELSE 0 END) as total_size_bytes
      FROM backup_logs
    `)) as any

      return NextResponse.json({
        success: true,
        data: {
          backups,
          stats: {
            totalBackups: stats.total_backups,
            successfulBackups: stats.successful_backups,
            failedBackups: stats.failed_backups,
            totalSizeBytes: stats.total_size_bytes,
          },
        },
      })
    } catch (error) {
      console.error('获取备份历史失败:', error)
      return NextResponse.json({ error: '获取备份历史失败' }, { status: 500 })
    }
  },
  { requireAdmin: true }
)
