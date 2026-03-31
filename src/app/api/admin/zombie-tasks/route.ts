import { NextRequest, NextResponse } from 'next/server'
import { detectAndFixZombieSyncTasks, getZombieTaskStats } from '@/lib/queue/affiliate-sync-zombie-detector'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/zombie-tasks
 * 检测僵尸同步任务
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')
    const userRole = request.headers.get('x-user-role')

    // 仅管理员可访问
    if (userRole !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const stats = await getZombieTaskStats()

    return NextResponse.json({
      success: true,
      stats,
    })
  } catch (error: any) {
    console.error('[GET /api/admin/zombie-tasks] failed:', error)
    return NextResponse.json(
      { error: error?.message || '获取僵尸任务统计失败' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/zombie-tasks
 * 检测并修复僵尸同步任务
 */
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')
    const userRole = request.headers.get('x-user-role')

    // 仅管理员可访问
    if (userRole !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const autoFix = body.autoFix === true
    const dryRun = body.dryRun === true

    const result = await detectAndFixZombieSyncTasks({ autoFix, dryRun })

    return NextResponse.json({
      success: true,
      result,
      message: autoFix
        ? `已修复 ${result.fixedCount} 个僵尸任务`
        : `发现 ${result.zombieTasks.length} 个僵尸任务（未修复）`,
    })
  } catch (error: any) {
    console.error('[POST /api/admin/zombie-tasks] failed:', error)
    return NextResponse.json(
      { error: error?.message || '检测僵尸任务失败' },
      { status: 500 }
    )
  }
}
