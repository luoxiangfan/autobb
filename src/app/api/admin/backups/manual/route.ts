import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { backupDatabase } from '@/lib/common/server'

/**
 * POST /api/admin/backups/manual
 * 手动触发数据库备份(仅管理员)
 */
export const POST = withAuth(
  async (_request, user) => {
    try {
      const userId = user.userId
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
  },
  { requireAdmin: true }
)
