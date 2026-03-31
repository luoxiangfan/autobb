import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  checkAffiliatePlatformConfig: vi.fn(),
  createAffiliateProductSyncRun: vi.fn(),
  getLatestFailedAffiliateProductSyncRun: vi.fn(),
  runAffiliateProductsRawJsonRetirementMaintenance: vi.fn(),
  updateAffiliateProductSyncRun: vi.fn(),
  getQueueManagerForTaskType: vi.fn(),
  isYeahPromosManualSyncOnly: vi.fn(),
}))

vi.mock('../../db', () => ({
  getDatabase: mocks.getDatabase,
}))

vi.mock('../../affiliate-products', () => ({
  checkAffiliatePlatformConfig: mocks.checkAffiliatePlatformConfig,
  createAffiliateProductSyncRun: mocks.createAffiliateProductSyncRun,
  getLatestFailedAffiliateProductSyncRun: mocks.getLatestFailedAffiliateProductSyncRun,
  runAffiliateProductsRawJsonRetirementMaintenance: mocks.runAffiliateProductsRawJsonRetirementMaintenance,
  updateAffiliateProductSyncRun: mocks.updateAffiliateProductSyncRun,
}))

vi.mock('../queue-routing', () => ({
  getQueueManagerForTaskType: mocks.getQueueManagerForTaskType,
}))

vi.mock('../../yeahpromos-session', () => ({
  isYeahPromosManualSyncOnly: mocks.isYeahPromosManualSyncOnly,
}))

import { AffiliateProductSyncScheduler } from './affiliate-product-sync-scheduler'

describe('AffiliateProductSyncScheduler YP support', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDatabase.mockResolvedValue({
      type: 'postgres',
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
    })
    mocks.checkAffiliatePlatformConfig.mockResolvedValue({
      configured: false,
      missingKeys: [],
      values: {},
    })
    mocks.runAffiliateProductsRawJsonRetirementMaintenance.mockResolvedValue(undefined)
    mocks.getLatestFailedAffiliateProductSyncRun.mockResolvedValue(null)
    mocks.isYeahPromosManualSyncOnly.mockResolvedValue(false)
  })

  it('schedules YP full sync when PB is not configured and YP is configured', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any

    vi.spyOn(scheduler, 'hasActiveSyncRun').mockResolvedValue(false)
    vi.spyOn(scheduler, 'enqueueSyncTask').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'upsertUserSystemSetting').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'loadYeahpromosScheduleConfig').mockResolvedValue({
      deltaIntervalMinutes: 360,
      fullIntervalHours: 24,
      lastDeltaAt: null,
      lastFullAt: null,
    })
    vi.spyOn(scheduler, 'loadLatestCompletedRunTimesByPlatform').mockResolvedValue({
      lastDeltaAt: null,
      lastFullAt: null,
    })

    mocks.checkAffiliatePlatformConfig.mockImplementation(async (_userId: number, platform: string) => {
      if (platform === 'partnerboost') {
        return {
          configured: false,
          missingKeys: ['partnerboost_token'],
          values: {},
        }
      }
      return {
        configured: true,
        missingKeys: [],
        values: {
          yeahpromos_token: 'token',
          yeahpromos_site_id: 'site',
        },
      }
    })

    const queued = await scheduler.scheduleForUser(1, new Date('2026-02-24T00:00:00.000Z'))

    expect(queued).toBe(true)
    expect(scheduler.enqueueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        platform: 'yeahpromos',
        mode: 'platform',
      })
    )
    expect(scheduler.upsertUserSystemSetting).toHaveBeenCalledWith(
      1,
      'affiliate_yp_last_full_sync_at',
      expect.any(String)
    )
  })

  it('keeps PB scheduling priority when PB is due', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any

    vi.spyOn(scheduler, 'hasActiveSyncRun').mockResolvedValue(false)
    vi.spyOn(scheduler, 'enqueueSyncTask').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'upsertUserSystemSetting').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'loadUserScheduleConfig').mockResolvedValue({
      deltaIntervalMinutes: 360,
      fullIntervalHours: 24,
      lastDeltaAt: null,
      lastFullAt: null,
    })
    vi.spyOn(scheduler, 'loadLatestCompletedRunTimes').mockResolvedValue({
      lastDeltaAt: null,
      lastFullAt: null,
    })
    const ypConfigSpy = vi.spyOn(scheduler, 'loadYeahpromosScheduleConfig')

    mocks.checkAffiliatePlatformConfig.mockResolvedValue({
      configured: true,
      missingKeys: [],
      values: {},
    })

    const queued = await scheduler.scheduleForUser(2, new Date('2026-02-24T00:00:00.000Z'))

    expect(queued).toBe(true)
    expect(scheduler.enqueueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 2,
        platform: 'partnerboost',
        mode: 'platform',
      })
    )
    expect(scheduler.upsertUserSystemSetting).toHaveBeenCalledWith(
      2,
      'affiliate_pb_last_full_sync_at',
      expect.any(String)
    )
    expect(ypConfigSpy).not.toHaveBeenCalled()
  })

  it('schedules YP delta when full is not due but delta is due', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any

    vi.spyOn(scheduler, 'hasActiveSyncRun').mockResolvedValue(false)
    vi.spyOn(scheduler, 'enqueueSyncTask').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'upsertUserSystemSetting').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'loadYeahpromosScheduleConfig').mockResolvedValue({
      deltaIntervalMinutes: 360,
      fullIntervalHours: 24,
      lastDeltaAt: new Date('2026-02-22T00:00:00.000Z'),
      lastFullAt: new Date('2026-02-23T20:00:00.000Z'),
    })
    vi.spyOn(scheduler, 'loadLatestCompletedRunTimesByPlatform').mockResolvedValue({
      lastDeltaAt: null,
      lastFullAt: null,
    })

    mocks.checkAffiliatePlatformConfig.mockImplementation(async (_userId: number, platform: string) => {
      if (platform === 'partnerboost') {
        return {
          configured: false,
          missingKeys: ['partnerboost_token'],
          values: {},
        }
      }
      return {
        configured: true,
        missingKeys: [],
        values: {
          yeahpromos_token: 'token',
          yeahpromos_site_id: 'site',
        },
      }
    })

    const queued = await scheduler.scheduleForUser(9, new Date('2026-02-24T00:00:00.000Z'))

    expect(queued).toBe(true)
    expect(scheduler.enqueueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 9,
        platform: 'yeahpromos',
        mode: 'delta',
      })
    )
    expect(scheduler.upsertUserSystemSetting).toHaveBeenCalledWith(
      9,
      'affiliate_yp_last_delta_sync_at',
      expect.any(String)
    )
  })

  it('skips YP scheduling when manual-only is enabled', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any

    vi.spyOn(scheduler, 'hasActiveSyncRun').mockResolvedValue(false)
    vi.spyOn(scheduler, 'enqueueSyncTask').mockResolvedValue(undefined)
    mocks.isYeahPromosManualSyncOnly.mockResolvedValue(true)

    mocks.checkAffiliatePlatformConfig.mockResolvedValue({
      configured: false,
      missingKeys: ['partnerboost_token'],
      values: {},
    })

    const queued = await scheduler.scheduleForUser(11, new Date('2026-02-24T00:00:00.000Z'))

    expect(queued).toBe(false)
    expect(scheduler.enqueueSyncTask).not.toHaveBeenCalled()
  })

  it('does not let YP active run block PB scheduling', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any
    vi.spyOn(scheduler, 'hasActiveSyncRun').mockImplementation(async (...args: unknown[]) => {
      return args[1] === 'yeahpromos'
    })
    vi.spyOn(scheduler, 'enqueueSyncTask').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'upsertUserSystemSetting').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'loadUserScheduleConfig').mockResolvedValue({
      deltaIntervalMinutes: 360,
      fullIntervalHours: 24,
      lastDeltaAt: null,
      lastFullAt: null,
    })
    vi.spyOn(scheduler, 'loadLatestCompletedRunTimes').mockResolvedValue({
      lastDeltaAt: null,
      lastFullAt: null,
    })

    mocks.checkAffiliatePlatformConfig.mockImplementation(async (_userId: number, platform: string) => {
      if (platform === 'partnerboost') {
        return {
          configured: true,
          missingKeys: [],
          values: { partnerboost_token: 'token' },
        }
      }
      return {
        configured: false,
        missingKeys: ['yeahpromos_token', 'yeahpromos_site_id'],
        values: {},
      }
    })

    const queued = await scheduler.scheduleForUser(3, new Date('2026-02-24T00:00:00.000Z'))

    expect(queued).toBe(true)
    expect(scheduler.enqueueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        platform: 'partnerboost',
      })
    )
  })

  it('skips PB scheduling when PB has active run and YP is not eligible', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any
    vi.spyOn(scheduler, 'hasActiveSyncRun').mockImplementation(async (...args: unknown[]) => {
      return args[1] === 'partnerboost'
    })
    vi.spyOn(scheduler, 'enqueueSyncTask').mockResolvedValue(undefined)

    mocks.checkAffiliatePlatformConfig.mockImplementation(async (_userId: number, platform: string) => {
      if (platform === 'partnerboost') {
        return {
          configured: true,
          missingKeys: [],
          values: { partnerboost_token: 'token' },
        }
      }
      return {
        configured: false,
        missingKeys: ['yeahpromos_token', 'yeahpromos_site_id'],
        values: {},
      }
    })

    const queued = await scheduler.scheduleForUser(13, new Date('2026-02-24T00:00:00.000Z'))

    expect(queued).toBe(false)
    expect(scheduler.enqueueSyncTask).not.toHaveBeenCalled()
  })

  it('uses default PB delta interval when platform-specific interval is absent', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any

    const dbQueryMock = vi.fn().mockResolvedValue([
      { key: 'affiliate_pb_last_delta_sync_at', value: '2026-02-23T18:00:00.000Z' },
      { key: 'affiliate_pb_last_full_sync_at', value: '2026-02-24T00:00:00.000Z' },
    ])
    mocks.getDatabase.mockResolvedValue({
      type: 'postgres',
      query: dbQueryMock,
      queryOne: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
    })

    vi.spyOn(scheduler, 'hasActiveSyncRun').mockResolvedValue(false)
    vi.spyOn(scheduler, 'enqueueSyncTask').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'upsertUserSystemSetting').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'loadLatestCompletedRunTimes').mockResolvedValue({
      lastDeltaAt: null,
      lastFullAt: null,
    })

    mocks.checkAffiliatePlatformConfig.mockResolvedValue({
      configured: true,
      missingKeys: [],
      values: {},
    })

    const queued = await scheduler.scheduleForUser(5, new Date('2026-02-24T01:30:00.000Z'))

    expect(queued).toBe(true)
    expect(scheduler.enqueueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        platform: 'partnerboost',
        mode: 'delta',
      })
    )
    expect(dbQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("key IN (?, ?, ?, ?)"),
      [
        5,
        'affiliate_pb_delta_interval_minutes',
        'affiliate_pb_full_interval_hours',
        'affiliate_pb_last_delta_sync_at',
        'affiliate_pb_last_full_sync_at',
      ]
    )
  })

  it('loads YP schedule config directly when PB is not configured', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any

    vi.spyOn(scheduler, 'hasActiveSyncRun').mockResolvedValue(false)
    vi.spyOn(scheduler, 'enqueueSyncTask').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'upsertUserSystemSetting').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'loadLatestCompletedRunTimesByPlatform').mockResolvedValue({
      lastDeltaAt: null,
      lastFullAt: null,
    })

    const ypScheduleSpy = vi.spyOn(scheduler, 'loadYeahpromosScheduleConfig').mockResolvedValue({
      deltaIntervalMinutes: 60,
      fullIntervalHours: 24,
      lastDeltaAt: new Date('2026-02-23T22:00:00.000Z'),
      lastFullAt: new Date('2026-02-24T00:00:00.000Z'),
    })

    mocks.checkAffiliatePlatformConfig.mockImplementation(async (_userId: number, platform: string) => {
      if (platform === 'partnerboost') {
        return {
          configured: false,
          missingKeys: ['partnerboost_token'],
          values: {},
        }
      }
      return {
        configured: true,
        missingKeys: [],
        values: {
          yeahpromos_token: 'token',
          yeahpromos_site_id: 'site',
        },
      }
    })

    const queued = await scheduler.scheduleForUser(6, new Date('2026-02-24T01:30:00.000Z'))

    expect(queued).toBe(true)
    expect(ypScheduleSpy).toHaveBeenCalledWith(6)
    expect(scheduler.enqueueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 6,
        platform: 'yeahpromos',
        mode: 'delta',
      })
    )
  })

  it('seeds new platform run from latest failed cursor before enqueue', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any

    mocks.createAffiliateProductSyncRun.mockResolvedValue(1201)
    mocks.getLatestFailedAffiliateProductSyncRun.mockResolvedValue({
      id: 1199,
      user_id: 1,
      platform: 'yeahpromos',
      mode: 'platform',
      status: 'failed',
      trigger_source: 'manual',
      total_items: 54600,
      created_count: 53843,
      updated_count: 757,
      failed_count: 1,
      cursor_page: 64,
      cursor_scope: 'amazon.de',
      processed_batches: 478,
      last_heartbeat_at: null,
      error_message: 'session expired',
      started_at: null,
      completed_at: null,
      created_at: '2026-02-28T00:00:00.000Z',
      updated_at: '2026-02-28T00:00:00.000Z',
    })

    const enqueueMock = vi.fn().mockResolvedValue('task-1201')
    mocks.getQueueManagerForTaskType.mockReturnValue({
      enqueue: enqueueMock,
    })

    await scheduler.enqueueSyncTask({
      userId: 1,
      platform: 'yeahpromos',
      mode: 'platform',
      nowIso: '2026-03-01T00:00:00.000Z',
    })

    expect(mocks.updateAffiliateProductSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 1201,
        totalItems: 54600,
        createdCount: 53843,
        updatedCount: 757,
        cursorPage: 64,
        cursorScope: 'amazon.de',
        processedBatches: 478,
      })
    )
    expect(enqueueMock).toHaveBeenCalled()
  })

  it('does not try failed-run resume for delta mode', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any

    mocks.createAffiliateProductSyncRun.mockResolvedValue(1301)
    const enqueueMock = vi.fn().mockResolvedValue('task-1301')
    mocks.getQueueManagerForTaskType.mockReturnValue({
      enqueue: enqueueMock,
    })

    await scheduler.enqueueSyncTask({
      userId: 1,
      platform: 'yeahpromos',
      mode: 'delta',
      nowIso: '2026-03-01T00:00:00.000Z',
    })

    expect(mocks.getLatestFailedAffiliateProductSyncRun).not.toHaveBeenCalled()
    expect(enqueueMock).toHaveBeenCalled()
  })

  it('filters scheduler users by product_management_enabled gate', async () => {
    const dbQueryMock = vi.fn().mockResolvedValue([{ id: 9 }, { id: 12 }])
    mocks.getDatabase.mockResolvedValue({
      type: 'postgres',
      query: dbQueryMock,
      queryOne: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
    })

    const scheduler = new AffiliateProductSyncScheduler() as any
    const userIds = await scheduler.listEligibleUsers()

    expect(userIds).toEqual([9, 12])
    expect(dbQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('product_management_enabled = TRUE')
    )
  })

  it('runs raw_json retirement maintenance during periodic checks', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any
    scheduler.isRunning = true
    vi.spyOn(scheduler, 'listEligibleUsers').mockResolvedValue([])

    await scheduler.checkAndScheduleSync()

    expect(mocks.runAffiliateProductsRawJsonRetirementMaintenance).toHaveBeenCalledTimes(1)
  })
})
