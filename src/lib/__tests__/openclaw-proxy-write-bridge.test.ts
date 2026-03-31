import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  verifyOpenclawGatewayTokenMock,
  verifyOpenclawUserTokenMock,
  resolveOpenclawUserFromBindingMock,
  isOpenclawEnabledForUserMock,
  checkOpenclawRateLimitMock,
  fetchAutoadsAsUserMock,
  recordOpenclawActionMock,
  executeOpenclawCommandMock,
  resolveOpenclawParentRequestIdMock,
} = vi.hoisted(() => ({
  verifyOpenclawGatewayTokenMock: vi.fn(),
  verifyOpenclawUserTokenMock: vi.fn(),
  resolveOpenclawUserFromBindingMock: vi.fn(),
  isOpenclawEnabledForUserMock: vi.fn(),
  checkOpenclawRateLimitMock: vi.fn(),
  fetchAutoadsAsUserMock: vi.fn(),
  recordOpenclawActionMock: vi.fn(),
  executeOpenclawCommandMock: vi.fn(),
  resolveOpenclawParentRequestIdMock: vi.fn(),
}))

vi.mock('../openclaw/auth', () => ({
  verifyOpenclawGatewayToken: verifyOpenclawGatewayTokenMock,
}))

vi.mock('../openclaw/tokens', () => ({
  verifyOpenclawUserToken: verifyOpenclawUserTokenMock,
}))

vi.mock('../openclaw/bindings', () => ({
  resolveOpenclawUserFromBinding: resolveOpenclawUserFromBindingMock,
}))

vi.mock('../openclaw/request-auth', () => ({
  isOpenclawEnabledForUser: isOpenclawEnabledForUserMock,
}))

vi.mock('../openclaw/rate-limit', () => ({
  checkOpenclawRateLimit: checkOpenclawRateLimitMock,
}))

vi.mock('../openclaw/autoads-client', () => ({
  fetchAutoadsAsUser: fetchAutoadsAsUserMock,
}))

vi.mock('../openclaw/action-logs', () => ({
  recordOpenclawAction: recordOpenclawActionMock,
}))

vi.mock('../openclaw/commands/command-service', () => ({
  executeOpenclawCommand: executeOpenclawCommandMock,
}))

vi.mock('../openclaw/request-correlation', () => ({
  resolveOpenclawParentRequestId: resolveOpenclawParentRequestIdMock,
}))

import { handleOpenclawProxyRequest } from '../openclaw/proxy'

describe('openclaw proxy write bridge', () => {
  beforeEach(() => {
    verifyOpenclawGatewayTokenMock.mockReset()
    verifyOpenclawUserTokenMock.mockReset()
    resolveOpenclawUserFromBindingMock.mockReset()
    isOpenclawEnabledForUserMock.mockReset()
    checkOpenclawRateLimitMock.mockReset()
    fetchAutoadsAsUserMock.mockReset()
    recordOpenclawActionMock.mockReset()
    executeOpenclawCommandMock.mockReset()
    resolveOpenclawParentRequestIdMock.mockReset()

    verifyOpenclawGatewayTokenMock.mockResolvedValue(true)
    resolveOpenclawUserFromBindingMock.mockResolvedValue(1001)
    isOpenclawEnabledForUserMock.mockResolvedValue(true)
    recordOpenclawActionMock.mockResolvedValue(undefined)
    resolveOpenclawParentRequestIdMock.mockImplementation(async (params: { explicitParentRequestId?: string }) => {
      return params.explicitParentRequestId
    })
  })

  it('bridges write requests to command executor and keeps sender context', async () => {
    executeOpenclawCommandMock.mockResolvedValue({
      status: 'queued',
      runId: 'run-1',
      taskId: 'task-1',
      riskLevel: 'low',
    })

    const response = await handleOpenclawProxyRequest({
      authHeader: 'Bearer gateway-token',
      request: {
        method: 'POST',
        path: '/api/offers/extract',
        body: { affiliate_link: 'https://example.com/p', target_country: 'US' },
        channel: 'feishu',
        senderId: 'ou_test',
        accountId: 'user-1',
        intent: 'offer.create',
        idempotencyKey: 'idem-1',
        parentRequestId: 'om_message_1',
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-openclaw-proxy-bridge')).toBe('commands-execute')
    expect(await response.json()).toMatchObject({
      success: true,
      bridged: true,
      status: 'queued',
      runId: 'run-1',
    })

    expect(executeOpenclawCommandMock).toHaveBeenCalledWith({
      userId: 1001,
      authType: 'gateway-binding',
      method: 'POST',
      path: '/api/offers/extract',
      query: undefined,
      body: { affiliate_link: 'https://example.com/p', target_country: 'US' },
      channel: 'feishu',
      senderId: 'ou_test',
      intent: 'offer.create',
      idempotencyKey: 'idem-1',
      parentRequestId: 'om_message_1',
    })

    expect(fetchAutoadsAsUserMock).not.toHaveBeenCalled()
  })

  it('returns 202 when bridged write requires confirmation', async () => {
    executeOpenclawCommandMock.mockResolvedValue({
      status: 'pending_confirm',
      runId: 'run-2',
      riskLevel: 'high',
      confirmToken: 'occf_test',
      expiresAt: '2026-02-12T00:00:00.000Z',
    })

    const response = await handleOpenclawProxyRequest({
      authHeader: 'Bearer gateway-token',
      request: {
        method: 'POST',
        path: '/api/campaigns/publish',
        body: { offerId: 1, googleAdsAccountId: 2, campaignConfig: { campaignName: 'A' } },
        channel: 'feishu',
        senderId: 'ou_test',
      },
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      success: true,
      bridged: true,
      status: 'pending_confirm',
      runId: 'run-2',
    })
  })

  it('compacts extract status polling responses and strips heavy result payload', async () => {
    const largeText = 'x'.repeat(12_000)
    fetchAutoadsAsUserMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          taskId: 'task-1',
          status: 'completed',
          stage: 'done',
          progress: 100,
          message: 'ok',
          result: {
            offerId: 3671,
            asin: 'B09DG38RSH',
            brand: 'Dovoh',
            productName: 'Laser Level',
            productPrice: '$79.99',
            finalUrl: 'https://www.amazon.com/dp/B09DG38RSH',
            productDescription: largeText,
            extractedHeadlines: new Array(40).fill('headline'),
          },
          error: null,
          createdAt: '2026-02-18T07:51:00.000Z',
          updatedAt: '2026-02-18T07:51:10.000Z',
          startedAt: '2026-02-18T07:51:01.000Z',
          completedAt: '2026-02-18T07:51:09.000Z',
          recommendedPollIntervalMs: 0,
          streamSupported: true,
          streamUrl: '/api/offers/extract/stream/task-1',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    )

    const response = await handleOpenclawProxyRequest({
      authHeader: 'Bearer gateway-token',
      request: {
        method: 'GET',
        path: '/api/offers/extract/status/task-1',
        channel: 'feishu',
        senderId: 'ou_test',
      },
    })

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.result).toEqual({
      offerId: 3671,
      asin: 'B09DG38RSH',
      brand: 'Dovoh',
      productName: 'Laser Level',
      productPrice: '$79.99',
      finalUrl: 'https://www.amazon.com/dp/B09DG38RSH',
    })
    expect(payload.resultSummary).toEqual(payload.result)
    expect(payload.polling).toEqual({
      terminal: true,
      shouldStop: true,
      status: 'completed',
      nextPollInMs: 0,
      nextRequest: null,
    })
    expect(payload.result.productDescription).toBeUndefined()
    expect(JSON.stringify(payload).length).toBeLessThan(3000)

    expect(recordOpenclawActionMock).toHaveBeenCalledTimes(1)
    const actionLogPayload = recordOpenclawActionMock.mock.calls[0][0]
    expect(String(actionLogPayload.responseBody || '')).toContain('"resultSummary"')
    expect(String(actionLogPayload.responseBody || '')).not.toContain('productDescription')
  })

  it('compacts creative task polling responses and preserves summary counters', async () => {
    const longCreativeText = 'headline-'.repeat(800)
    fetchAutoadsAsUserMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          taskId: 'creative-task-1',
          status: 'running',
          stage: 'generating',
          progress: 70,
          message: '生成中',
          result: {
            success: true,
            adStrength: 'GOOD',
            offer: { id: 3671 },
            creative: {
              id: 991,
              bucket: 'B',
              headlines: [longCreativeText, 'h2', 'h3'],
              descriptions: ['d1', 'd2'],
              keywords: ['k1', 'k2', 'k3', 'k4'],
            },
          },
          error: null,
          createdAt: '2026-02-18T08:01:00.000Z',
          updatedAt: '2026-02-18T08:01:10.000Z',
          recommendedPollIntervalMs: 500,
          streamSupported: true,
          streamUrl: '/api/creative-tasks/creative-task-1/stream',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }
      )
    )

    const response = await handleOpenclawProxyRequest({
      authHeader: 'Bearer gateway-token',
      request: {
        method: 'GET',
        path: '/api/creative-tasks/creative-task-1',
        channel: 'feishu',
        senderId: 'ou_test',
      },
    })

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.result).toEqual({
      success: true,
      offerId: 3671,
      creativeId: 991,
      adStrength: 'GOOD',
      bucket: 'B',
      headlinesCount: 3,
      descriptionsCount: 2,
      keywordsCount: 4,
    })
    expect(payload.resultSummary).toEqual(payload.result)
    expect(payload.polling).toEqual({
      terminal: false,
      shouldStop: false,
      status: 'running',
      nextPollInMs: 2000,
      nextRequest: {
        method: 'GET',
        path: '/api/creative-tasks/creative-task-1',
        query: {
          waitForUpdate: '1',
          lastUpdatedAt: '2026-02-18T08:01:10.000Z',
          timeoutMs: '30000',
        },
      },
    })
    expect(JSON.stringify(payload).length).toBeLessThan(2500)
  })

  it('uses stream timeout for /stream read routes', async () => {
    fetchAutoadsAsUserMock.mockResolvedValue(
      new Response('data: ok\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    )

    const response = await handleOpenclawProxyRequest({
      authHeader: 'Bearer gateway-token',
      request: {
        method: 'GET',
        path: '/api/offers/extract/stream/task-1',
        channel: 'feishu',
        senderId: 'ou_test',
      },
    })

    expect(response.status).toBe(200)
    expect(fetchAutoadsAsUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1001,
        method: 'GET',
        path: '/api/offers/extract/stream/task-1',
        timeoutMs: 30 * 60 * 1000,
      })
    )
  })

  it('keeps standard timeout for non-stream read routes', async () => {
    fetchAutoadsAsUserMock.mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const response = await handleOpenclawProxyRequest({
      authHeader: 'Bearer gateway-token',
      request: {
        method: 'GET',
        path: '/api/campaigns',
        channel: 'feishu',
        senderId: 'ou_test',
      },
    })

    expect(response.status).toBe(200)
    expect(fetchAutoadsAsUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1001,
        method: 'GET',
        path: '/api/campaigns',
        timeoutMs: 45_000,
      })
    )
  })
})
