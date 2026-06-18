// GET /api/admin/url-swap/stats - 获取全局统计

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getUrlSwapGlobalStats } from '@/lib/url-swap'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async () => {
    const stats = await getUrlSwapGlobalStats()
    return NextResponse.json({ ...stats, success: true, data: stats })
  },
  { requireAdmin: true }
)
