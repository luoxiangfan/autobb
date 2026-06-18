// GET /api/url-swap/stats - 获取当前用户的换链统计

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getUrlSwapUserStats } from '@/lib/url-swap'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (_request, user) => {
  const stats = await getUrlSwapUserStats(user.userId)
  return NextResponse.json({ ...stats, success: true, data: stats })
})
