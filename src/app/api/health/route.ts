import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/health
 * Docker健康检查端点
 */
export async function GET() {
  try {
    // 检查数据库连接
    const db = await getDatabase()
    const result = await db.queryOne('SELECT 1 as health', []) as { health: number }

    if (result.health !== 1) {
      throw new Error('数据库健康检查失败')
    }

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'ok',
        server: 'ok',
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
      },
      { status: 503 }
    )
  }
}
