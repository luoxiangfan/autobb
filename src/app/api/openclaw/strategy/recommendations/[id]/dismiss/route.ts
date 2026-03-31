import { NextRequest, NextResponse } from 'next/server'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'
import { dismissStrategyRecommendation } from '@/lib/openclaw/strategy-recommendations'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  const recommendationId = String(params.id || '').trim()
  if (!recommendationId) {
    return NextResponse.json({ error: '缺少建议ID' }, { status: 400 })
  }

  try {
    const recommendation = await dismissStrategyRecommendation({
      userId: auth.userId,
      recommendationId,
    })

    return NextResponse.json({
      success: true,
      recommendation,
    })
  } catch (error: any) {
    const message = error?.message || '设置暂不执行失败'
    const status = message.includes('不存在')
      ? 404
      : message.includes('已执行')
        ? 409
        : 400
    return NextResponse.json({ error: message }, { status })
  }
}
