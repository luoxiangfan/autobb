import { NextRequest, NextResponse } from 'next/server'
import { backupDatabase } from '@/lib/backup'

/**
 * POST /api/admin/backups/manual
 * 手动触发数据库备份(仅管理员)
 */
export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户信息
    const userId = request.headers.get('x-user-id')
    const userRole = request.headers.get('x-user-role')

    if (!userId) {
      return NextResponse.json(
        { error: '未授权' },
        { status: 401 }
      )
    }

    if (userRole !== 'admin') {
      return NextResponse.json(
        { error: '需要管理员权限' },
        { status: 403 }
      )
    }

    // 执行手动备份
    console.log('管理员触发手动备份，用户ID:', userId)
    const result = await backupDatabase('manual', parseInt(userId))

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: '备份成功',
        data: {
          backupFilename: result.backupFilename,
          backupPath: result.backupPath,
          fileSizeBytes: result.fileSizeBytes,
        },
      })
    } else {
      return NextResponse.json(
        { error: result.errorMessage || '备份失败' },
        { status: 500 }
      )
    }

  } catch (error: any) {
    console.error('手动备份失败:', error)
    return NextResponse.json(
      { error: error.message || '备份失败' },
      { status: 500 }
    )
  }
}
