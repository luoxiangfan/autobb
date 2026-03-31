import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

const dbHelperFns = vi.hoisted(() => ({
  datetimeMinusHours: vi.fn(),
  nowFunc: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/db-helpers', () => ({
  datetimeMinusHours: dbHelperFns.datetimeMinusHours,
  nowFunc: dbHelperFns.nowFunc,
}))

import {
  backfillFeishuChatHealthRunLinks,
  listFeishuChatHealthLogs,
  recordFeishuChatHealthLog,
} from '@/lib/openclaw/feishu-chat-health'

describe('feishu chat health lib', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbHelperFns.datetimeMinusHours.mockImplementation((hours: number, dbType: string) => {
      if (dbType === 'postgres') {
        return `CURRENT_TIMESTAMP - INTERVAL '${hours} hours'`
      }
      return `datetime('now', '-${hours} hours')`
    })
    dbHelperFns.nowFunc.mockImplementation((dbType: string) => {
      return dbType === 'postgres' ? 'NOW()' : "datetime('now')"
    })
  })

  it('lists logs with excerpt and grouped stats', async () => {
    const longText = 'A'.repeat(510)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:20:00.000Z'))
    const db = {
      type: 'sqlite',
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 1,
            user_id: 7,
            account_id: 'user-7',
            message_id: 'om_1',
            chat_id: 'oc_1',
            chat_type: 'group',
            message_type: 'text',
            sender_primary_id: 'ou_1',
            sender_open_id: 'ou_1',
            sender_union_id: null,
            sender_user_id: null,
            sender_candidates_json: '["ou_1"]',
            decision: 'blocked',
            reason_code: 'group_require_mention',
            reason_message: 'group requires @mention',
            message_text: longText,
            message_text_length: 510,
            metadata_json: '{"k":"v"}',
            created_at: '2026-02-10 03:00:00',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { decision: 'allowed', total: 2 },
          { decision: 'blocked', total: 3 },
          { decision: 'error', total: 1 },
        ]),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].messageExcerpt.length).toBe(501)
    expect(result.rows[0].messageExcerpt.endsWith('…')).toBe(true)

    expect(result.stats).toEqual({
      total: 6,
      allowed: 2,
      blocked: 3,
      error: 1,
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
      workflow: {
        tracked: 0,
        completed: 0,
        running: 0,
        incomplete: 0,
        failed: 0,
        notRequired: 1,
        unknown: 0,
      },
    })

    expect(db.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM openclaw_feishu_chat_health_logs'),
      [7, 100]
    )
    expect(db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM openclaw_command_runs'),
      [7]
    )
    expect(db.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('GROUP BY decision'),
      [7]
    )
    const rowsSql = String(db.query.mock.calls[0]?.[0] || '')
    const statsSql = String(db.query.mock.calls[2]?.[0] || '')
    expect(rowsSql).toContain("reason_code")
    expect(rowsSql).toContain("duplicate_message")
    expect(statsSql).toContain("reason_code")
    expect(statsSql).toContain("duplicate_message")
    expect(db.query).toHaveBeenCalledTimes(3)

    vi.useRealTimers()
  })

  it('marks allowed rows as missing when dispatch exceeded threshold without run', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:20:00.000Z'))

    const db = {
      type: 'sqlite',
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 2,
            user_id: 7,
            account_id: 'user-7',
            message_id: 'om_missing',
            chat_id: 'oc_1',
            chat_type: 'p2p',
            message_type: 'text',
            sender_primary_id: 'ou_1',
            sender_open_id: 'ou_1',
            sender_union_id: null,
            sender_user_id: null,
            sender_candidates_json: '["ou_1"]',
            decision: 'allowed',
            reason_code: 'reply_dispatched',
            reason_message: 'message passed access checks and entered reply pipeline',
            message_text: '请修复offer 123广告投放',
            message_text_length: 17,
            metadata_json: null,
            created_at: '2026-02-10 03:00:00',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { decision: 'allowed', total: 1 },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })

    expect(result.rows[0].executionState).toBe('missing')
    expect(result.rows[0].executionRunCount).toBe(0)
    expect(result.rows[0].executionDetail).toContain('仍无命令执行记录')
    expect(result.stats.execution.missing).toBe(1)
    expect(result.stats.execution.waiting).toBe(0)

    expect(db.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('GROUP BY decision'),
      [7]
    )
    expect(db.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('FROM openclaw_command_runs'),
      [7, 'om_missing']
    )
    expect(db.query).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining('FROM openclaw_command_runs'),
      [7, 'ou_1']
    )

    vi.useRealTimers()
  })

  it('shows synthetic chain row when command runs exist before health ingest arrives', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:20:00.000Z'))

    const runRow = {
      id: 'run-1',
      parent_request_id: 'om_synthetic_1',
      channel: 'feishu',
      sender_id: 'ou_1',
      status: 'queued',
      request_path: '/api/offers/123/generate-creatives-queue',
      request_body_json: '{"bucket":"A"}',
      response_status: null,
      response_body: null,
      created_at: '2026-02-10 03:00:00',
    }

    const db = {
      type: 'sqlite',
      query: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([runRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([runRow]),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBeLessThan(0)
    expect(result.rows[0].messageId).toBe('om_synthetic_1')
    expect(result.rows[0].reasonCode).toBe('command_run_created')
    expect(result.rows[0].executionRunCount).toBe(1)
    expect(result.rows[0].executionRunId).toBe('run-1')
    expect(result.rows[0].executionState).toBe('queued')
    expect(result.stats.total).toBe(1)
    expect(result.stats.allowed).toBe(1)
    expect(result.stats.execution.linked).toBe(1)
    expect(result.stats.execution.inProgress).toBe(1)

    vi.useRealTimers()
  })

  it('marks conversational allowed rows as not_applicable when no execution is expected', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:20:00.000Z'))

    const db = {
      type: 'sqlite',
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 2,
            user_id: 7,
            account_id: 'user-7',
            message_id: 'om_non_command',
            chat_id: 'oc_1',
            chat_type: 'p2p',
            message_type: 'text',
            sender_primary_id: 'ou_1',
            sender_open_id: 'ou_1',
            sender_union_id: null,
            sender_user_id: null,
            sender_candidates_json: '["ou_1"]',
            decision: 'allowed',
            reason_code: 'reply_dispatched',
            reason_message: 'message passed access checks and entered reply pipeline',
            message_text: '你现在使用的AI模型是什么？',
            message_text_length: 14,
            metadata_json: null,
            created_at: '2026-02-10 03:00:00',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { decision: 'allowed', total: 1 },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })

    expect(result.rows[0].executionState).toBe('not_applicable')
    expect(result.rows[0].executionRunCount).toBe(0)
    expect(result.rows[0].executionDetail).toContain('无命令执行预期')
    expect(result.stats.execution.notApplicable).toBe(1)
    expect(result.stats.execution.missing).toBe(0)

    vi.useRealTimers()
  })

  it('links allowed rows to runs via sender/time when parent_request_id does not match', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:20:00.000Z'))

    const db = {
      type: 'sqlite',
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 3,
            user_id: 7,
            account_id: 'user-7',
            message_id: 'om_1',
            chat_id: 'oc_1',
            chat_type: 'p2p',
            message_type: 'text',
            sender_primary_id: 'ou_1',
            sender_open_id: 'ou_1',
            sender_union_id: null,
            sender_user_id: null,
            sender_candidates_json: '["ou_1"]',
            decision: 'allowed',
            reason_code: 'reply_dispatched',
            reason_message: 'message passed access checks and entered reply pipeline',
            message_text: '请修复offer 123广告投放',
            message_text_length: 17,
            metadata_json: null,
            created_at: '2026-02-10 03:00:00',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { decision: 'allowed', total: 1 },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'run-1',
            parent_request_id: 'uuid-1',
            channel: 'feishu',
            sender_id: 'ou_1',
            status: 'completed',
            created_at: '2026-02-10 02:59:50',
          },
        ]),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })

    expect(result.rows[0].executionRunCount).toBe(1)
    expect(result.rows[0].executionRunId).toBe('run-1')
    expect(result.rows[0].executionState).toBe('completed')
    expect(result.rows[0].executionDetail).toContain('sender/time')
    expect(result.stats.execution.linked).toBe(1)
    expect(result.stats.execution.completed).toBe(1)

    vi.useRealTimers()
  })

  it('marks 3-creatives-and-publish workflow as incomplete when D/publish are missing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:20:00.000Z'))

    const logs = [
      {
        id: 31,
        user_id: 7,
        account_id: 'user-7',
        message_id: 'om_chain',
        chat_id: 'oc_1',
        chat_type: 'p2p',
        message_type: 'text',
        sender_primary_id: 'ou_1',
        sender_open_id: 'ou_1',
        sender_union_id: null,
        sender_user_id: null,
        sender_candidates_json: '["ou_1"]',
        decision: 'allowed',
        reason_code: 'reply_dispatched',
        reason_message: 'message passed access checks and entered reply pipeline',
        message_text:
          '请依次生成3个新的广告创意（前一个成功后再生成下一个），3个创意都完成后再发布广告。',
        message_text_length: 50,
        metadata_json: null,
        created_at: '2026-02-10 03:00:00',
      },
    ]

    const parentRuns = [
      {
        id: 'run-b',
        parent_request_id: 'om_chain',
        channel: 'feishu',
        sender_id: 'ou_1',
        status: 'completed',
        request_path: '/api/offers/123/generate-creatives-queue',
        request_body_json: '{"bucket":"B"}',
        response_status: 200,
        response_body: '{"taskId":"task-b","bucket":"B"}',
        created_at: '2026-02-10 03:05:00',
      },
      {
        id: 'run-a',
        parent_request_id: 'om_chain',
        channel: 'feishu',
        sender_id: 'ou_1',
        status: 'completed',
        request_path: '/api/offers/123/generate-creatives-queue',
        request_body_json: '{"bucket":"A"}',
        response_status: 200,
        response_body: '{"taskId":"task-a","bucket":"A"}',
        created_at: '2026-02-10 03:04:00',
      },
    ]

    const db = {
      type: 'sqlite',
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_feishu_chat_health_logs') && sql.includes('GROUP BY decision')) {
          return [{ decision: 'allowed', total: 1 }]
        }
        if (sql.includes('FROM openclaw_feishu_chat_health_logs')) {
          return logs
        }
        if (sql.includes('parent_request_id IN')) {
          return parentRuns
        }
        if (sql.includes('sender_id IN') && sql.includes('ORDER BY created_at ASC')) {
          return parentRuns
        }
        if (sql.includes('FROM creative_tasks')) {
          return [
            {
              id: 'task-a',
              offer_id: 123,
              status: 'completed',
              stage: 'complete',
              progress: 100,
              message: 'ok',
              completed_at: '2026-02-10 03:04:45',
              updated_at: '2026-02-10 03:04:45',
            },
            {
              id: 'task-b',
              offer_id: 123,
              status: 'completed',
              stage: 'complete',
              progress: 100,
              message: 'ok',
              completed_at: '2026-02-10 03:05:30',
              updated_at: '2026-02-10 03:05:30',
            },
          ]
        }
        return []
      }),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })

    expect(result.rows[0].executionState).toBe('completed')
    expect(result.rows[0].workflowState).toBe('incomplete')
    expect(result.rows[0].workflowDetail).toContain('生成桶 D')
    expect(result.rows[0].workflowDetail).toContain('发布广告')
    expect(result.stats.workflow.tracked).toBe(1)
    expect(result.stats.workflow.incomplete).toBe(1)
    expect(result.stats.workflow.completed).toBe(0)

    vi.useRealTimers()
  })

  it('marks workflow completed when remaining steps continue under another parent_request_id', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:30:00.000Z'))

    const logs = [
      {
        id: 32,
        user_id: 7,
        account_id: 'user-7',
        message_id: 'om_other',
        chat_id: 'oc_1',
        chat_type: 'p2p',
        message_type: 'text',
        sender_primary_id: 'ou_1',
        sender_open_id: 'ou_1',
        sender_union_id: null,
        sender_user_id: null,
        sender_candidates_json: '["ou_1"]',
        decision: 'allowed',
        reason_code: 'reply_dispatched',
        reason_message: 'message passed access checks and entered reply pipeline',
        message_text: '今天天气如何',
        message_text_length: 6,
        metadata_json: null,
        created_at: '2026-02-10 03:25:00',
      },
      {
        id: 31,
        user_id: 7,
        account_id: 'user-7',
        message_id: 'om_chain',
        chat_id: 'oc_1',
        chat_type: 'p2p',
        message_type: 'text',
        sender_primary_id: 'ou_1',
        sender_open_id: 'ou_1',
        sender_union_id: null,
        sender_user_id: null,
        sender_candidates_json: '["ou_1"]',
        decision: 'allowed',
        reason_code: 'reply_dispatched',
        reason_message: 'message passed access checks and entered reply pipeline',
        message_text:
          '请依次生成3个新的广告创意（前一个成功后再生成下一个），3个创意都完成后再发布广告。',
        message_text_length: 50,
        metadata_json: null,
        created_at: '2026-02-10 03:00:00',
      },
    ]

    const parentRuns = [
      {
        id: 'run-b',
        parent_request_id: 'om_chain',
        channel: 'feishu',
        sender_id: 'ou_1',
        status: 'completed',
        request_path: '/api/offers/123/generate-creatives-queue',
        request_body_json: '{"bucket":"B"}',
        response_status: 200,
        response_body: '{"taskId":"task-b","bucket":"B"}',
        created_at: '2026-02-10 03:05:00',
      },
      {
        id: 'run-a',
        parent_request_id: 'om_chain',
        channel: 'feishu',
        sender_id: 'ou_1',
        status: 'completed',
        request_path: '/api/offers/123/generate-creatives-queue',
        request_body_json: '{"bucket":"A"}',
        response_status: 200,
        response_body: '{"taskId":"task-a","bucket":"A"}',
        created_at: '2026-02-10 03:04:00',
      },
      {
        id: 'run-d',
        parent_request_id: 'om_other',
        channel: 'feishu',
        sender_id: 'ou_1',
        status: 'completed',
        request_path: '/api/offers/123/generate-creatives-queue',
        request_body_json: '{"bucket":"D"}',
        response_status: 200,
        response_body: '{"taskId":"task-d","bucket":"D"}',
        created_at: '2026-02-10 03:10:00',
      },
      {
        id: 'run-publish',
        parent_request_id: 'om_other',
        channel: 'feishu',
        sender_id: 'ou_1',
        status: 'completed',
        request_path: '/api/campaigns/publish',
        request_body_json: '{"offerId":123,"adCreativeId":999}',
        response_status: 202,
        response_body: '{"campaigns":[{"id":501,"creationStatus":"pending"}]}',
        created_at: '2026-02-10 03:12:00',
      },
    ]

    const db = {
      type: 'sqlite',
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_feishu_chat_health_logs') && sql.includes('GROUP BY decision')) {
          return [{ decision: 'allowed', total: 2 }]
        }
        if (sql.includes('FROM openclaw_feishu_chat_health_logs')) {
          return logs
        }
        if (sql.includes('parent_request_id IN')) {
          return parentRuns
        }
        if (sql.includes('sender_id IN') && sql.includes('ORDER BY created_at ASC')) {
          return parentRuns
        }
        if (sql.includes('FROM creative_tasks')) {
          return [
            {
              id: 'task-a',
              offer_id: 123,
              status: 'completed',
              stage: 'complete',
              progress: 100,
              message: 'ok',
              completed_at: '2026-02-10 03:04:45',
              updated_at: '2026-02-10 03:04:45',
            },
            {
              id: 'task-b',
              offer_id: 123,
              status: 'completed',
              stage: 'complete',
              progress: 100,
              message: 'ok',
              completed_at: '2026-02-10 03:05:30',
              updated_at: '2026-02-10 03:05:30',
            },
            {
              id: 'task-d',
              offer_id: 123,
              status: 'completed',
              stage: 'complete',
              progress: 100,
              message: 'ok',
              completed_at: '2026-02-10 03:10:40',
              updated_at: '2026-02-10 03:10:40',
            },
          ]
        }
        if (sql.includes('FROM campaigns')) {
          return [
            {
              id: 501,
              offer_id: 123,
              ad_creative_id: 999,
              creation_status: 'synced',
              creation_error: null,
              status: 'ENABLED',
              is_deleted: 0,
              created_at: '2026-02-10 03:12:30',
              updated_at: '2026-02-10 03:13:00',
              published_at: '2026-02-10 03:13:00',
            },
          ]
        }
        return []
      }),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })
    const workflowRow = result.rows.find((row) => row.messageId === 'om_chain')
    const nonWorkflowRow = result.rows.find((row) => row.messageId === 'om_other')

    expect(workflowRow?.workflowState).toBe('completed')
    expect(workflowRow?.workflowDetail).toContain('业务链路完成')
    expect(nonWorkflowRow?.workflowState).toBe('not_required')
    expect(result.stats.workflow.tracked).toBe(1)
    expect(result.stats.workflow.completed).toBe(1)
    vi.useRealTimers()
  })

  it('recovers early workflow steps when health log is ingested late', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-22T03:20:00.000Z'))

    const db = {
      type: 'sqlite',
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_feishu_chat_health_logs') && sql.includes('GROUP BY decision')) {
          return [{ decision: 'allowed', total: 1 }]
        }
        if (sql.includes('FROM openclaw_feishu_chat_health_logs')) {
          return [
            {
              id: 510,
              user_id: 7,
              account_id: 'user-7',
              message_id: 'om_chain',
              chat_id: 'oc_1',
              chat_type: 'p2p',
              message_type: 'text',
              sender_primary_id: 'ou_1',
              sender_open_id: 'ou_1',
              sender_union_id: null,
              sender_user_id: null,
              sender_candidates_json: '["ou_1"]',
              decision: 'allowed',
              reason_code: 'reply_delivered',
              reason_message: 'message passed access checks and entered reply pipeline',
              message_text: '请生成3个创意并发布广告',
              message_text_length: 13,
              metadata_json: null,
              created_at: '2026-02-22 03:00:00',
            },
          ]
        }
        if (sql.includes('parent_request_id IN')) {
          return [
            {
              id: 'run-b',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"B"}',
              response_status: 200,
              response_body: '{"taskId":"task-b","bucket":"B"}',
              created_at: '2026-02-22 02:40:00',
            },
            {
              id: 'run-d',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"D"}',
              response_status: 200,
              response_body: '{"taskId":"task-d","bucket":"D"}',
              created_at: '2026-02-22 02:47:00',
            },
            {
              id: 'run-publish',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/campaigns/publish',
              request_body_json: '{"offerId":123,"adCreativeId":999}',
              response_status: 202,
              response_body: '{"campaigns":[{"id":801,"creationStatus":"pending"}]}',
              created_at: '2026-02-22 02:50:00',
            },
          ]
        }
        if (sql.includes('sender_id IN') && sql.includes('ORDER BY created_at ASC')) {
          return [
            {
              id: 'run-a-early',
              parent_request_id: 'uuid-legacy',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"A"}',
              response_status: 200,
              response_body: '{"taskId":"task-a","bucket":"A"}',
              created_at: '2026-02-22 02:20:00',
            },
            {
              id: 'run-b',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"B"}',
              response_status: 200,
              response_body: '{"taskId":"task-b","bucket":"B"}',
              created_at: '2026-02-22 02:40:00',
            },
            {
              id: 'run-d',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"D"}',
              response_status: 200,
              response_body: '{"taskId":"task-d","bucket":"D"}',
              created_at: '2026-02-22 02:47:00',
            },
            {
              id: 'run-publish',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/campaigns/publish',
              request_body_json: '{"offerId":123,"adCreativeId":999}',
              response_status: 202,
              response_body: '{"campaigns":[{"id":801,"creationStatus":"pending"}]}',
              created_at: '2026-02-22 02:50:00',
            },
          ]
        }
        if (sql.includes('FROM creative_tasks')) {
          return [
            {
              id: 'task-a',
              offer_id: 123,
              status: 'completed',
              stage: 'complete',
              progress: 100,
              message: 'ok',
              completed_at: '2026-02-22 02:25:00',
              updated_at: '2026-02-22 02:25:00',
            },
            {
              id: 'task-b',
              offer_id: 123,
              status: 'completed',
              stage: 'complete',
              progress: 100,
              message: 'ok',
              completed_at: '2026-02-22 02:42:00',
              updated_at: '2026-02-22 02:42:00',
            },
            {
              id: 'task-d',
              offer_id: 123,
              status: 'completed',
              stage: 'complete',
              progress: 100,
              message: 'ok',
              completed_at: '2026-02-22 02:48:00',
              updated_at: '2026-02-22 02:48:00',
            },
          ]
        }
        if (sql.includes('FROM campaigns')) {
          return [
            {
              id: 801,
              offer_id: 123,
              ad_creative_id: 999,
              creation_status: 'synced',
              creation_error: null,
              status: 'ENABLED',
              is_deleted: 0,
              created_at: '2026-02-22 02:50:30',
              updated_at: '2026-02-22 02:51:00',
              published_at: '2026-02-22 02:51:00',
            },
          ]
        }
        return []
      }),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 3, limit: 100 })

    expect(result.rows[0].workflowState).toBe('completed')
    expect(result.rows[0].workflowDetail).toContain('业务链路完成')
    expect(result.stats.workflow.completed).toBe(1)

    vi.useRealTimers()
  })

  it('does not split workflow chain when an intermediate "继续" message is inserted', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:30:00.000Z'))

    const logs = [
      {
        id: 33,
        user_id: 7,
        account_id: 'user-7',
        message_id: 'om_continue',
        chat_id: 'oc_1',
        chat_type: 'p2p',
        message_type: 'text',
        sender_primary_id: 'ou_1',
        sender_open_id: 'ou_1',
        sender_union_id: null,
        sender_user_id: null,
        sender_candidates_json: '["ou_1"]',
        decision: 'allowed',
        reason_code: 'reply_delivered',
        reason_message: 'message passed access checks and entered reply pipeline',
        message_text: '继续',
        message_text_length: 2,
        metadata_json: null,
        created_at: '2026-02-10 03:06:00',
      },
      {
        id: 31,
        user_id: 7,
        account_id: 'user-7',
        message_id: 'om_chain',
        chat_id: 'oc_1',
        chat_type: 'p2p',
        message_type: 'text',
        sender_primary_id: 'ou_1',
        sender_open_id: 'ou_1',
        sender_union_id: null,
        sender_user_id: null,
        sender_candidates_json: '["ou_1"]',
        decision: 'allowed',
        reason_code: 'reply_delivered',
        reason_message: 'message passed access checks and entered reply pipeline',
        message_text: '请依次生成3个新的广告创意（前一个成功后再生成下一个），3个创意都完成后再发布广告。',
        message_text_length: 50,
        metadata_json: null,
        created_at: '2026-02-10 03:00:00',
      },
    ]

    const runs = [
      {
        id: 'run-a',
        parent_request_id: 'om_chain',
        channel: 'feishu',
        sender_id: 'ou_1',
        status: 'completed',
        request_path: '/api/offers/123/generate-creatives-queue',
        request_body_json: '{"bucket":"A"}',
        response_status: 200,
        response_body: '{"taskId":"task-a","bucket":"A"}',
        created_at: '2026-02-10 03:01:00',
      },
      {
        id: 'run-b',
        parent_request_id: 'om_chain',
        channel: 'feishu',
        sender_id: 'ou_1',
        status: 'completed',
        request_path: '/api/offers/123/generate-creatives-queue',
        request_body_json: '{"bucket":"B"}',
        response_status: 200,
        response_body: '{"taskId":"task-b","bucket":"B"}',
        created_at: '2026-02-10 03:02:00',
      },
      {
        id: 'run-d',
        parent_request_id: 'om_continue',
        channel: 'feishu',
        sender_id: 'ou_1',
        status: 'completed',
        request_path: '/api/offers/123/generate-creatives-queue',
        request_body_json: '{"bucket":"D"}',
        response_status: 200,
        response_body: '{"taskId":"task-d","bucket":"D"}',
        created_at: '2026-02-10 03:07:00',
      },
      {
        id: 'run-publish',
        parent_request_id: 'om_continue',
        channel: 'feishu',
        sender_id: 'ou_1',
        status: 'completed',
        request_path: '/api/campaigns/publish',
        request_body_json: '{"offerId":123,"adCreativeId":999}',
        response_status: 202,
        response_body: '{"campaigns":[{"id":501,"creationStatus":"pending"}]}',
        created_at: '2026-02-10 03:09:00',
      },
    ]

    const db = {
      type: 'sqlite',
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_feishu_chat_health_logs') && sql.includes('GROUP BY decision')) {
          return [{ decision: 'allowed', total: 2 }]
        }
        if (sql.includes('FROM openclaw_feishu_chat_health_logs')) {
          return logs
        }
        if (sql.includes('parent_request_id IN')) {
          return runs
        }
        if (sql.includes('sender_id IN') && sql.includes('ORDER BY created_at ASC')) {
          return runs
        }
        if (sql.includes('FROM creative_tasks')) {
          return [
            {
              id: 'task-a',
              offer_id: 123,
              status: 'completed',
              stage: 'complete',
              progress: 100,
              message: 'ok',
              completed_at: '2026-02-10 03:01:30',
              updated_at: '2026-02-10 03:01:30',
            },
            {
              id: 'task-b',
              offer_id: 123,
              status: 'completed',
              stage: 'complete',
              progress: 100,
              message: 'ok',
              completed_at: '2026-02-10 03:02:30',
              updated_at: '2026-02-10 03:02:30',
            },
            {
              id: 'task-d',
              offer_id: 123,
              status: 'completed',
              stage: 'complete',
              progress: 100,
              message: 'ok',
              completed_at: '2026-02-10 03:07:30',
              updated_at: '2026-02-10 03:07:30',
            },
          ]
        }
        if (sql.includes('FROM campaigns')) {
          return [
            {
              id: 501,
              offer_id: 123,
              ad_creative_id: 999,
              creation_status: 'synced',
              creation_error: null,
              status: 'ENABLED',
              is_deleted: 0,
              created_at: '2026-02-10 03:09:30',
              updated_at: '2026-02-10 03:10:00',
              published_at: '2026-02-10 03:10:00',
            },
          ]
        }
        return []
      }),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })
    const workflowRow = result.rows.find((row) => row.messageId === 'om_chain')
    const continueRow = result.rows.find((row) => row.messageId === 'om_continue')

    expect(workflowRow?.workflowState).toBe('completed')
    expect(workflowRow?.workflowDetail).toContain('业务链路完成')
    expect(continueRow?.workflowState).toBe('not_required')
    expect(result.stats.workflow.tracked).toBe(1)
    expect(result.stats.workflow.completed).toBe(1)

    vi.useRealTimers()
  })

  it('keeps workflow running when publish is accepted but campaign is still pending', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:15:00.000Z'))

    const db = {
      type: 'sqlite',
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_feishu_chat_health_logs') && sql.includes('GROUP BY decision')) {
          return [{ decision: 'allowed', total: 1 }]
        }
        if (sql.includes('FROM openclaw_feishu_chat_health_logs')) {
          return [
            {
              id: 41,
              user_id: 7,
              account_id: 'user-7',
              message_id: 'om_chain',
              chat_id: 'oc_1',
              chat_type: 'p2p',
              message_type: 'text',
              sender_primary_id: 'ou_1',
              sender_open_id: 'ou_1',
              sender_union_id: null,
              sender_user_id: null,
              sender_candidates_json: '["ou_1"]',
              decision: 'allowed',
              reason_code: 'reply_dispatched',
              reason_message: 'message passed access checks and entered reply pipeline',
              message_text: '生成3个创意后发布广告',
              message_text_length: 12,
              metadata_json: null,
              created_at: '2026-02-10 03:00:00',
            },
          ]
        }
        if (sql.includes('parent_request_id IN') || (sql.includes('sender_id IN') && sql.includes('ORDER BY created_at ASC'))) {
          return [
            {
              id: 'run-a',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"A"}',
              response_status: 200,
              response_body: '{"taskId":"task-a","bucket":"A"}',
              created_at: '2026-02-10 03:01:00',
            },
            {
              id: 'run-b',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"B"}',
              response_status: 200,
              response_body: '{"taskId":"task-b","bucket":"B"}',
              created_at: '2026-02-10 03:02:00',
            },
            {
              id: 'run-d',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"D"}',
              response_status: 200,
              response_body: '{"taskId":"task-d","bucket":"D"}',
              created_at: '2026-02-10 03:03:00',
            },
            {
              id: 'run-publish',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/campaigns/publish',
              request_body_json: '{"offerId":123,"adCreativeId":999}',
              response_status: 202,
              response_body: '{"campaigns":[{"id":601,"creationStatus":"pending"}]}',
              created_at: '2026-02-10 03:04:00',
            },
          ]
        }
        if (sql.includes('FROM creative_tasks')) {
          return [
            { id: 'task-a', offer_id: 123, status: 'completed', stage: 'complete', progress: 100, message: 'ok', completed_at: '2026-02-10 03:01:30', updated_at: '2026-02-10 03:01:30' },
            { id: 'task-b', offer_id: 123, status: 'completed', stage: 'complete', progress: 100, message: 'ok', completed_at: '2026-02-10 03:02:30', updated_at: '2026-02-10 03:02:30' },
            { id: 'task-d', offer_id: 123, status: 'completed', stage: 'complete', progress: 100, message: 'ok', completed_at: '2026-02-10 03:03:30', updated_at: '2026-02-10 03:03:30' },
          ]
        }
        if (sql.includes('FROM campaigns')) {
          return [
            {
              id: 601,
              offer_id: 123,
              ad_creative_id: 999,
              creation_status: 'pending',
              creation_error: null,
              status: 'PAUSED',
              is_deleted: 0,
              created_at: '2026-02-10 03:04:30',
              updated_at: '2026-02-10 03:05:00',
              published_at: null,
            },
          ]
        }
        return []
      }),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)
    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })

    expect(result.rows[0].workflowState).toBe('running')
    expect(result.rows[0].workflowDetail).toContain('发布广告')
    expect(result.stats.workflow.running).toBe(1)
    vi.useRealTimers()
  })

  it('marks workflow incomplete when publish stays pending beyond stale threshold', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T05:40:00.000Z'))

    const db = {
      type: 'sqlite',
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_feishu_chat_health_logs') && sql.includes('GROUP BY decision')) {
          return [{ decision: 'allowed', total: 1 }]
        }
        if (sql.includes('FROM openclaw_feishu_chat_health_logs')) {
          return [
            {
              id: 410,
              user_id: 7,
              account_id: 'user-7',
              message_id: 'om_chain',
              chat_id: 'oc_1',
              chat_type: 'p2p',
              message_type: 'text',
              sender_primary_id: 'ou_1',
              sender_open_id: 'ou_1',
              sender_union_id: null,
              sender_user_id: null,
              sender_candidates_json: '["ou_1"]',
              decision: 'allowed',
              reason_code: 'reply_dispatched',
              reason_message: 'message passed access checks and entered reply pipeline',
              message_text: '生成3个创意后发布广告',
              message_text_length: 12,
              metadata_json: null,
              created_at: '2026-02-10 03:00:00',
            },
          ]
        }
        if (sql.includes('parent_request_id IN') || (sql.includes('sender_id IN') && sql.includes('ORDER BY created_at ASC'))) {
          return [
            {
              id: 'run-a',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"A"}',
              response_status: 200,
              response_body: '{"taskId":"task-a","bucket":"A"}',
              created_at: '2026-02-10 03:01:00',
            },
            {
              id: 'run-b',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"B"}',
              response_status: 200,
              response_body: '{"taskId":"task-b","bucket":"B"}',
              created_at: '2026-02-10 03:02:00',
            },
            {
              id: 'run-d',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"D"}',
              response_status: 200,
              response_body: '{"taskId":"task-d","bucket":"D"}',
              created_at: '2026-02-10 03:03:00',
            },
            {
              id: 'run-publish',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/campaigns/publish',
              request_body_json: '{"offerId":123,"adCreativeId":999}',
              response_status: 202,
              response_body: '{"campaigns":[{"id":701,"creationStatus":"pending"}]}',
              created_at: '2026-02-10 03:04:00',
            },
          ]
        }
        if (sql.includes('FROM creative_tasks')) {
          return [
            { id: 'task-a', offer_id: 123, status: 'completed', stage: 'complete', progress: 100, message: 'ok', completed_at: '2026-02-10 03:01:30', updated_at: '2026-02-10 03:01:30' },
            { id: 'task-b', offer_id: 123, status: 'completed', stage: 'complete', progress: 100, message: 'ok', completed_at: '2026-02-10 03:02:30', updated_at: '2026-02-10 03:02:30' },
            { id: 'task-d', offer_id: 123, status: 'completed', stage: 'complete', progress: 100, message: 'ok', completed_at: '2026-02-10 03:03:30', updated_at: '2026-02-10 03:03:30' },
          ]
        }
        if (sql.includes('FROM campaigns')) {
          return [
            {
              id: 701,
              offer_id: 123,
              ad_creative_id: 999,
              creation_status: 'pending',
              creation_error: null,
              status: 'PAUSED',
              is_deleted: 0,
              created_at: '2026-02-10 03:04:30',
              updated_at: '2026-02-10 03:05:00',
              published_at: null,
            },
          ]
        }
        return []
      }),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)
    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 4, limit: 100 })

    expect(result.rows[0].workflowState).toBe('incomplete')
    expect(result.rows[0].workflowDetail).toContain('发布广告')
    expect(result.stats.workflow.incomplete).toBe(1)
    expect(result.stats.workflow.running).toBe(0)
    vi.useRealTimers()
  })

  it('marks workflow failed when publish command is accepted but campaign creation fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:15:00.000Z'))

    const db = {
      type: 'sqlite',
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_feishu_chat_health_logs') && sql.includes('GROUP BY decision')) {
          return [{ decision: 'allowed', total: 1 }]
        }
        if (sql.includes('FROM openclaw_feishu_chat_health_logs')) {
          return [
            {
              id: 42,
              user_id: 7,
              account_id: 'user-7',
              message_id: 'om_chain',
              chat_id: 'oc_1',
              chat_type: 'p2p',
              message_type: 'text',
              sender_primary_id: 'ou_1',
              sender_open_id: 'ou_1',
              sender_union_id: null,
              sender_user_id: null,
              sender_candidates_json: '["ou_1"]',
              decision: 'allowed',
              reason_code: 'reply_dispatched',
              reason_message: 'message passed access checks and entered reply pipeline',
              message_text: '生成3个创意后发布广告',
              message_text_length: 12,
              metadata_json: null,
              created_at: '2026-02-10 03:00:00',
            },
          ]
        }
        if (sql.includes('parent_request_id IN') || (sql.includes('sender_id IN') && sql.includes('ORDER BY created_at ASC'))) {
          return [
            {
              id: 'run-a',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"A"}',
              response_status: 200,
              response_body: '{"taskId":"task-a","bucket":"A"}',
              created_at: '2026-02-10 03:01:00',
            },
            {
              id: 'run-b',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"B"}',
              response_status: 200,
              response_body: '{"taskId":"task-b","bucket":"B"}',
              created_at: '2026-02-10 03:02:00',
            },
            {
              id: 'run-d',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/offers/123/generate-creatives-queue',
              request_body_json: '{"bucket":"D"}',
              response_status: 200,
              response_body: '{"taskId":"task-d","bucket":"D"}',
              created_at: '2026-02-10 03:03:00',
            },
            {
              id: 'run-publish',
              parent_request_id: 'om_chain',
              channel: 'feishu',
              sender_id: 'ou_1',
              status: 'completed',
              request_path: '/api/campaigns/publish',
              request_body_json: '{"offerId":123,"adCreativeId":999}',
              response_status: 202,
              response_body: '{"campaigns":[{"id":602,"creationStatus":"pending"}]}',
              created_at: '2026-02-10 03:04:00',
            },
          ]
        }
        if (sql.includes('FROM creative_tasks')) {
          return [
            { id: 'task-a', offer_id: 123, status: 'completed', stage: 'complete', progress: 100, message: 'ok', completed_at: '2026-02-10 03:01:30', updated_at: '2026-02-10 03:01:30' },
            { id: 'task-b', offer_id: 123, status: 'completed', stage: 'complete', progress: 100, message: 'ok', completed_at: '2026-02-10 03:02:30', updated_at: '2026-02-10 03:02:30' },
            { id: 'task-d', offer_id: 123, status: 'completed', stage: 'complete', progress: 100, message: 'ok', completed_at: '2026-02-10 03:03:30', updated_at: '2026-02-10 03:03:30' },
          ]
        }
        if (sql.includes('FROM campaigns')) {
          return [
            {
              id: 602,
              offer_id: 123,
              ad_creative_id: 999,
              creation_status: 'failed',
              creation_error: 'quota exceeded',
              status: 'REMOVED',
              is_deleted: 0,
              created_at: '2026-02-10 03:04:30',
              updated_at: '2026-02-10 03:05:00',
              published_at: null,
            },
          ]
        }
        return []
      }),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)
    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })

    expect(result.rows[0].workflowState).toBe('failed')
    expect(result.rows[0].workflowDetail).toContain('发布广告')
    expect(result.stats.workflow.failed).toBe(1)
    vi.useRealTimers()
  })

  it('does not link sender/time fallback to runs already bound to other message ids', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:20:00.000Z'))

    const db = {
      type: 'sqlite',
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 4,
            user_id: 7,
            account_id: 'user-7',
            message_id: 'om_target',
            chat_id: 'oc_1',
            chat_type: 'p2p',
            message_type: 'text',
            sender_primary_id: 'ou_1',
            sender_open_id: 'ou_1',
            sender_union_id: null,
            sender_user_id: null,
            sender_candidates_json: '["ou_1"]',
            decision: 'allowed',
            reason_code: 'reply_dispatched',
            reason_message: 'message passed access checks and entered reply pipeline',
            message_text: '请修复offer 123广告投放',
            message_text_length: 17,
            metadata_json: null,
            created_at: '2026-02-10 03:00:00',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { decision: 'allowed', total: 1 },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'run-bound-other',
            parent_request_id: 'om_other_message',
            channel: 'feishu',
            sender_id: 'ou_1',
            status: 'failed',
            created_at: '2026-02-10 03:00:10',
          },
        ]),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })

    expect(result.rows[0].executionRunCount).toBe(0)
    expect(result.rows[0].executionRunId).toBeNull()
    expect(result.rows[0].executionState).toBe('missing')
    expect(result.stats.execution.missing).toBe(1)
    expect(result.stats.execution.failed).toBe(0)

    vi.useRealTimers()
  })

  it('backfills long-running feishu runs without crossing previous allowed message boundary', async () => {
    const db = {
      type: 'sqlite',
      queryOne: vi
        .fn()
        .mockResolvedValueOnce({
          created_at: '2026-02-10 03:11:17',
        })
        .mockResolvedValueOnce({
          created_at: '2026-02-10 02:59:59',
        }),
      query: vi.fn().mockResolvedValueOnce([
        {
          id: 'run-late',
          parent_request_id: 'uuid-late',
          channel: 'feishu',
          sender_id: 'ou_1',
          status: 'completed',
          created_at: '2026-02-10 03:17:00',
        },
        {
          id: 'run-2',
          parent_request_id: null,
          channel: 'feishu',
          sender_id: 'ou_1',
          status: 'completed',
          created_at: '2026-02-10 03:10:00',
        },
        {
          id: 'run-bound-other',
          parent_request_id: 'om_other_message',
          channel: 'feishu',
          sender_id: 'ou_1',
          status: 'failed',
          created_at: '2026-02-10 03:09:00',
        },
        {
          id: 'run-1',
          parent_request_id: 'uuid-1',
          channel: 'feishu',
          sender_id: 'ou_1',
          status: 'queued',
          created_at: '2026-02-10 03:01:00',
        },
        {
          id: 'run-prev-boundary',
          parent_request_id: 'uuid-prev',
          channel: 'feishu',
          sender_id: 'ou_1',
          status: 'completed',
          created_at: '2026-02-10 02:59:59',
        },
      ]),
      exec: vi.fn().mockResolvedValue({ changes: 2 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await backfillFeishuChatHealthRunLinks({
      userId: 7,
      messageId: 'om_target',
      senderIds: ['ou_1', 'ou_1'],
    })

    expect(result).toEqual({ updatedRuns: 2 })
    expect(db.exec).toHaveBeenCalledTimes(1)

    const execArgs = db.exec.mock.calls[0]?.[1] as any[]
    expect(execArgs[0]).toBe('om_target')
    expect(execArgs[1]).toBe(7)
    expect(execArgs.slice(2)).toHaveLength(2)
    expect(execArgs.slice(2)).toEqual(expect.arrayContaining(['run-1', 'run-2']))
  })

  it('records logs with deduplicated sender candidates', async () => {
    const longText = 'x'.repeat(21_000)
    const db = {
      type: 'sqlite',
      query: vi.fn().mockResolvedValue([]),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    await recordFeishuChatHealthLog({
      userId: 7,
      accountId: 'user-7',
      messageId: 'om_1',
      chatId: 'oc_1',
      chatType: 'group',
      messageType: 'text',
      senderPrimaryId: 'ou_1',
      senderOpenId: 'ou_1',
      senderUnionId: 'on_1',
      senderUserId: null,
      senderCandidates: ['ou_1', 'ou_1', 'on_1', ''],
      decision: 'blocked',
      reasonCode: 'group_require_mention',
      reasonMessage: 'group requires @mention',
      messageText: longText,
      metadata: { source: 'test' },
    })

    expect(db.exec).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO openclaw_feishu_chat_health_logs'),
      expect.any(Array)
    )

    const insertedArgs = db.exec.mock.calls[0][1] as any[]
    expect(JSON.parse(insertedArgs[10])).toEqual(['ou_1', 'on_1'])
    expect(insertedArgs[11]).toBe('blocked')
    expect(String(insertedArgs[14]).length).toBe(20_000)
    expect(insertedArgs[15]).toBe(20_000)
  })
})
