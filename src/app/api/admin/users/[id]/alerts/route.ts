import { NextRequest, NextResponse } from 'next/server'
import { withAuth, AuthenticatedHandler } from '@/lib/auth'
import { getUserAlerts } from '@/lib/user-sessions'

/**
 * GET /api/admin/users/[id]/alerts
 * 获取指定用户的安全告警列表
 */
const getHandler: AuthenticatedHandler = async (request, user, context) => {
  const userId = parseInt(context?.params?.id || '0')

  if (!userId || isNaN(userId)) {
    return NextResponse.json({ error: '无效的用户ID' }, { status: 400 })
  }

  try {
    const includeResolved = request.nextUrl.searchParams.get('includeResolved') === 'true'
    const alerts = await getUserAlerts(userId, includeResolved)

    return NextResponse.json({ alerts })
  } catch (error: any) {
    console.error('获取安全告警失败:', error)
    return NextResponse.json(
      { error: error.message || '获取安全告警失败' },
      { status: 500 }
    )
  }
}

export const GET = withAuth(getHandler, { requireAdmin: true })
