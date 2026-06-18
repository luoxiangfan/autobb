import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { getHostMetricsPayload } from '@/lib/common/server'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async () => {
    try {
      const payload = await getHostMetricsPayload()
      return NextResponse.json({ success: true, data: payload })
    } catch (error: any) {
      return NextResponse.json(
        { success: false, error: error?.message || '获取资源监控数据失败' },
        { status: 500 }
      )
    }
  },
  { requireAdmin: true }
)
