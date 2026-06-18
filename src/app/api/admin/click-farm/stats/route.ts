// GET /api/admin/click-farm/stats - 管理员全局统计

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getAdminClickFarmStats } from '@/lib/click-farm'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async () => {
    const stats = await getAdminClickFarmStats()

    return NextResponse.json({
      success: true,
      data: stats,
    })
  },
  { requireAdmin: true }
)
