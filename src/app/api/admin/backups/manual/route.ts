import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { backupDatabase } from '@/lib/common'

/**
 * POST /api/admin/backups/manual
 * 手动触发数据库备份(仅管理员)
 */
export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户信息
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    if (authResult.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    // 执行手动备份
    console.log('管理员触发手动备份，用户ID:', userId)
    const result = await backupDatabase('manual', userId)

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.errorMessage || '备份任务已记录',
      })
    } else {
      return NextResponse.json({ error: result.errorMessage || '备份失败' }, { status: 500 })
    }
  } catch (error: any) {
    console.error('手动备份失败:', error)
    return NextResponse.json({ error: error.message || '备份失败' }, { status: 500 })
  }
}
