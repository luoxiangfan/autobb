import { NextRequest, NextResponse } from 'next/server'
import {
  FEISHU_CHAT_HEALTH_EXCERPT_LIMIT,
  FEISHU_CHAT_HEALTH_RETENTION_DAYS,
  FEISHU_CHAT_HEALTH_WINDOW_HOURS,
  getFeishuChatHealthExecutionMissingSeconds,
  listFeishuChatHealthLogs,
} from '@/lib/openclaw/feishu-chat-health'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'

function clampLimit(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 200
  return Math.max(20, Math.min(500, Math.floor(parsed)))
}

export async function GET(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: '仅管理员可查看聊天链路健康页' }, { status: 403 })
  }

  try {
    const limit = clampLimit(request.nextUrl.searchParams.get('limit'))
    const result = await listFeishuChatHealthLogs({
      userId: auth.user.userId,
      withinHours: FEISHU_CHAT_HEALTH_WINDOW_HOURS,
      limit,
    })

    return NextResponse.json({
      success: true,
      ...result,
      windowHours: FEISHU_CHAT_HEALTH_WINDOW_HOURS,
      retentionDays: FEISHU_CHAT_HEALTH_RETENTION_DAYS,
      excerptLimit: FEISHU_CHAT_HEALTH_EXCERPT_LIMIT,
      executionMissingSeconds: getFeishuChatHealthExecutionMissingSeconds(),
      limit,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || '加载飞书聊天链路健康数据失败',
      },
      { status: 500 }
    )
  }
}
