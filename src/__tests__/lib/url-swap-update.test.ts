/**
 * Url Swap updateUrlSwapTask 行为测试
 * src/__tests__/lib/url-swap-update.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const dbRef = vi.hoisted(() => ({
  current: null as any,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbRef.current),
  parseJsonField: (value: unknown, fallback: unknown) => {
    if (value === null || value === undefined) return fallback
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return fallback
      }
    }
    return value ?? fallback
  },
  toDbJsonObjectField: (value: unknown) => JSON.stringify(value ?? {}),
}))

vi.mock('@/lib/common/task-scheduling', () => ({
  filterRowsByUserPackageExpiry: vi.fn(async (rows: unknown[]) => rows),
}))

function makeTaskRow(overrides: Record<string, any> = {}) {
  return {
    id: 'task-1',
    user_id: 1,
    offer_id: 448,
    swap_interval_minutes: 60,
    enabled: 1,
    duration_days: 7,
    google_customer_id: 'cust-old',
    google_campaign_id: 'camp-old',
    current_final_url: null,
    current_final_url_suffix: null,
    progress: 0,
    total_swaps: 0,
    success_swaps: 0,
    failed_swaps: 0,
    url_changed_count: 0,
    swap_history: '[]',
    status: 'enabled',
    error_message: null,
    error_at: null,
    started_at: '2026-01-07T00:00:00.000Z',
    completed_at: null,
    next_swap_at: '2026-01-08T00:00:00.000Z',
    is_deleted: 0,
    deleted_at: null,
    created_at: '2026-01-07T00:00:00.000Z',
    updated_at: '2026-01-07T00:00:00.000Z',
    consecutive_failures: 0,
    ...overrides,
  }
}

describe('updateUrlSwapTask', () => {
  let updateUrlSwapTask: typeof import('@/lib/url-swap').updateUrlSwapTask

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-08T00:00:00.000Z'))

    dbRef.current = {
      queryOne: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      transaction: async (fn: any) => await fn(),
      close: vi.fn(),
    }
  })

  beforeEach(async () => {
    vi.resetModules()
    ;({ updateUrlSwapTask } = await import('@/lib/url-swap'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('编辑 error 任务会清理错误并恢复为 enabled，同时更新 Google IDs', async () => {
    dbRef.current.queryOne
      .mockResolvedValueOnce(
        makeTaskRow({
          status: 'error',
          consecutive_failures: 2,
          error_message: 'boom',
          error_at: '2026-01-07T12:00:00.000Z',
        })
      )
      .mockResolvedValueOnce(
        makeTaskRow({
          status: 'enabled',
          swap_interval_minutes: 30,
          duration_days: 14,
          google_customer_id: 'cust-new',
          google_campaign_id: 'camp-new',
          consecutive_failures: 0,
          error_message: null,
          error_at: null,
          next_swap_at: '2026-01-08T00:00:00.000Z',
        })
      )

    const updated = await updateUrlSwapTask('task-1', 1, {
      swap_interval_minutes: 30,
      duration_days: 14,
      google_customer_id: 'cust-new',
      google_campaign_id: 'camp-new',
    })

    expect(updated.status).toBe('enabled')
    expect(updated.consecutive_failures).toBe(0)
    expect(updated.error_message).toBe(null)
    expect(updated.error_at).toBe(null)
    expect(updated.google_customer_id).toBe('cust-new')
    expect(updated.google_campaign_id).toBe('camp-new')

    expect(dbRef.current.exec).toHaveBeenCalledTimes(1)
    const [sql, params] = dbRef.current.exec.mock.calls[0]
    expect(sql).toContain('UPDATE url_swap_tasks')
    expect(sql).toContain('status = ?')
    expect(sql).toContain('error_message = NULL')
    expect(sql).toContain('error_at = NULL')
    expect(params).toEqual(
      expect.arrayContaining([30, 14, 'cust-new', 'camp-new', 'enabled', 'task-1', 1])
    )
  })

  it('编辑非 error 任务不会隐式修改 status/error 字段', async () => {
    dbRef.current.queryOne
      .mockResolvedValueOnce(makeTaskRow({ status: 'enabled' }))
      .mockResolvedValueOnce(
        makeTaskRow({
          swap_interval_minutes: 30,
          duration_days: 10,
        })
      )

    const updated = await updateUrlSwapTask('task-1', 1, {
      swap_interval_minutes: 30,
      duration_days: 10,
    })

    expect(updated.status).toBe('enabled')
    expect(updated.swap_interval_minutes).toBe(30)
    expect(updated.duration_days).toBe(10)

    const [sql] = dbRef.current.exec.mock.calls[0]
    expect(sql).not.toContain('error_message = NULL')
    expect(sql).not.toContain('error_at = NULL')
  })
})
