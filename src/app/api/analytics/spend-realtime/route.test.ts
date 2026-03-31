import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/analytics/spend-realtime/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

const queueFns = vi.hoisted(() => ({
  triggerDataSync: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    queryOne: dbFns.queryOne,
  })),
}))

vi.mock('@/lib/queue-triggers', () => ({
  triggerDataSync: queueFns.triggerDataSync,
}))

describe('GET /api/analytics/spend-realtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 42 },
    })

    queueFns.triggerDataSync.mockResolvedValue('sync-task-1')

    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 9,
          customer_id: '123-456-7890',
          currency: 'USD',
          timezone: 'UTC',
          last_sync_at: new Date().toISOString(),
        }
      }

      if (sql.includes('FROM campaign_performance')) {
        return {
          spend: 12.34,
          clicks: 56,
          impressions: 789,
          conversions: 3,
          campaign_count: 2,
        }
      }

      if (sql.includes("FROM campaigns") && sql.includes("ENABLED")) {
        return { count: 1 }
      }

      if (sql.includes('FROM sync_logs')) {
        return {
          status: 'success',
          started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          completed_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
          error_message: null,
          created_at: new Date().toISOString(),
        }
      }

      return null
    })
  })

  it('returns 401 when unauthorized', async () => {
    authFns.verifyAuth.mockResolvedValue({ authenticated: false, user: null })

    const req = new NextRequest('http://localhost/api/analytics/spend-realtime?accountId=9')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('returns realtime spend summary', async () => {
    const req = new NextRequest('http://localhost/api/analytics/spend-realtime?accountId=9')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.accountId).toBe(9)
    expect(data.data.spend).toBe(12.34)
    expect(data.data.latestSync.isStale).toBe(false)
    expect(data.data.syncTriggered).toBe(false)
  })

  it('triggers sync when stale and syncIfStale=true', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 9,
          customer_id: '123-456-7890',
          currency: 'USD',
          timezone: 'UTC',
          last_sync_at: null,
        }
      }

      if (sql.includes('FROM campaign_performance')) {
        return {
          spend: 6,
          clicks: 10,
          impressions: 100,
          conversions: 1,
          campaign_count: 1,
        }
      }

      if (sql.includes("FROM campaigns") && sql.includes("ENABLED")) {
        return { count: 1 }
      }

      if (sql.includes('FROM sync_logs')) {
        return {
          status: 'success',
          started_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
          completed_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          error_message: null,
          created_at: new Date().toISOString(),
        }
      }

      return null
    })

    const req = new NextRequest('http://localhost/api/analytics/spend-realtime?accountId=9&syncIfStale=true&staleMinutes=30')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.data.latestSync.isStale).toBe(true)
    expect(data.data.syncTriggered).toBe(true)
    expect(data.data.syncTaskId).toBe('sync-task-1')
    expect(queueFns.triggerDataSync).toHaveBeenCalledWith(42, expect.objectContaining({
      googleAdsAccountId: 9,
      syncType: 'manual',
    }))
  })
})
