import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkAffiliatePlatformConfig: vi.fn(),
  getAffiliateProductSyncRunById: vi.fn(),
  listAffiliateProducts: vi.fn(),
  normalizeAffiliatePlatform: vi.fn(),
  recordAffiliateProductSyncHourlySnapshot: vi.fn(),
  syncAffiliateProducts: vi.fn(),
  updateAffiliateProductSyncRun: vi.fn(),
  getDatabase: vi.fn(),
  dbQuery: vi.fn(),
  buildProductListCacheHash: vi.fn(),
  getLatestProductListQuery: vi.fn(),
  invalidateProductListCache: vi.fn(),
  setCachedProductList: vi.fn(),
  getQueueManagerForTaskType: vi.fn(),
  queueEnqueue: vi.fn(),
}))

process.env.AFFILIATE_SYNC_RECOVERY_RETRY_MAX_ATTEMPTS = '3'
process.env.AFFILIATE_SYNC_RECOVERY_SYNC_MAX_ATTEMPTS = '2'
process.env.AFFILIATE_SYNC_RECOVERY_RETRY_BASE_DELAY_MS = '1'
process.env.AFFILIATE_SYNC_RECOVERY_RETRY_MAX_DELAY_MS = '2'

vi.mock('@/lib/affiliate-products', () => ({
  checkAffiliatePlatformConfig: mocks.checkAffiliatePlatformConfig,
  getAffiliateProductSyncRunById: mocks.getAffiliateProductSyncRunById,
  listAffiliateProducts: mocks.listAffiliateProducts,
  normalizeAffiliatePlatform: mocks.normalizeAffiliatePlatform,
  recordAffiliateProductSyncHourlySnapshot: mocks.recordAffiliateProductSyncHourlySnapshot,
  syncAffiliateProducts: mocks.syncAffiliateProducts,
  updateAffiliateProductSyncRun: mocks.updateAffiliateProductSyncRun,
}))

vi.mock('@/lib/products-cache', () => ({
  buildProductListCacheHash: mocks.buildProductListCacheHash,
  getLatestProductListQuery: mocks.getLatestProductListQuery,
  invalidateProductListCache: mocks.invalidateProductListCache,
  setCachedProductList: mocks.setCachedProductList,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: mocks.getDatabase,
}))

vi.mock('@/lib/queue/queue-routing', () => ({
  getQueueManagerForTaskType: mocks.getQueueManagerForTaskType,
}))

import { executeAffiliateProductSync } from '../affiliate-product-sync-executor'

function createTask(data: Partial<{
  userId: number
  platform: 'partnerboost' | 'yeahpromos'
  mode: 'platform' | 'delta' | 'single'
  runId: number
  productId: number
  trigger: 'manual' | 'retry' | 'schedule'
}> = {}) {
  return {
    id: `task-${data.runId || 99}`,
    type: 'affiliate-product-sync',
    userId: data.userId || 1,
    status: 'pending',
    priority: 'normal',
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: 1,
    data: {
      userId: data.userId || 1,
      platform: data.platform || 'partnerboost',
      mode: data.mode || 'platform',
      runId: data.runId || 99,
      productId: data.productId,
      trigger: data.trigger || 'schedule',
    },
  } as any
}

describe('affiliate-product-sync executor resume behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.checkAffiliatePlatformConfig.mockResolvedValue({
      configured: true,
      missingKeys: [],
      values: {},
    })
    mocks.getAffiliateProductSyncRunById.mockResolvedValue({
      id: 99,
      user_id: 1,
      platform: 'partnerboost',
      mode: 'platform',
      status: 'queued',
      total_items: 0,
      created_count: 0,
      updated_count: 0,
      failed_count: 0,
      cursor_page: 0,
      processed_batches: 0,
      started_at: null,
      completed_at: null,
    })
    mocks.syncAffiliateProducts.mockResolvedValue({
      totalFetched: 10,
      createdCount: 1,
      updatedCount: 9,
    })
    mocks.recordAffiliateProductSyncHourlySnapshot.mockResolvedValue(undefined)
    mocks.updateAffiliateProductSyncRun.mockResolvedValue(undefined)

    mocks.invalidateProductListCache.mockResolvedValue(undefined)
    mocks.getLatestProductListQuery.mockResolvedValue(null)
    mocks.buildProductListCacheHash.mockReturnValue('cache-hash')
    mocks.dbQuery.mockResolvedValue([])
    mocks.getDatabase.mockResolvedValue({
      type: 'postgres',
      query: mocks.dbQuery,
    })
    mocks.listAffiliateProducts.mockResolvedValue({
      items: [],
      total: 0,
      productsWithLinkCount: 0,
      activeProductsCount: 0,
      invalidProductsCount: 0,
      syncMissingProductsCount: 0,
      unknownProductsCount: 0,
      blacklistedCount: 0,
      page: 1,
      pageSize: 20,
    })
    mocks.setCachedProductList.mockResolvedValue(undefined)
    mocks.queueEnqueue.mockResolvedValue('task-next')
    mocks.getQueueManagerForTaskType.mockReturnValue({
      enqueue: mocks.queueEnqueue,
    })
  })

  it('does not resume from historical failed runs when current run has no checkpoint', async () => {
    const task = createTask({ runId: 201, trigger: 'schedule' })
    await executeAffiliateProductSync(task)

    expect(mocks.syncAffiliateProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        platform: 'partnerboost',
        mode: 'platform',
        resumeFromPage: undefined,
      })
    )
  })

  it('keeps resume for the same run when checkpoint exists', async () => {
    mocks.getAffiliateProductSyncRunById.mockResolvedValue({
      id: 202,
      user_id: 1,
      platform: 'partnerboost',
      mode: 'platform',
      status: 'running',
      total_items: 32000,
      created_count: 120,
      updated_count: 31880,
      failed_count: 0,
      cursor_page: 321,
      cursor_scope: 'DE',
      processed_batches: 32,
      started_at: '2026-02-21T10:00:00.000Z',
      completed_at: null,
    })

    const task = createTask({ runId: 202, trigger: 'retry' })
    await executeAffiliateProductSync(task)

    expect(mocks.syncAffiliateProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        platform: 'partnerboost',
        mode: 'platform',
        resumeFromPage: 321,
        resumeFromScope: 'DE',
        fetchedItemsBeforeWindow: 32000,
      })
    )
  })

  it('re-enqueues next shard for yeahpromos platform sync when hasMore=true', async () => {
    mocks.getAffiliateProductSyncRunById.mockResolvedValue({
      id: 303,
      user_id: 1,
      platform: 'yeahpromos',
      mode: 'platform',
      status: 'running',
      total_items: 200,
      created_count: 30,
      updated_count: 170,
      failed_count: 0,
      cursor_page: 2,
      cursor_scope: 'amazon.com',
      processed_batches: 2,
      started_at: '2026-02-21T10:00:00.000Z',
      completed_at: null,
    })
    mocks.syncAffiliateProducts.mockResolvedValue({
      totalFetched: 12,
      createdCount: 2,
      updatedCount: 10,
      hasMore: true,
      nextCursorPage: 5,
      nextCursorScope: 'amazon.co.uk',
    })

    const task = createTask({
      runId: 303,
      platform: 'yeahpromos',
      mode: 'platform',
      trigger: 'manual',
    })
    const result = await executeAffiliateProductSync(task)

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        runId: 303,
        continued: true,
      })
    )
    expect(mocks.queueEnqueue).toHaveBeenCalledWith(
      'affiliate-product-sync',
      expect.objectContaining({
        userId: 1,
        platform: 'yeahpromos',
        mode: 'platform',
        runId: 303,
        trigger: 'retry',
      }),
      1,
      expect.objectContaining({
        priority: 'normal',
        maxRetries: 1,
      })
    )
    expect(mocks.updateAffiliateProductSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 303,
        status: 'running',
        cursorPage: 5,
        cursorScope: 'amazon.co.uk',
        completedAt: null,
      })
    )
    expect(mocks.updateAffiliateProductSyncRun).not.toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 303,
        status: 'completed',
      })
    )
  })

  it('re-enqueues next shard for partnerboost platform sync when hasMore=true', async () => {
    mocks.getAffiliateProductSyncRunById.mockResolvedValue({
      id: 404,
      user_id: 1,
      platform: 'partnerboost',
      mode: 'platform',
      status: 'running',
      total_items: 50000,
      created_count: 120,
      updated_count: 49880,
      failed_count: 0,
      cursor_page: 501,
      cursor_scope: 'US',
      processed_batches: 50,
      started_at: '2026-03-05T06:53:52.070Z',
      completed_at: null,
    })
    mocks.syncAffiliateProducts.mockResolvedValue({
      totalFetched: 1000,
      createdCount: 2,
      updatedCount: 998,
      hasMore: true,
      nextCursorPage: 511,
      nextCursorScope: 'US',
    })

    const task = createTask({
      runId: 404,
      platform: 'partnerboost',
      mode: 'platform',
      trigger: 'manual',
    })
    const result = await executeAffiliateProductSync(task)

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        runId: 404,
        continued: true,
      })
    )
    expect(mocks.queueEnqueue).toHaveBeenCalledWith(
      'affiliate-product-sync',
      expect.objectContaining({
        userId: 1,
        platform: 'partnerboost',
        mode: 'platform',
        runId: 404,
        trigger: 'retry',
      }),
      1,
      expect.objectContaining({
        priority: 'normal',
        maxRetries: 1,
      })
    )
    expect(mocks.updateAffiliateProductSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 404,
        status: 'running',
        cursorPage: 511,
        cursorScope: 'US',
        completedAt: null,
      })
    )
    expect(mocks.updateAffiliateProductSyncRun).not.toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 404,
        status: 'completed',
      })
    )
  })

  it('marks yeahpromos run failed when first full sync fetches zero items', async () => {
    mocks.getAffiliateProductSyncRunById.mockResolvedValue({
      id: 505,
      user_id: 1,
      platform: 'yeahpromos',
      mode: 'platform',
      status: 'running',
      total_items: 0,
      created_count: 0,
      updated_count: 0,
      failed_count: 0,
      cursor_page: 0,
      cursor_scope: null,
      processed_batches: 0,
      started_at: '2026-03-22T01:38:51.421Z',
      completed_at: null,
    })
    mocks.syncAffiliateProducts.mockResolvedValue({
      totalFetched: 0,
      createdCount: 0,
      updatedCount: 0,
      hasMore: false,
      nextCursorPage: 0,
      nextCursorScope: null,
    })

    const task = createTask({
      runId: 505,
      platform: 'yeahpromos',
      mode: 'platform',
      trigger: 'manual',
    })

    await expect(executeAffiliateProductSync(task)).rejects.toThrow(/YeahPromos 同步失败/)
    expect(mocks.updateAffiliateProductSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 505,
        status: 'failed',
        errorMessage: expect.stringContaining('未抓取到任何商品'),
      })
    )
    expect(mocks.updateAffiliateProductSyncRun).not.toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 505,
        status: 'completed',
        errorMessage: expect.stringContaining('未抓取到任何商品'),
      })
    )
  })

  it('retries platform sync when PostgreSQL reports recovery mode', async () => {
    const recoveryError = Object.assign(
      new Error('the database system is in recovery mode'),
      { code: '57P03' }
    )
    mocks.syncAffiliateProducts
      .mockRejectedValueOnce(recoveryError)
      .mockResolvedValueOnce({
        totalFetched: 10,
        createdCount: 1,
        updatedCount: 9,
      })

    const task = createTask({
      runId: 505,
      platform: 'partnerboost',
      mode: 'platform',
      trigger: 'manual',
    })

    const result = await executeAffiliateProductSync(task)

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        runId: 505,
      })
    )
    expect(mocks.syncAffiliateProducts).toHaveBeenCalledTimes(2)
  })

  it('retries platform sync when PostgreSQL reports CONNECTION_CLOSED', async () => {
    const transientError = Object.assign(
      new Error('write CONNECTION_CLOSED dbprovider.sg-members-1.clawcloudrun.com:32243'),
      { code: 'CONNECTION_CLOSED' }
    )
    mocks.syncAffiliateProducts
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({
        totalFetched: 8,
        createdCount: 1,
        updatedCount: 7,
      })

    const task = createTask({
      runId: 506,
      platform: 'partnerboost',
      mode: 'platform',
      trigger: 'manual',
    })

    const result = await executeAffiliateProductSync(task)

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        runId: 506,
      })
    )
    expect(mocks.syncAffiliateProducts).toHaveBeenCalledTimes(2)
  })

  it('retries platform sync when PostgreSQL reports ECONNRESET', async () => {
    const transientError = Object.assign(
      new Error('socket hang up: ECONNRESET'),
      { code: 'ECONNRESET' }
    )
    mocks.syncAffiliateProducts
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({
        totalFetched: 7,
        createdCount: 2,
        updatedCount: 5,
      })

    const task = createTask({
      runId: 507,
      platform: 'partnerboost',
      mode: 'platform',
      trigger: 'manual',
    })

    const result = await executeAffiliateProductSync(task)

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        runId: 507,
      })
    )
    expect(mocks.syncAffiliateProducts).toHaveBeenCalledTimes(2)
  })

  it('retries platform sync when PostgreSQL reports ETIMEDOUT', async () => {
    const transientError = Object.assign(
      new Error('timeout: ETIMEDOUT'),
      { code: 'ETIMEDOUT' }
    )
    mocks.syncAffiliateProducts
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({
        totalFetched: 6,
        createdCount: 1,
        updatedCount: 5,
      })

    const task = createTask({
      runId: 508,
      platform: 'partnerboost',
      mode: 'platform',
      trigger: 'manual',
    })

    const result = await executeAffiliateProductSync(task)

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        runId: 508,
      })
    )
    expect(mocks.syncAffiliateProducts).toHaveBeenCalledTimes(2)
  })

  it('marks partnerboost run completed when stall guard detects no growth', async () => {
    mocks.getAffiliateProductSyncRunById.mockResolvedValue({
      id: 606,
      user_id: 1,
      platform: 'partnerboost',
      mode: 'platform',
      status: 'running',
      total_items: 356265,
      created_count: 3266,
      updated_count: 352999,
      failed_count: 0,
      cursor_page: 3071,
      cursor_scope: 'US',
      processed_batches: 307,
      started_at: '2026-03-22T01:38:51.421Z',
      completed_at: null,
    })
    mocks.syncAffiliateProducts.mockResolvedValue({
      totalFetched: 0,
      createdCount: 0,
      updatedCount: 0,
      hasMore: true,
      nextCursorPage: 3081,
      nextCursorScope: 'US',
    })
    mocks.dbQuery.mockResolvedValue([
      { max_total_items: 356265 },
      { max_total_items: 356265 },
      { max_total_items: 356265 },
      { max_total_items: 356265 },
      { max_total_items: 356265 },
      { max_total_items: 356265 },
    ])

    const task = createTask({
      runId: 606,
      platform: 'partnerboost',
      mode: 'platform',
      trigger: 'manual',
    })
    const result = await executeAffiliateProductSync(task)

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        runId: 606,
      })
    )
    expect(mocks.updateAffiliateProductSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 606,
        status: 'completed',
        errorMessage: expect.stringContaining('PartnerBoost'),
      })
    )
    expect(mocks.updateAffiliateProductSyncRun).not.toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 606,
        status: 'failed',
      })
    )
  })

  it('keeps stall guard failure for yeahpromos and reports platform label', async () => {
    mocks.getAffiliateProductSyncRunById.mockResolvedValue({
      id: 707,
      user_id: 1,
      platform: 'yeahpromos',
      mode: 'platform',
      status: 'running',
      total_items: 8888,
      created_count: 50,
      updated_count: 8838,
      failed_count: 0,
      cursor_page: 91,
      cursor_scope: 'amazon.com',
      processed_batches: 100,
      started_at: '2026-03-22T01:38:51.421Z',
      completed_at: null,
    })
    mocks.syncAffiliateProducts.mockResolvedValue({
      totalFetched: 0,
      createdCount: 0,
      updatedCount: 0,
      hasMore: true,
      nextCursorPage: 101,
      nextCursorScope: 'amazon.com',
    })
    mocks.dbQuery.mockResolvedValue([
      { max_total_items: 8888 },
      { max_total_items: 8888 },
      { max_total_items: 8888 },
      { max_total_items: 8888 },
      { max_total_items: 8888 },
      { max_total_items: 8888 },
    ])

    const task = createTask({
      runId: 707,
      platform: 'yeahpromos',
      mode: 'platform',
      trigger: 'manual',
    })

    await expect(executeAffiliateProductSync(task)).rejects.toThrow(/YeahPromos/)
    expect(mocks.updateAffiliateProductSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 707,
        status: 'failed',
        errorMessage: expect.stringContaining('YeahPromos'),
      })
    )
  })
})
