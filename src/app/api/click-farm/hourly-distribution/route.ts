// GET /api/click-farm/hourly-distribution - 获取今日时间分布

import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getHourlyDistribution } from '@/lib/click-farm'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (_request: NextRequest, user) => {
  const distribution = await getHourlyDistribution(user.userId)

  return NextResponse.json({
    success: true,
    data: distribution,
  })
})
