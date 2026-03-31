import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/openclaw/feishu/chat-health/route'

const authFns = vi.hoisted(() => ({
  verifyOpenclawSessionAuth: vi.fn(),
}))

const healthFns = vi.hoisted(() => ({
  listFeishuChatHealthLogs: vi.fn(),
  FEISHU_CHAT_HEALTH_WINDOW_HOURS: 168,
  FEISHU_CHAT_HEALTH_RETENTION_DAYS: 7,
  FEISHU_CHAT_HEALTH_EXCERPT_LIMIT: 500,
  FEISHU_CHAT_HEALTH_EXECUTION_MISSING_SECONDS: 180,
  getFeishuChatHealthExecutionMissingSeconds: vi.fn().mockReturnValue(180),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  verifyOpenclawSessionAuth: authFns.verifyOpenclawSessionAuth,
}))

vi.mock('@/lib/openclaw/feishu-chat-health', () => ({
  listFeishuChatHealthLogs: healthFns.listFeishuChatHealthLogs,
  FEISHU_CHAT_HEALTH_WINDOW_HOURS: healthFns.FEISHU_CHAT_HEALTH_WINDOW_HOURS,
  FEISHU_CHAT_HEALTH_RETENTION_DAYS: healthFns.FEISHU_CHAT_HEALTH_RETENTION_DAYS,
  FEISHU_CHAT_HEALTH_EXCERPT_LIMIT: healthFns.FEISHU_CHAT_HEALTH_EXCERPT_LIMIT,
  FEISHU_CHAT_HEALTH_EXECUTION_MISSING_SECONDS: healthFns.FEISHU_CHAT_HEALTH_EXECUTION_MISSING_SECONDS,
  getFeishuChatHealthExecutionMissingSeconds: healthFns.getFeishuChatHealthExecutionMissingSeconds,
}))

describe('openclaw feishu chat health route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7, role: 'admin' },
    })
    healthFns.getFeishuChatHealthExecutionMissingSeconds.mockReturnValue(180)
    healthFns.listFeishuChatHealthLogs.mockResolvedValue({
      rows: [
        {
          id: 1,
          userId: 7,
          accountId: 'user-7',
          messageId: 'om_1',
          chatId: 'oc_1',
          chatType: 'group',
          messageType: 'text',
          senderPrimaryId: 'ou_1',
          senderOpenId: 'ou_1',
          senderUnionId: null,
          senderUserId: null,
          senderCandidates: ['ou_1'],
          decision: 'blocked',
          reasonCode: 'group_require_mention',
          reasonMessage: 'group requires @mention',
          messageText: 'hello world',
          messageExcerpt: 'hello world',
          messageTextLength: 11,
          metadata: null,
          executionState: 'not_applicable',
          executionRunId: null,
          executionRunStatus: null,
          executionRunCount: 0,
          executionRunCreatedAt: null,
          executionDetail: '非放行消息，无执行链路',
          ageSeconds: 0,
          createdAt: '2026-02-10T03:00:00.000Z',
        },
      ],
      stats: {
        total: 1,
        allowed: 0,
        blocked: 1,
        error: 0,
        execution: {
          linked: 0,
          completed: 0,
          inProgress: 0,
          waiting: 0,
          missing: 0,
          failed: 0,
          notApplicable: 1,
          unknown: 0,
        },
      },
    })
  })

  it('returns 401 when not authenticated', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValueOnce({
      authenticated: false,
      status: 401,
      error: '未授权',
    })

    const res = await GET(new NextRequest('http://localhost/api/openclaw/feishu/chat-health'))
    const payload = await res.json()

    expect(res.status).toBe(401)
    expect(payload.error).toContain('未授权')
    expect(healthFns.listFeishuChatHealthLogs).not.toHaveBeenCalled()
  })

  it('returns 403 for non-admin', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValueOnce({
      authenticated: true,
      user: { userId: 7, role: 'member' },
    })

    const res = await GET(new NextRequest('http://localhost/api/openclaw/feishu/chat-health'))
    const payload = await res.json()

    expect(res.status).toBe(403)
    expect(payload.error).toContain('仅管理员可查看')
    expect(healthFns.listFeishuChatHealthLogs).not.toHaveBeenCalled()
  })

  it('returns chat health payload for admin', async () => {
    const res = await GET(new NextRequest('http://localhost/api/openclaw/feishu/chat-health?limit=999'))
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.stats.total).toBe(1)
    expect(payload.rows).toHaveLength(1)
    expect(payload.windowHours).toBe(168)
    expect(payload.retentionDays).toBe(7)
    expect(payload.excerptLimit).toBe(500)
    expect(payload.executionMissingSeconds).toBe(180)
    expect(payload.limit).toBe(500)
    expect(healthFns.getFeishuChatHealthExecutionMissingSeconds).toHaveBeenCalledTimes(1)

    expect(healthFns.listFeishuChatHealthLogs).toHaveBeenCalledWith({
      userId: 7,
      withinHours: 168,
      limit: 500,
    })
  })
})
