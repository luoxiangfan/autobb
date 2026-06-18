// GET /api/admin/click-farm/hourly-distribution - 全局时间分布

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getAdminHourlyDistribution } from '@/lib/click-farm'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async () => {
    const distribution = await getAdminHourlyDistribution()

    return NextResponse.json({
      success: true,
      data: distribution,
    })
  },
  { requireAdmin: true }
)
