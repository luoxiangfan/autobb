import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbRef = vi.hoisted(() => ({
  current: null as any,
}))

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return value as T
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return fallback
  try {
    let parsed: unknown = JSON.parse(trimmed)
    for (let i = 0; i < 2; i += 1) {
      if (typeof parsed !== 'string') break
      const nested = parsed.trim()
      if (!nested || nested === 'null' || nested === 'undefined') break
      parsed = JSON.parse(nested)
    }
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbRef.current),
  parseJsonField,
}))

describe('url-swap json parsing compatibility', () => {
  beforeEach(() => {
    dbRef.current = {
      queryOne: vi.fn(),
    }
  })

  it('parses double-encoded swap_history/manual_affiliate_links', async () => {
    const { getUrlSwapTaskById } = await import('@/lib/url-swap')
    const history = [
      {
        swapped_at: '2026-02-20T00:00:00.000Z',
        success: true,
        previous_final_url: 'https://a.example.com',
        new_final_url: 'https://b.example.com',
      },
    ]
    const links = ['https://affiliate.example.com/?a=1']

    dbRef.current.queryOne.mockResolvedValueOnce({
      id: 'task-1',
      user_id: 1,
      offer_id: 448,
      swap_interval_minutes: 30,
      enabled: true,
      duration_days: 30,
      swap_mode: 'manual',
      manual_affiliate_links: JSON.stringify(JSON.stringify(links)),
      manual_suffix_cursor: 0,
      google_customer_id: '123',
      google_campaign_id: '456',
      current_final_url: 'https://a.example.com',
      current_final_url_suffix: null,
      progress: 0,
      total_swaps: 1,
      success_swaps: 1,
      failed_swaps: 0,
      url_changed_count: 1,
      consecutive_failures: 0,
      swap_history: JSON.stringify(JSON.stringify(history)),
      status: 'enabled',
      error_message: null,
      error_at: null,
      started_at: '2026-02-19T00:00:00.000Z',
      completed_at: null,
      next_swap_at: '2026-02-20T01:00:00.000Z',
      is_deleted: false,
      deleted_at: null,
      created_at: '2026-02-19T00:00:00.000Z',
      updated_at: '2026-02-20T00:00:00.000Z',
    })

    const task = await getUrlSwapTaskById('task-1', 1)

    expect(task?.manual_affiliate_links).toEqual(links)
    expect(Array.isArray(task?.swap_history)).toBe(true)
    expect(task?.swap_history).toHaveLength(1)
    expect(task?.swap_history[0].new_final_url).toBe('https://b.example.com')
  })
})
