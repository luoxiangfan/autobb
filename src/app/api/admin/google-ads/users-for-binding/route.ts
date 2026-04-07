import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * 管理员端：获取可绑定的用户列表（简化版）
 * 
 * 仅返回绑定用户时需要的字段，不包含敏感信息
 * 用于 Google Ads 共享配置绑定用户时选择
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const db = getDatabase()
    
    const users = await db.query(`
      SELECT 
        id,
        email,
        display_name,
        role,
        is_active,
        created_at
      FROM users
      WHERE is_active = 1
      ORDER BY created_at DESC
    `, [])

    return NextResponse.json({ 
      success: true,
      data: { users }
    })
  } catch (error: any) {
    console.error('[Admin Users For Binding GET] Error:', error)
    return NextResponse.json({ 
      error: '获取用户列表失败',
      message: error.message 
    }, { status: 500 })
  }
}
