import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/creative-tasks/[taskId]/route'

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

describe('GET /api/creative-tasks/[taskId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    dbFns.getDatabase.mockReturnValue({
      query: dbFns.query,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns normalized structured error fields for failed task payloads', async () => {
    dbFns.query.mockResolvedValueOnce([
      {
        id: 'task-1',
        user_id: 1,
        status: 'failed',
        stage: 'generating',
        progress: 88,
        message: '关键词池创建失败',
        result: null,
        error: JSON.stringify({ message: '关键词池创建失败' }),
        created_at: '2026-03-20T10:00:00.000Z',
        updated_at: '2026-03-20T10:01:00.000Z',
        started_at: '2026-03-20T10:00:05.000Z',
        completed_at: '2026-03-20T10:01:00.000Z',
      },
    ])

    const req = new NextRequest('http://localhost/api/creative-tasks/task-1', {
      headers: {
        'x-user-id': '1',
      },
    })

    const res = await GET(req, { params: { taskId: 'task-1' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.status).toBe('failed')
    expect(data.errorCode).toBe('CREATIVE_KEYWORD_POOL_BUILD_FAILED')
    expect(data.errorCategory).toBe('upstream')
    expect(data.errorRetryable).toBe(true)
    expect(data.errorUserMessage).toContain('关键词池创建失败')
    expect(data.structuredError).toMatchObject({
      code: 'CREATIVE_KEYWORD_POOL_BUILD_FAILED',
      category: 'upstream',
      retryable: true,
    })
  })

  it('keeps structured error fields null when task is not failed', async () => {
    dbFns.query.mockResolvedValueOnce([
      {
        id: 'task-2',
        user_id: 1,
        status: 'running',
        stage: 'generating',
        progress: 42,
        message: '处理中',
        result: null,
        error: null,
        created_at: '2026-03-20T10:00:00.000Z',
        updated_at: '2026-03-20T10:00:20.000Z',
        started_at: '2026-03-20T10:00:05.000Z',
        completed_at: null,
      },
    ])

    const req = new NextRequest('http://localhost/api/creative-tasks/task-2', {
      headers: {
        'x-user-id': '1',
      },
    })

    const res = await GET(req, { params: { taskId: 'task-2' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.status).toBe('running')
    expect(data.error).toBeNull()
    expect(data.errorDetails).toBeNull()
    expect(data.errorCode).toBeNull()
    expect(data.errorCategory).toBeNull()
    expect(data.errorUserMessage).toBeNull()
    expect(data.errorRetryable).toBeNull()
    expect(data.structuredError).toBeNull()
  })
})
