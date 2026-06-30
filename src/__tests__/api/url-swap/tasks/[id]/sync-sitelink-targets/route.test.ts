import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authUser = {
  userId: 1,
  email: 'test@example.com',
  role: 'user',
  packageType: 'pro',
}

const urlSwapFns = vi.hoisted(() => ({
  getUrlSwapTaskById: vi.fn(async () => ({ id: 'us-task-1', user_id: 1, offer_id: 10 })),
}))

const syncJobFns = vi.hoisted(() => ({
  executeUrlSwapSitelinkTargetsSyncJob: vi.fn(async () => {}),
}))

const asyncStateFns = vi.hoisted(() => ({
  tryStartUrlSwapSitelinkSync: vi.fn(async () => ({ started: true, alreadyRunning: false })),
  getUrlSwapSitelinkSyncState: vi.fn(async () => null),
}))

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: any) => {
    return async (
      request: NextRequest,
      routeContext?: { params?: Promise<Record<string, string>> }
    ) => {
      const resolvedParams = routeContext?.params ? await routeContext.params : undefined
      const context = resolvedParams ? { params: resolvedParams } : undefined
      return handler(request, authUser, context)
    }
  },
}))

vi.mock('@/lib/url-swap', () => ({
  getUrlSwapTaskById: urlSwapFns.getUrlSwapTaskById,
}))

vi.mock('@/lib/url-swap/run-sitelink-targets-sync', () => ({
  executeUrlSwapSitelinkTargetsSyncJob: syncJobFns.executeUrlSwapSitelinkTargetsSyncJob,
}))

vi.mock('@/lib/url-swap/sitelink-sync-async-state', () => ({
  tryStartUrlSwapSitelinkSync: asyncStateFns.tryStartUrlSwapSitelinkSync,
  getUrlSwapSitelinkSyncState: asyncStateFns.getUrlSwapSitelinkSyncState,
}))

import { GET, POST } from '@/app/api/url-swap/tasks/[id]/sync-sitelink-targets/route'

describe('POST /api/url-swap/tasks/[id]/sync-sitelink-targets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    urlSwapFns.getUrlSwapTaskById.mockResolvedValue({
      id: 'us-task-1',
      user_id: 1,
      offer_id: 10,
    })
    asyncStateFns.tryStartUrlSwapSitelinkSync.mockResolvedValue({
      started: true,
      alreadyRunning: false,
    })
  })

  it('returns 202 and starts background sync job', async () => {
    const req = new NextRequest(
      'http://localhost/api/url-swap/tasks/us-task-1/sync-sitelink-targets',
      { method: 'POST' }
    )

    const res = await POST(req, { params: Promise.resolve({ id: 'us-task-1' }) })
    const data = await res.json()

    expect(res.status).toBe(202)
    expect(data.status).toBe('running')
    expect(data.async).toBe(true)
    expect(syncJobFns.executeUrlSwapSitelinkTargetsSyncJob).toHaveBeenCalledWith({
      taskId: 'us-task-1',
      offerId: 10,
      userId: 1,
    })
  })

  it('returns 202 when sync is already running', async () => {
    asyncStateFns.tryStartUrlSwapSitelinkSync.mockResolvedValue({
      started: false,
      alreadyRunning: true,
    })

    const req = new NextRequest(
      'http://localhost/api/url-swap/tasks/us-task-1/sync-sitelink-targets',
      { method: 'POST' }
    )

    const res = await POST(req, { params: Promise.resolve({ id: 'us-task-1' }) })
    const data = await res.json()

    expect(res.status).toBe(202)
    expect(data.status).toBe('running')
    expect(data.already_running).toBe(true)
    expect(syncJobFns.executeUrlSwapSitelinkTargetsSyncJob).not.toHaveBeenCalled()
  })
})

describe('GET /api/url-swap/tasks/[id]/sync-sitelink-targets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    urlSwapFns.getUrlSwapTaskById.mockResolvedValue({
      id: 'us-task-1',
      user_id: 1,
      offer_id: 10,
    })
  })

  it('returns completed sync result when available', async () => {
    asyncStateFns.getUrlSwapSitelinkSyncState.mockResolvedValue({
      status: 'completed',
      startedAtMs: Date.now() - 1000,
      updatedAtMs: Date.now(),
      result: {
        success: true,
        sitelink_targets: [{ id: 'st-1' }],
        sitelink_sync: { upserted: 1, skipped: false, errors: [] },
        message: '已同步 1 条 Sitelink 映射',
      },
    })

    const req = new NextRequest(
      'http://localhost/api/url-swap/tasks/us-task-1/sync-sitelink-targets'
    )
    const res = await GET(req, { params: Promise.resolve({ id: 'us-task-1' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.status).toBe('completed')
    expect(data.sitelink_targets).toHaveLength(1)
  })
})
