import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/openclaw/feishu/chat-health/ingest/route'

const gatewayAuthFns = vi.hoisted(() => ({
  verifyOpenclawGatewayToken: vi.fn(),
}))

const sessionAuthFns = vi.hoisted(() => ({
  verifyOpenclawSessionAuth: vi.fn(),
}))

const healthFns = vi.hoisted(() => ({
  recordFeishuChatHealthLog: vi.fn(),
  backfillFeishuChatHealthRunLinks: vi.fn(),
}))

const accountFns = vi.hoisted(() => ({
  parseFeishuAccountUserId: vi.fn(),
}))

const bindingFns = vi.hoisted(() => ({
  resolveOpenclawUserFromBinding: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

vi.mock('@/lib/openclaw/auth', () => ({
  verifyOpenclawGatewayToken: gatewayAuthFns.verifyOpenclawGatewayToken,
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  verifyOpenclawSessionAuth: sessionAuthFns.verifyOpenclawSessionAuth,
}))

vi.mock('@/lib/openclaw/feishu-chat-health', () => ({
  recordFeishuChatHealthLog: healthFns.recordFeishuChatHealthLog,
  backfillFeishuChatHealthRunLinks: healthFns.backfillFeishuChatHealthRunLinks,
}))

vi.mock('@/lib/openclaw/feishu-accounts', () => ({
  parseFeishuAccountUserId: accountFns.parseFeishuAccountUserId,
}))

vi.mock('@/lib/openclaw/bindings', () => ({
  resolveOpenclawUserFromBinding: bindingFns.resolveOpenclawUserFromBinding,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

function createRequest(body: unknown, token?: string) {
  return new NextRequest('http://localhost/api/openclaw/feishu/chat-health/ingest', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('openclaw feishu chat health ingest route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    gatewayAuthFns.verifyOpenclawGatewayToken.mockResolvedValue(true)
    sessionAuthFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: false,
      status: 401,
      error: '未授权',
    })
    accountFns.parseFeishuAccountUserId.mockReturnValue(7)
    bindingFns.resolveOpenclawUserFromBinding.mockResolvedValue(null)
    dbFns.getDatabase.mockResolvedValue({
      queryOne: vi.fn().mockResolvedValue(null),
    })
    healthFns.recordFeishuChatHealthLog.mockResolvedValue(undefined)
    healthFns.backfillFeishuChatHealthRunLinks.mockResolvedValue({ updatedRuns: 0 })
  })

  it('accepts gateway token and stores health log', async () => {
    const res = await POST(createRequest({
      accountId: 'user-7',
      decision: 'blocked',
      reasonCode: 'group_require_mention',
      messageText: 'hello',
      senderCandidates: ['ou_1'],
    }, 'gateway-token'))

    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.stored).toBe(true)
    expect(payload.userId).toBe(7)

    expect(healthFns.recordFeishuChatHealthLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        accountId: 'user-7',
        decision: 'blocked',
        reasonCode: 'group_require_mention',
      })
    )
    expect(healthFns.backfillFeishuChatHealthRunLinks).not.toHaveBeenCalled()
  })

  it('skips duplicate_message noise events without storing logs', async () => {
    const res = await POST(createRequest({
      accountId: 'user-7',
      decision: 'blocked',
      reasonCode: 'duplicate_message',
      reasonMessage: 'duplicate message skipped by dedup',
      messageId: 'om_dup_1',
    }, 'gateway-token'))

    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.stored).toBe(false)
    expect(payload.skippedReason).toBe('duplicate_message')
    expect(healthFns.recordFeishuChatHealthLog).not.toHaveBeenCalled()
    expect(healthFns.backfillFeishuChatHealthRunLinks).not.toHaveBeenCalled()
  })

  it('rejects non-admin session when gateway token invalid', async () => {
    gatewayAuthFns.verifyOpenclawGatewayToken.mockResolvedValue(false)
    sessionAuthFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7, role: 'member' },
    })

    const res = await POST(createRequest({
      accountId: 'user-7',
      decision: 'blocked',
      reasonCode: 'group_require_mention',
    }, 'bad-token'))

    const payload = await res.json()

    expect(res.status).toBe(403)
    expect(payload.error).toContain('无权写入')
    expect(healthFns.recordFeishuChatHealthLog).not.toHaveBeenCalled()
  })

  it('backfills run links for allowed messages with messageId', async () => {
    const res = await POST(createRequest({
      accountId: 'user-7',
      messageId: 'om_1',
      senderOpenId: 'ou_1',
      senderCandidates: ['ou_1'],
      decision: 'allowed',
      reasonCode: 'reply_dispatched',
      messageText: 'hello',
    }, 'gateway-token'))

    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.stored).toBe(true)

    expect(healthFns.recordFeishuChatHealthLog).toHaveBeenCalled()
    expect(healthFns.backfillFeishuChatHealthRunLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        messageId: 'om_1',
        senderIds: ['ou_1'],
      })
    )
  })

  it('returns stored=false when user cannot be resolved', async () => {
    accountFns.parseFeishuAccountUserId.mockReturnValue(null)
    bindingFns.resolveOpenclawUserFromBinding.mockResolvedValue(null)
    dbFns.getDatabase.mockResolvedValue({
      queryOne: vi.fn().mockResolvedValue(null),
    })

    const res = await POST(createRequest({
      accountId: 'cli_xxx',
      senderPrimaryId: 'ou_unknown',
      senderCandidates: ['ou_unknown'],
      decision: 'blocked',
      reasonCode: 'dm_allowlist_denied',
    }, 'gateway-token'))

    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.stored).toBe(false)
    expect(payload.skippedReason).toBe('user_unresolved')
    expect(healthFns.recordFeishuChatHealthLog).not.toHaveBeenCalled()
  })

  it('accepts senderId aliases even when accountId is missing', async () => {
    accountFns.parseFeishuAccountUserId.mockReturnValue(null)
    bindingFns.resolveOpenclawUserFromBinding.mockResolvedValue(11)

    const res = await POST(createRequest({
      senderId: 'ou_alias_1',
      decision: 'allowed',
      reasonCode: 'reply_dispatched',
      messageId: 'req_123',
    }, 'gateway-token'))

    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.stored).toBe(true)
    expect(payload.userId).toBe(11)

    expect(bindingFns.resolveOpenclawUserFromBinding).toHaveBeenCalledWith(
      'feishu',
      'ou_alias_1',
      expect.objectContaining({
        accountId: 'unknown',
      })
    )
    expect(healthFns.recordFeishuChatHealthLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 11,
        accountId: 'unknown',
        messageId: undefined,
        senderPrimaryId: 'ou_alias_1',
        senderCandidates: ['ou_alias_1'],
      })
    )
    expect(healthFns.backfillFeishuChatHealthRunLinks).not.toHaveBeenCalled()
  })

  it('accepts snake_case payload fields and decision alias', async () => {
    accountFns.parseFeishuAccountUserId.mockReturnValue(null)
    bindingFns.resolveOpenclawUserFromBinding.mockResolvedValue(17)

    const res = await POST(createRequest({
      account_id: 'cli_feishu_main',
      sender_open_id: 'ou_snake_1',
      sender_candidates: ['ou_snake_1', 'ou_snake_1', ''],
      decision: 'allow',
      reason: 'reply_dispatched',
      message_id: 'om_x1',
      tenant_key: 'tenant_1',
      message_text: 'hello',
    }, 'gateway-token'))

    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.stored).toBe(true)
    expect(payload.userId).toBe(17)
    expect(healthFns.recordFeishuChatHealthLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 17,
        accountId: 'cli_feishu_main',
        senderOpenId: 'ou_snake_1',
        decision: 'allowed',
        reasonCode: 'reply_dispatched',
        messageId: 'om_x1',
      })
    )
  })

  it('accepts inbound_message_id as message id for allowed events', async () => {
    accountFns.parseFeishuAccountUserId.mockReturnValue(null)
    bindingFns.resolveOpenclawUserFromBinding.mockResolvedValue(21)

    const res = await POST(createRequest({
      account_id: 'cli_feishu_main',
      sender_open_id: 'ou_inbound_1',
      sender_candidates: ['ou_inbound_1'],
      decision: 'allowed',
      reason_code: 'reply_dispatched',
      inbound_message_id: 'om_inbound_123',
    }, 'gateway-token'))

    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.stored).toBe(true)
    expect(payload.userId).toBe(21)

    expect(healthFns.recordFeishuChatHealthLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 21,
        accountId: 'cli_feishu_main',
        messageId: 'om_inbound_123',
        reasonCode: 'reply_dispatched',
      })
    )
    expect(healthFns.backfillFeishuChatHealthRunLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 21,
        messageId: 'om_inbound_123',
        senderIds: ['ou_inbound_1'],
      })
    )
  })
})
