import { NextRequest, NextResponse } from 'next/server'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'
import { queueStrategyRecommendationExecution } from '@/lib/openclaw/strategy-recommendations'

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

  const body = await request.json().catch(() => ({})) as { confirm?: boolean }
  if (body.confirm !== true) {
    return NextResponse.json({ error: '执行前需要二次确认（confirm=true）' }, { status: 400 })
  }

  try {
    const result = await queueStrategyRecommendationExecution({
      userId: auth.userId,
      recommendationId,
      confirm: true,
      parentRequestId: request.headers.get('x-request-id') || undefined,
    })

    return NextResponse.json({
      success: true,
      queued: true,
      deduplicated: result.deduplicated,
      taskId: result.taskId,
      recommendation: result.recommendation,
    })
  } catch (error: any) {
    const message = error?.message || '执行建议失败'
    const status = message.includes('不存在')
      ? 404
      : (
        message.includes('重新分析')
        || message.includes('已暂不执行')
        || message.includes('已执行')
        || message.includes('仅支持执行')
        || message.includes('T-1建议仅支持执行')
      )
        ? 409
        : 400
    return NextResponse.json({ error: message }, { status })
  }
}
