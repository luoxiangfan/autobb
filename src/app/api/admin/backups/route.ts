import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/admin/backups
 * 获取备份历史列表(仅管理员)
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户信息
    const userId = request.headers.get('x-user-id')
    const userRole = request.headers.get('x-user-role')

    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    if (userRole !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '30')

    const db = getDatabase()

    // 查询备份历史
    const backups = await db.query(`
      SELECT * FROM backup_logs
      ORDER BY created_at DESC
      LIMIT ?
    `, [limit])

    // 统计信息
    const stats = await db.queryOne(`
      SELECT
        COUNT(*) as total_backups,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_backups,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_backups,
        SUM(CASE WHEN status = 'success' THEN file_size_bytes ELSE 0 END) as total_size_bytes
      FROM backup_logs
    `) as any

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
    return NextResponse.json(
      { error: '获取备份历史失败' },
      { status: 500 }
    )
  }
}
