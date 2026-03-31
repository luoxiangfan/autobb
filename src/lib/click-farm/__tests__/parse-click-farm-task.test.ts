import { describe, it, expect } from 'vitest'
import { parseClickFarmTask } from '../../click-farm'

describe('parseClickFarmTask', () => {
  it('normalizes DATE/TIMESTAMP fields to strings', () => {
    const row = {
      id: 'task-1',
      user_id: 7,
      offer_id: 633,
      daily_click_count: 50,
      start_time: '06:00:00',
      end_time: '24:00:00',
      duration_days: -1,
      scheduled_start_date: new Date('2026-01-15T00:00:00.000Z'),
      hourly_distribution: '[0,0,0,0,0,0,1,1,2,2,2,3,3,3,2,2,2,2,3,3,7,5,4,3]',
      status: 'running',
      pause_reason: null,
      pause_message: null,
      paused_at: null,
      progress: 0,
      total_clicks: 0,
      success_clicks: 0,
      failed_clicks: 0,
      daily_history: '[]',
      timezone: 'America/New_York',
      referer_config: '{"type":"specific","referer":"https://www.instagram.com/"}',
      is_deleted: false,
      deleted_at: null,
      started_at: new Date('2026-01-16T03:00:04.829Z'),
      completed_at: null,
      next_run_at: new Date('2026-01-17T04:00:00.000Z'),
      created_at: new Date('2026-01-15T23:00:51.208Z'),
      updated_at: new Date('2026-01-17T03:26:49.053Z'),
    }

    const task = parseClickFarmTask(row)

    expect(task.scheduled_start_date).toBe('2026-01-15')
    expect(task.started_at).toBe('2026-01-16T03:00:04.829Z')
    expect(task.next_run_at).toBe('2026-01-17T04:00:00.000Z')
    expect(task.created_at).toBe('2026-01-15T23:00:51.208Z')
    expect(task.updated_at).toBe('2026-01-17T03:26:49.053Z')
  })

  it('treats SQLite datetime strings as UTC when normalizing', () => {
    const row = {
      id: 'task-2',
      user_id: 1,
      offer_id: 1,
      daily_click_count: 50,
      start_time: '06:00',
      end_time: '24:00',
      duration_days: 7,
      scheduled_start_date: '2026-01-15',
      hourly_distribution: '[0,0,0,0,0,0,1,1,2,2,2,3,3,3,2,2,2,2,3,3,7,5,4,3]',
      status: 'running',
      pause_reason: null,
      pause_message: null,
      paused_at: '2026-01-16 03:00:04',
      progress: 0,
      total_clicks: 0,
      success_clicks: 0,
      failed_clicks: 0,
      daily_history: '[]',
      timezone: 'America/New_York',
      referer_config: null,
      is_deleted: 0,
      deleted_at: null,
      started_at: '2026-01-16 03:00:04.829538',
      completed_at: null,
      next_run_at: '2026-01-17 04:00:00',
      created_at: '2026-01-15 23:00:51',
      updated_at: '2026-01-17 03:26:49.053062',
    }

    const task = parseClickFarmTask(row)

    expect(task.paused_at).toBe('2026-01-16T03:00:04.000Z')
    expect(task.started_at).toBe('2026-01-16T03:00:04.829Z')
    expect(task.next_run_at).toBe('2026-01-17T04:00:00.000Z')
    expect(task.updated_at).toBe('2026-01-17T03:26:49.053Z')
  })
})

