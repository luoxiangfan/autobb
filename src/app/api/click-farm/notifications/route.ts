// GET /api/click-farm/notifications - 获取用户通知

import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getUserNotifications } from '@/lib/click-farm'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (_request: NextRequest, user) => {
  const notifications = await getUserNotifications(user.userId)

  return NextResponse.json({
    success: true,
    data: { notifications, count: notifications.length },
  })
})
