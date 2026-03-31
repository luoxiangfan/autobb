import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getHostMetricsPayload } from '@/lib/host-metrics'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    if (auth.user.role !== 'admin') {
      return NextResponse.json({ error: '权限不足' }, { status: 403 })
    }

    const payload = await getHostMetricsPayload()
    return NextResponse.json({ success: true, data: payload })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || '获取资源监控数据失败' },
      { status: 500 }
    )
  }
}
