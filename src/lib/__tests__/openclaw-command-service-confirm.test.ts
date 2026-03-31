import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDatabaseMock,
  getQueueManagerForTaskTypeMock,
  isBackgroundQueueSplitEnabledMock,
  getQueueManagerMock,
  isBackgroundWorkerAliveMock,
  createOrRefreshCommandConfirmationMock,
  expireStaleCommandConfirmationsMock,
  consumeCommandConfirmationMock,
  consumeCommandConfirmationByOwnerMock,
} = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
  getQueueManagerForTaskTypeMock: vi.fn(),
  isBackgroundQueueSplitEnabledMock: vi.fn(),
  getQueueManagerMock: vi.fn(),
  isBackgroundWorkerAliveMock: vi.fn(),
  createOrRefreshCommandConfirmationMock: vi.fn(),
  expireStaleCommandConfirmationsMock: vi.fn(),
  consumeCommandConfirmationMock: vi.fn(),
  consumeCommandConfirmationByOwnerMock: vi.fn(),
}))

vi.mock('../db', () => ({
  getDatabase: getDatabaseMock,
}))

vi.mock('../queue/queue-routing', () => ({
  getQueueManagerForTaskType: getQueueManagerForTaskTypeMock,
  isBackgroundQueueSplitEnabled: isBackgroundQueueSplitEnabledMock,
}))

vi.mock('../queue/unified-queue-manager', () => ({
  getQueueManager: getQueueManagerMock,
}))

vi.mock('../queue/background-worker-heartbeat', () => ({
  isBackgroundWorkerAlive: isBackgroundWorkerAliveMock,
}))

vi.mock('../openclaw/commands/confirm-service', () => ({
  createOrRefreshCommandConfirmation: createOrRefreshCommandConfirmationMock,
  expireStaleCommandConfirmations: expireStaleCommandConfirmationsMock,
  consumeCommandConfirmation: consumeCommandConfirmationMock,
  consumeCommandConfirmationByOwner: consumeCommandConfirmationByOwnerMock,
  recordOpenclawCallbackEvent: vi.fn(),
}))

import { confirmOpenclawCommandByOwner, executeOpenclawCommand } from '../openclaw/commands/command-service'

describe('openclaw command service confirmation guard', () => {
  let db: {
    type: 'sqlite'
    queryOne: ReturnType<typeof vi.fn>
    exec: ReturnType<typeof vi.fn>
  }
  let queueManager: {
    enqueue: ReturnType<typeof vi.fn>
  }
  let coreQueueManager: {
    enqueue: ReturnType<typeof vi.fn>
  }

  function getInsertParams(): any[] {
    const insertCall = db.exec.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO openclaw_command_runs')
    )
    return insertCall?.[1] || []
  }

  function getInsertedBody(): Record<string, any> {
    const params = getInsertParams()
    const bodyJson = params[9]
    return bodyJson ? JSON.parse(bodyJson) : {}
  }

  function getInsertedQuery(): Record<string, any> {
    const params = getInsertParams()
    const queryJson = params[8]
    return queryJson ? JSON.parse(queryJson) : {}
  }

  function getValidPublishBody() {
    return {
      offerId: 1,
      googleAdsAccountId: 2,
      campaignConfig: {
        campaignName: 'Test Campaign',
      },
    }
  }

  beforeEach(() => {
    process.env.OPENCLAW_CONFIRM_MEDIUM_RISK = 'false'

    db = {
      type: 'sqlite',
      queryOne: vi.fn().mockResolvedValue(null),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
    }

    queueManager = {
      enqueue: vi.fn().mockResolvedValue('task-1'),
    }
    coreQueueManager = {
      enqueue: vi.fn().mockResolvedValue('task-core-1'),
    }

    getDatabaseMock.mockReset()
    getDatabaseMock.mockResolvedValue(db)

    getQueueManagerForTaskTypeMock.mockReset()
    getQueueManagerForTaskTypeMock.mockReturnValue(queueManager)
    isBackgroundQueueSplitEnabledMock.mockReset()
    isBackgroundQueueSplitEnabledMock.mockReturnValue(false)
    getQueueManagerMock.mockReset()
    getQueueManagerMock.mockReturnValue(coreQueueManager)
    isBackgroundWorkerAliveMock.mockReset()
    isBackgroundWorkerAliveMock.mockResolvedValue(false)

    createOrRefreshCommandConfirmationMock.mockReset()
    createOrRefreshCommandConfirmationMock.mockResolvedValue({
      confirmToken: 'occf_test',
      expiresAt: '2026-02-11T00:00:00.000Z',
    })
    expireStaleCommandConfirmationsMock.mockReset()
    expireStaleCommandConfirmationsMock.mockResolvedValue(0)
    consumeCommandConfirmationMock.mockReset()
    consumeCommandConfirmationMock.mockResolvedValue({
      ok: true,
      status: 'confirmed',
      runId: 'run-confirm',
      userId: 1001,
      riskLevel: 'high',
      confirmStatus: 'confirmed',
    })
    consumeCommandConfirmationByOwnerMock.mockReset()
    consumeCommandConfirmationByOwnerMock.mockResolvedValue({
      ok: true,
      status: 'confirmed',
      runId: 'run-confirm',
      userId: 1001,
      riskLevel: 'high',
      confirmStatus: 'confirmed',
    })
  })

  it.each([
    {
      method: 'PUT',
      path: '/api/settings',
      body: {
        updates: [
          { category: 'ai', key: 'gemini_provider', value: 'official' },
        ],
      },
    },
    {
      method: 'POST',
      path: '/api/sync/trigger',
      body: undefined,
    },
    {
      method: 'POST',
      path: '/api/google-ads/credentials',
      body: {
        client_id: 'client-id',
        client_secret: 'client-secret',
        refresh_token: 'refresh-token',
        developer_token: 'developer-token',
      },
    },
  ])('auto-confirms and queues high-risk path $method $path', async ({ method, path, body }) => {
    const result = await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method,
      path,
      body,
      channel: 'feishu',
      senderId: 'ou_test',
    })

    expect(result).toMatchObject({
      status: 'queued',
      riskLevel: 'high',
      taskId: 'task-1',
    })

    expect(createOrRefreshCommandConfirmationMock).toHaveBeenCalledTimes(1)
    expect(createOrRefreshCommandConfirmationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1001 })
    )
    expect(consumeCommandConfirmationByOwnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1001,
        decision: 'confirm',
      })
    )
    expect(getQueueManagerForTaskTypeMock).toHaveBeenCalledTimes(1)
    expect(queueManager.enqueue).toHaveBeenCalledTimes(1)
    expect(db.exec).toHaveBeenCalled()
  })

  it('auto-confirms existing pending run when idempotency key is reused', async () => {
    db.queryOne.mockResolvedValueOnce({
      id: 'run-existing-1',
      status: 'pending_confirm',
      risk_level: 'high',
      queue_task_id: null,
    })

    const result = await executeOpenclawCommand({
      userId: 1001,
      authType: 'gateway-binding',
      method: 'POST',
      path: '/api/sync/trigger',
      idempotencyKey: 'idem-existing-1',
    })

    expect(result).toMatchObject({
      status: 'queued',
      runId: 'run-existing-1',
      taskId: 'task-1',
      riskLevel: 'high',
    })
    expect(createOrRefreshCommandConfirmationMock).toHaveBeenCalledWith({
      runId: 'run-existing-1',
      userId: 1001,
    })
    expect(consumeCommandConfirmationByOwnerMock).toHaveBeenCalledWith({
      runId: 'run-existing-1',
      userId: 1001,
      decision: 'confirm',
    })
    expect(
      db.exec.mock.calls.some((call) => String(call[0]).includes('INSERT INTO openclaw_command_runs'))
    ).toBe(false)
  })

  it('fills fallback channel for session auth when channel is missing', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/campaigns/publish',
      body: getValidPublishBody(),
      senderId: 'ou_test',
    })

    const params = getInsertParams()

    expect(params[3]).toBe('web')
    expect(params[4]).toBe('ou_test')
  })

  it('falls back to core queue when split is enabled and background worker heartbeat is missing', async () => {
    isBackgroundQueueSplitEnabledMock.mockReturnValue(true)
    isBackgroundWorkerAliveMock.mockResolvedValue(false)
    process.env.OPENCLAW_CONFIRM_MEDIUM_RISK = 'false'

    const result = await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/click-farm/tasks',
      body: {
        offer_id: 31,
        daily_click_count: 50,
      },
      senderId: 'ou_test',
    })

    expect(result.status).toBe('queued')
    expect(queueManager.enqueue).not.toHaveBeenCalled()
    expect(coreQueueManager.enqueue).toHaveBeenCalledTimes(1)
  })

  it('keeps using routed queue when split is enabled and background worker heartbeat exists', async () => {
    isBackgroundQueueSplitEnabledMock.mockReturnValue(true)
    isBackgroundWorkerAliveMock.mockResolvedValue(true)
    process.env.OPENCLAW_CONFIRM_MEDIUM_RISK = 'false'

    const result = await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/click-farm/tasks',
      body: {
        offer_id: 31,
        daily_click_count: 50,
      },
      senderId: 'ou_test',
    })

    expect(result.status).toBe('queued')
    expect(queueManager.enqueue).toHaveBeenCalledTimes(1)
    expect(coreQueueManager.enqueue).not.toHaveBeenCalled()
  })

  it('fills fallback channel for user-token auth when channel is missing', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'user-token',
      method: 'POST',
      path: '/api/campaigns/publish',
      body: getValidPublishBody(),
    })

    const params = getInsertParams()

    expect(params[3]).toBe('user-token')
    expect(params[4]).toBeNull()
  })

  it('fills fallback channel for gateway-binding auth when channel is missing', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'gateway-binding',
      method: 'POST',
      path: '/api/campaigns/publish',
      body: getValidPublishBody(),
    })

    const params = getInsertParams()

    expect(params[3]).toBe('feishu')
  })

  it('rejects unsupported payload fields for guarded publish route', async () => {
    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'POST',
        path: '/api/campaigns/publish',
        body: {
          ...getValidPublishBody(),
          attackerField: 'x',
        },
      })
    ).rejects.toThrow('unsupported fields')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('normalizes publish aliases and force flags before persistence', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/campaigns/publish',
      body: {
        offer_id: 11,
        ad_creative_id: 99,
        google_ads_account_id: 22,
        campaign_config: { campaignName: 'Alias Campaign' },
        pause_old_campaigns: true,
        enable_campaign_immediately: false,
        enable_smart_optimization: true,
        variant_count: 4,
        force_launch: 'true',
        skipLaunchScore: false,
      },
    })

    const body = getInsertedBody()

    expect(body).toMatchObject({
      offerId: 11,
      adCreativeId: 99,
      googleAdsAccountId: 22,
      campaignConfig: { campaignName: 'Alias Campaign' },
      pauseOldCampaigns: true,
      enableCampaignImmediately: false,
      enableSmartOptimization: true,
      variantCount: 4,
      forcePublish: true,
    })

    expect(body.offer_id).toBeUndefined()
    expect(body.force_launch).toBeUndefined()
    expect(body.skipLaunchScore).toBeUndefined()
  })

  it('normalizes nested publish campaignConfig fields to web-style camelCase', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/campaigns/publish',
      body: {
        offerId: 11,
        adCreativeId: 99,
        googleAdsAccountId: 22,
        campaignConfig: {
          target_country: 'US',
          target_language: 'en',
          budget_amount: 10,
          budget_type: 'DAILY',
          bidding_strategy: 'MAXIMIZE_CLICKS',
          max_cpc_bid: 0.2,
          final_urls: [' https://example.com '],
          keywords: [{ keyword: ' sonic toothbrush ', matchType: 'phrase' }],
          negative_keywords: [' free ', 'FREE'],
          negative_keywords_match_type: {
            free: 'PHRASE',
          },
        },
      },
    })

    const body = getInsertedBody()
    const campaignConfig = body.campaignConfig || {}

    expect(campaignConfig).toMatchObject({
      targetCountry: 'US',
      targetLanguage: 'en',
      budgetAmount: 10,
      budgetType: 'DAILY',
      biddingStrategy: 'MAXIMIZE_CLICKS',
      maxCpcBid: 0.2,
      finalUrls: ['https://example.com'],
      keywords: [{ text: 'sonic toothbrush', matchType: 'PHRASE' }],
      negativeKeywords: ['free'],
      negativeKeywordMatchType: { free: 'PHRASE' },
    })

    expect(campaignConfig.target_country).toBeUndefined()
    expect(campaignConfig.max_cpc_bid).toBeUndefined()
    expect(campaignConfig.final_urls).toBeUndefined()
    expect(campaignConfig.negative_keywords).toBeUndefined()
    expect(campaignConfig.negative_keywords_match_type).toBeUndefined()
  })

  it('applies web defaults for publish top-level optional flags', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/campaigns/publish',
      body: {
        offerId: 11,
        googleAdsAccountId: 22,
        campaignConfig: {
          campaignName: 'Defaulted Campaign',
        },
      },
    })

    const body = getInsertedBody()
    expect(body).toMatchObject({
      offerId: 11,
      googleAdsAccountId: 22,
      pauseOldCampaigns: false,
      enableCampaignImmediately: false,
      enableSmartOptimization: false,
      variantCount: 3,
    })
  })

  it('normalizes click-farm aliases to snake_case payload', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/click-farm/tasks',
      body: {
        offerId: 31,
        dailyClickCount: 120,
        startTime: '06:00',
        endTime: '24:00',
        durationDays: 30,
        scheduledStartDate: '2026-02-12',
        hourlyDistribution: new Array(24).fill(5),
        refererConfig: { type: 'none' },
      },
    })

    const body = getInsertedBody()

    expect(body).toMatchObject({
      offer_id: 31,
      daily_click_count: 120,
      start_time: '06:00',
      end_time: '24:00',
      duration_days: 30,
      scheduled_start_date: '2026-02-12',
      referer_config: { type: 'none' },
    })

    expect(Array.isArray(body.hourly_distribution)).toBe(true)
    expect(body.hourly_distribution).toHaveLength(24)
    expect(body.offerId).toBeUndefined()
    expect(body.dailyClickCount).toBeUndefined()
  })

  it('applies web defaults for click-farm payload when fields are omitted', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/click-farm/tasks',
      body: {
        offer_id: 31,
      },
    })

    const body = getInsertedBody()
    expect(body).toMatchObject({
      offer_id: 31,
      daily_click_count: 216,
      start_time: '06:00',
      end_time: '24:00',
      duration_days: 14,
      referer_config: { type: 'none' },
    })
  })

  it('normalizes offer-extract aliases to snake_case payload', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/offers/extract',
      body: {
        url: 'https://aff.example.com/track',
        targetCountry: 'US',
        productPrice: '$19.99',
        brand: 'Example Brand',
      },
    })

    const body = getInsertedBody()

    expect(body).toMatchObject({
      affiliate_link: 'https://aff.example.com/track',
      target_country: 'US',
      product_price: '$19.99',
      brand_name: 'Example Brand',
    })

    expect(body.url).toBeUndefined()
    expect(body.brand).toBeUndefined()
    expect(body.targetCountry).toBeUndefined()
    expect(body.productPrice).toBeUndefined()
    expect(body.page_type).toBe('product')
    expect(body.skipCache).toBe(false)
    expect(body.skipWarmup).toBe(false)
  })

  it('applies web defaults for offer-extract payload when fields are omitted', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/offers/extract',
      body: {
        affiliate_link: 'https://aff.example.com/track',
      },
    })

    const body = getInsertedBody()
    expect(body).toMatchObject({
      affiliate_link: 'https://aff.example.com/track',
      target_country: 'US',
      page_type: 'product',
      skipCache: false,
      skipWarmup: false,
    })
  })

  it('rejects guarded route when required field is missing', async () => {
    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'POST',
        path: '/api/offers/extract',
        body: {
          target_country: 'US',
        },
      })
    ).rejects.toThrow('missing required fields')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('normalizes delete-offer query aliases before persistence', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'DELETE',
      path: '/api/offers/77',
      query: {
        auto_unlink: true,
        remove_google_ads_campaigns: 'true',
      },
    })

    const query = getInsertedQuery()
    expect(query).toEqual({
      autoUnlink: true,
      removeGoogleAdsCampaigns: 'true',
    })
  })

  it('rejects unsupported query params for delete-offer route', async () => {
    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'DELETE',
        path: '/api/offers/77',
        query: {
          autoUnlink: true,
          force: true,
        },
      })
    ).rejects.toThrow('unsupported params')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('rejects non-empty query params on routes that do not accept query', async () => {
    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'POST',
        path: '/api/campaigns',
        query: {
          debug: true,
        },
        body: {
          offerId: 11,
          googleAdsAccountId: 22,
          campaignName: 'test-campaign',
          budgetAmount: 10,
        },
      })
    ).rejects.toThrow('unsupported params')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('normalizes dynamic settings route payload', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'PUT',
      path: '/api/settings/ai/gemini_provider',
      body: {
        value: 'official',
      },
    })

    const body = getInsertedBody()
    expect(body).toEqual({ value: 'official' })
  })

  it('rejects unknown fields for dynamic settings route', async () => {
    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'PUT',
        path: '/api/settings/ai/gemini_provider',
        body: {
          value: 'official',
          unexpected: true,
        },
      })
    ).rejects.toThrow('unsupported fields')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('rejects unknown fields for sync scheduler control', async () => {
    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'POST',
        path: '/api/sync/scheduler',
        body: {
          action: 'start',
          dryRun: true,
        },
      })
    ).rejects.toThrow('unsupported fields')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('requires at least one updatable field for sync config', async () => {
    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'PUT',
        path: '/api/sync/config',
        body: {},
      })
    ).rejects.toThrow('at least one field is required')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('normalizes sync config snake_case aliases', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'PUT',
      path: '/api/sync/config',
      body: {
        auto_sync_enabled: true,
        notify_on_success: false,
      },
    })

    const body = getInsertedBody()
    expect(body).toEqual({
      autoSyncEnabled: true,
      notifyOnSuccess: false,
    })
  })

  it('allows sync trigger with empty body but rejects non-empty body', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/sync/trigger',
    })

    const params = getInsertParams()
    expect(params[9]).toBeNull()

    db.exec.mockClear()

    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'POST',
        path: '/api/sync/trigger',
        body: { force: true },
      })
    ).rejects.toThrow('unsupported fields')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('normalizes google-ads service-account aliases', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/google-ads/service-account',
      body: {
        name: 'mcc-primary',
        mcc_customer_id: '123-456-7890',
        developer_token: 'dev-token',
        service_account_json: '{"client_email":"test@example.com"}',
      },
    })

    const body = getInsertedBody()
    expect(body).toEqual({
      name: 'mcc-primary',
      mccCustomerId: '123-456-7890',
      developerToken: 'dev-token',
      serviceAccountJson: '{"client_email":"test@example.com"}',
    })
  })

  it('normalizes google-ads-accounts dynamic route aliases', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'PUT',
      path: '/api/google-ads-accounts/123',
      body: {
        account_name: 'main account',
        is_active: true,
        token_expires_at: '2026-02-12T00:00:00.000Z',
      },
    })

    const body = getInsertedBody()
    expect(body).toEqual({
      accountName: 'main account',
      isActive: true,
      tokenExpiresAt: '2026-02-12T00:00:00.000Z',
    })
  })

  it('owner confirmation queues command when decision is confirm', async () => {
    db.queryOne.mockResolvedValueOnce({
      id: 'run-owner-confirm-1',
      status: 'pending_confirm',
      risk_level: 'high',
    })

    const result = await confirmOpenclawCommandByOwner({
      runId: 'run-owner-confirm-1',
      userId: 1001,
      decision: 'confirm',
      parentRequestId: 'req_parent_1',
    })

    expect(result).toMatchObject({
      status: 'queued',
      runId: 'run-owner-confirm-1',
      riskLevel: 'high',
    })
    expect(consumeCommandConfirmationByOwnerMock).toHaveBeenCalledWith({
      runId: 'run-owner-confirm-1',
      userId: 1001,
      decision: 'confirm',
    })
    expect(queueManager.enqueue).toHaveBeenCalledWith(
      'openclaw-command',
      expect.objectContaining({
        runId: 'run-owner-confirm-1',
        userId: 1001,
        trigger: 'confirm',
      }),
      1001,
      expect.objectContaining({
        priority: 'high',
        maxRetries: 0,
        parentRequestId: 'req_parent_1',
      })
    )
  })

  it('owner confirmation returns canceled when decision is cancel', async () => {
    db.queryOne.mockResolvedValueOnce({
      id: 'run-owner-confirm-2',
      status: 'pending_confirm',
      risk_level: 'high',
    })
    consumeCommandConfirmationByOwnerMock.mockResolvedValueOnce({
      ok: true,
      status: 'canceled',
      runId: 'run-owner-confirm-2',
      userId: 1001,
      riskLevel: 'high',
      confirmStatus: 'canceled',
    })

    const result = await confirmOpenclawCommandByOwner({
      runId: 'run-owner-confirm-2',
      userId: 1001,
      decision: 'cancel',
    })

    expect(result).toEqual({
      status: 'canceled',
      runId: 'run-owner-confirm-2',
    })
    expect(queueManager.enqueue).not.toHaveBeenCalled()
  })

  it('owner confirmation returns not_found when run does not exist', async () => {
    db.queryOne.mockResolvedValueOnce(null)

    const result = await confirmOpenclawCommandByOwner({
      runId: 'run-owner-missing',
      userId: 1001,
      decision: 'confirm',
    })

    expect(result).toEqual({
      status: 'not_found',
      runId: 'run-owner-missing',
    })
    expect(consumeCommandConfirmationByOwnerMock).not.toHaveBeenCalled()
    expect(queueManager.enqueue).not.toHaveBeenCalled()
  })

  it('owner confirmation returns already_processed when confirm already consumed', async () => {
    db.queryOne.mockResolvedValueOnce({
      id: 'run-owner-confirm-3',
      status: 'pending_confirm',
      risk_level: 'high',
    })
    consumeCommandConfirmationByOwnerMock.mockResolvedValueOnce({
      ok: false,
      code: 'already_processed',
      confirmStatus: 'confirmed',
      runStatus: 'queued',
    })

    const result = await confirmOpenclawCommandByOwner({
      runId: 'run-owner-confirm-3',
      userId: 1001,
      decision: 'confirm',
    })

    expect(result).toEqual({
      status: 'already_processed',
      runId: 'run-owner-confirm-3',
      confirmStatus: 'confirmed',
      runStatus: 'queued',
    })
    expect(queueManager.enqueue).not.toHaveBeenCalled()
  })

})
