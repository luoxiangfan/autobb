import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/creative-tasks/[taskId]/stream/route'

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>()
  return {
    ...actual,
    getDatabase: dbFns.getDatabase,
  }
})

const runningTask = {
  id: 'task-stream-1',
  user_id: 7,
  status: 'running' as const,
  stage: 'generating',
  progress: 30,
  message: '生成中',
  current_attempt: 1,
  max_retries: 1,
  generation_mode: 'fast',
  result: null,
  error: null,
  updated_at: '2026-03-20T10:00:00.000Z',
}

describe('GET /api/creative-tasks/[taskId]/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    dbFns.getDatabase.mockReturnValue({
      query: dbFns.query,
    })
    dbFns.query.mockResolvedValue([runningTask])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('scopes poll queries to the authenticated user', async () => {
    const req = new NextRequest('http://localhost/api/creative-tasks/task-stream-1/stream', {
      headers: { 'x-user-id': '7' },
    })

    const res = await GET(req, { params: Promise.resolve({ taskId: 'task-stream-1' }) })
    expect(res.status).toBe(200)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const pollCalls = dbFns.query.mock.calls.filter(
      (call) => String(call[0]).includes('creative_tasks') && String(call[0]).includes('user_id')
    )
    expect(pollCalls.length).toBeGreaterThan(0)
    expect(pollCalls[0][1]).toEqual(['task-stream-1', 7])

    const reader = res.body?.getReader()
    if (reader) {
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      expect(text).toContain('"generationMode":"fast"')
      await reader.cancel()
    }
  })
})
