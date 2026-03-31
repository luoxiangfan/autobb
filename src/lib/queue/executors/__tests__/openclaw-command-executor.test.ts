import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  fetchAutoadsAsUser: vi.fn(),
  recordOpenclawAction: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: mocks.getDatabase,
}))

vi.mock('@/lib/openclaw/autoads-client', () => ({
  fetchAutoadsAsUser: mocks.fetchAutoadsAsUser,
}))

vi.mock('@/lib/openclaw/action-logs', () => ({
  recordOpenclawAction: mocks.recordOpenclawAction,
}))

import { executeOpenclawCommandTask } from '../openclaw-command-executor'

function createTask(runId: string) {
  return {
    id: `task-${runId}`,
    type: 'openclaw-command',
    userId: 1,
    status: 'pending',
    priority: 'normal',
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: 0,
    data: {
      runId,
      userId: 1,
      trigger: 'direct',
    },
  } as any
}

describe('openclaw command executor click-farm guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks click-farm task when offer has no available campaign or recent successful publish', async () => {
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-cf-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'POST',
            request_path: '/api/click-farm/tasks',
            request_query_json: null,
            request_body_json: JSON.stringify({
              offer_id: 3343,
              daily_click_count: 50,
              start_time: '06:00',
              end_time: '24:00',
              duration_days: -1,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        if (sql.includes('FROM campaigns')) {
          return null
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)

    await expect(executeOpenclawCommandTask(createTask('run-cf-1'))).rejects.toThrow(
      '补点击前置校验失败：Offer 3343 缺少可用Campaign，请先成功发布广告'
    )

    expect(mocks.fetchAutoadsAsUser).not.toHaveBeenCalled()
    expect(mocks.recordOpenclawAction).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        action: 'POST /api/click-farm/tasks',
      })
    )
  })

  it('allows click-farm task when same offer has recent successful publish record', async () => {
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs')) {
          return [
            {
              request_body_json: JSON.stringify({ offerId: 3343, adCreativeId: 4331 }),
              completed_at: new Date().toISOString(),
            },
          ]
        }
        return []
      }),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-cf-2',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'POST',
            request_path: '/api/click-farm/tasks',
            request_query_json: null,
            request_body_json: JSON.stringify({
              offer_id: 3343,
              daily_click_count: 50,
              start_time: '06:00',
              end_time: '24:00',
              duration_days: -1,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        if (sql.includes('FROM campaigns')) {
          return null
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-cf-2'))

    expect(result.success).toBe(true)
    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        path: '/api/click-farm/tasks',
        method: 'POST',
      })
    )
    expect(mocks.recordOpenclawAction).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        action: 'POST /api/click-farm/tasks',
      })
    )
  })

  it('does not auto-correct offer.extract commission from historical amount-derived pattern', async () => {
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM offers')) {
          return [
            {
              id: 3689,
              product_price: '$199.99',
              commission_payout: '11.25%',
            },
          ]
        }
        return []
      }),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-offer-fix-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'POST',
            request_path: '/api/offers/extract',
            request_query_json: null,
            request_body_json: JSON.stringify({
              affiliate_link: 'https://yeahpromos.com/index/index/openurlproduct?track=43e8d385119b639d&pid=429324',
              target_country: 'US',
              product_price: '$199.99',
              commission_payout: '22.5%',
              page_type: 'product',
              skipCache: true,
              skipWarmup: false,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true, taskId: 'task-offer-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-offer-fix-1'))
    expect(result.success).toBe(true)

    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/offers/extract',
        method: 'POST',
        body: expect.objectContaining({
          commission_payout: '22.5%',
        }),
      })
    )
  })

  it('does not harmonize offer.extract commission fields before forwarding', async () => {
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-offer-harmonize-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'POST',
            request_path: '/api/offers/extract',
            request_query_json: null,
            request_body_json: JSON.stringify({
              affiliate_link: 'https://yeahpromos.com/index/index/openurlproduct?track=5315fc1b0189c7a1&pid=524366',
              target_country: 'US',
              product_price: '$169.97',
              commission_payout: '30%',
              commission_type: 'percent',
              commission_value: '31.87',
              page_type: 'product',
              skipCache: true,
              skipWarmup: false,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true, taskId: 'task-offer-harmonize-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-offer-harmonize-1'))
    expect(result.success).toBe(true)

    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/offers/extract',
        method: 'POST',
        body: expect.objectContaining({
          commission_payout: '30%',
          commission_type: 'percent',
          commission_value: '31.87',
        }),
      })
    )
  })

  it('hydrates missing offer.extract commission from feishu message context', async () => {
    const affiliateLink = 'https://yeahpromos.com/index/index/openurlproduct?track=fc03db0d2f9009e7&pid=1044718'
    const parentRequestId = 'om_x100b56df905d20a4b3dda1c847084b4'
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-offer-message-hydrate-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            parent_request_id: parentRequestId,
            request_method: 'POST',
            request_path: '/api/offers/extract',
            request_query_json: null,
            request_body_json: JSON.stringify({
              affiliate_link: affiliateLink,
              target_country: 'US',
              product_price: '$129.99',
              page_type: 'product',
              skipCache: true,
              skipWarmup: false,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_feishu_chat_health_logs')) {
          return {
            message_text: [
              '联盟平台 MID 品牌 ASIN 投放国家 商品价格 佣金比例 推广链接',
              `YeahPromos 380545 PurSteam B0DD97JZ15 US $129.99 15% ${affiliateLink}`,
            ].join('\n'),
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true, taskId: 'task-offer-message-hydrate-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-offer-message-hydrate-1'))
    expect(result.success).toBe(true)

    const calledBody = mocks.fetchAutoadsAsUser.mock.calls[0][0].body
    expect(calledBody.commission_payout).toBe('15%')
    expect(calledBody.commission_type).toBe('percent')
    expect(calledBody.commission_value).toBe('15')
  })

  it('corrects mismatched offer.extract commission from feishu message context', async () => {
    const affiliateLink = 'https://yeahpromos.com/index/index/openurlproduct?track=5c127e3c2c6ab88e&pid=408015'
    const parentRequestId = 'om_x100b56d9b760c8a8b2675b2dc187931'
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-offer-message-correct-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            parent_request_id: parentRequestId,
            request_method: 'POST',
            request_path: '/api/offers/extract',
            request_query_json: null,
            request_body_json: JSON.stringify({
              affiliate_link: affiliateLink,
              target_country: 'US',
              product_price: '$179.99',
              page_type: 'product',
              commission_payout: '15%',
              commission_type: 'percent',
              commission_value: '15',
              skipCache: true,
              skipWarmup: false,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_feishu_chat_health_logs')) {
          return {
            message_text: [
              '联盟平台 MID 品牌 ASIN 投放国家 商品价格 佣金比例 推广链接',
              `YeahPromos 362178 Hcalory B0FH9ZPMHP US $179.99 9% ${affiliateLink}`,
            ].join('\n'),
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true, taskId: 'task-offer-message-correct-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-offer-message-correct-1'))
    expect(result.success).toBe(true)

    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/offers/extract',
        method: 'POST',
        body: expect.objectContaining({
          commission_payout: '9%',
          commission_type: 'percent',
          commission_value: '9',
        }),
      })
    )
  })

  it('overrides offer.extract commission with message-context value when mismatched', async () => {
    const affiliateLink = 'https://yeahpromos.com/index/index/openurlproduct?track=ebb4d552075a7ef5&pid=732114'
    const parentRequestId = 'om_test_source_override_guard'
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM affiliate_products')) {
          return [
            {
              id: 2800191,
              platform: 'yeahpromos',
              promo_link: affiliateLink,
              short_promo_link: null,
              commission_rate: 15,
            },
          ]
        }
        if (sql.includes('FROM offers')) {
          return []
        }
        return []
      }),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-offer-message-priority-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            parent_request_id: parentRequestId,
            request_method: 'POST',
            request_path: '/api/offers/extract',
            request_query_json: null,
            request_body_json: JSON.stringify({
              affiliate_link: affiliateLink,
              target_country: 'US',
              product_price: '$179.99',
              commission_payout: '15%',
              commission_type: 'percent',
              commission_value: '15',
              page_type: 'product',
              skipCache: true,
              skipWarmup: false,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_feishu_chat_health_logs')) {
          return {
            message_text: [
              '联盟平台 MID 品牌 ASIN 投放国家 商品价格 佣金比例 推广链接',
              `YeahPromos 363225 DOVOH B09DG38RSH US $179.99 30% ${affiliateLink}`,
            ].join('\n'),
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true, taskId: 'task-offer-message-priority-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-offer-message-priority-1'))
    expect(result.success).toBe(true)

    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/offers/extract',
        method: 'POST',
        body: expect.objectContaining({
          commission_payout: '30%',
          commission_type: 'percent',
          commission_value: '30',
        }),
      })
    )
  })

  it('converts amount-style offer.extract commission to message-context percentage', async () => {
    const affiliateLink = 'https://yeahpromos.com/index/index/openurlproduct?track=3ee0ff3ca7d17921&pid=485084'
    const parentRequestId = 'om_x100b55228ca8f0acc3274c1b0e0fac9'
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-offer-amount-to-percent-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            parent_request_id: parentRequestId,
            request_method: 'POST',
            request_path: '/api/offers/extract',
            request_query_json: null,
            request_body_json: JSON.stringify({
              affiliate_link: affiliateLink,
              target_country: 'US',
              brand_name: 'PetSafe',
              product_price: '$549.99',
              commission_payout: '$57.75',
              commission_type: 'amount',
              commission_value: '57.75',
              commission_currency: 'USD',
              page_type: 'product',
              skipCache: true,
              skipWarmup: false,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_feishu_chat_health_logs')) {
          return {
            message_text: [
              '联盟平台 MID 品牌 ASIN 投放国家 商品价格 佣金比例 推广链接',
              `YeahPromos 362292 PetSafe B0DTHVL2DW US $549.99 10.50% ${affiliateLink}`,
            ].join('\n'),
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true, taskId: 'task-offer-amount-to-percent-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-offer-amount-to-percent-1'))
    expect(result.success).toBe(true)

    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/offers/extract',
        method: 'POST',
        body: expect.objectContaining({
          commission_payout: '10.5%',
          commission_type: 'percent',
          commission_value: '10.5',
        }),
      })
    )

    // converted to percent mode should clear currency
    const calledBody = mocks.fetchAutoadsAsUser.mock.calls[0][0].body
    expect(calledBody.commission_currency).toBeUndefined()
  })

  it('corrects offer.update amount-style commission from feishu message context', async () => {
    const affiliateLink = 'https://yeahpromos.com/index/index/openurlproduct?track=5c127e3c2c6ab88e&pid=408015'
    const parentRequestId = 'om_x100b56d9b760c8a8b2675b2dc187931'
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-offer-update-message-correct-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            parent_request_id: parentRequestId,
            request_method: 'PUT',
            request_path: '/api/offers/3889',
            request_query_json: null,
            request_body_json: JSON.stringify({
              product_price: '179.99',
              commission_payout: '16.20',
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('SELECT affiliate_link, target_country') && sql.includes('FROM offers')) {
          return {
            affiliate_link: affiliateLink,
            target_country: 'US',
          }
        }

        if (sql.includes('FROM openclaw_feishu_chat_health_logs')) {
          return {
            message_text: [
              '联盟平台 MID 品牌 ASIN 投放国家 商品价格 佣金比例 推广链接',
              `YeahPromos 362178 Hcalory B0FH9ZPMHP US $179.99 9% ${affiliateLink}`,
            ].join('\n'),
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true, offer: { id: 3889 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-offer-update-message-correct-1'))
    expect(result.success).toBe(true)

    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/offers/3889',
        method: 'PUT',
        body: expect.objectContaining({
          product_price: '179.99',
          commission_payout: '9%',
          commission_type: 'percent',
          commission_value: '9',
        }),
      })
    )
  })

  it('does not auto-correct offer.extract commission from affiliate_products source', async () => {
    const affiliateLink = 'https://yeahpromos.com/index/index/openurlproduct?track=d75ea6f3305ebf16&pid=727678'
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM affiliate_products')) {
          return [
            {
              id: 9001,
              platform: 'yeahpromos',
              promo_link: affiliateLink,
              short_promo_link: null,
              commission_rate: 12.75,
            },
          ]
        }
        if (sql.includes('FROM offers')) {
          return []
        }
        return []
      }),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-offer-fix-source-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'POST',
            request_path: '/api/offers/extract',
            request_query_json: null,
            request_body_json: JSON.stringify({
              affiliate_link: affiliateLink,
              target_country: 'US',
              product_price: '$129.99',
              commission_payout: '16.57%',
              page_type: 'product',
              skipCache: true,
              skipWarmup: false,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true, taskId: 'task-offer-source-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-offer-fix-source-1'))
    expect(result.success).toBe(true)

    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/offers/extract',
        method: 'POST',
        body: expect.objectContaining({
          commission_payout: '16.57%',
        }),
      })
    )
  })

  it('does not auto-correct offer.extract commission from yeahpromos track-only source match', async () => {
    const affiliateLink = 'https://yeahpromos.com/index/index/openurlproduct?track=d7d9484735a4d807&pid=763996'
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM affiliate_products')) {
          return [
            {
              id: 9201,
              platform: 'yeahpromos',
              promo_link: 'https://yeahpromos.com/index/index/openurl?track=d7d9484735a4d807&url=',
              short_promo_link: null,
              commission_rate: 22.5,
            },
          ]
        }
        if (sql.includes('FROM offers')) {
          return []
        }
        return []
      }),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-offer-fix-source-track-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'POST',
            request_path: '/api/offers/extract',
            request_query_json: null,
            request_body_json: JSON.stringify({
              affiliate_link: affiliateLink,
              target_country: 'US',
              product_price: '$44.95',
              commission_payout: '10.11%',
              page_type: 'product',
              skipCache: true,
              skipWarmup: false,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true, taskId: 'task-offer-source-track-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-offer-fix-source-track-1'))
    expect(result.success).toBe(true)

    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/offers/extract',
        method: 'POST',
        body: expect.objectContaining({
          commission_payout: '10.11%',
        }),
      })
    )
  })

  it('does not auto-correct suspicious yeahpromos amount-derived percent by heuristic', async () => {
    const affiliateLink = 'https://yeahpromos.com/index/index/openurlproduct?track=test-track&pid=740178'
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM affiliate_products')) {
          return []
        }
        if (sql.includes('FROM offers')) {
          return []
        }
        return []
      }),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-offer-fix-heuristic-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'POST',
            request_path: '/api/offers/extract',
            request_query_json: null,
            request_body_json: JSON.stringify({
              affiliate_link: affiliateLink,
              target_country: 'US',
              product_price: '$22.99',
              commission_payout: '5.17%',
              page_type: 'product',
              skipCache: true,
              skipWarmup: false,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true, taskId: 'task-offer-heuristic-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-offer-fix-heuristic-1'))
    expect(result.success).toBe(true)

    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/offers/extract',
        method: 'POST',
        body: expect.objectContaining({
          commission_payout: '5.17%',
        }),
      })
    )
  })

  it('does not auto-correct low-rate amount-derived percent for high-price yeahpromos offers', async () => {
    const affiliateLink = 'https://yeahpromos.com/index/index/openurlproduct?track=3117168dd1120720&pid=435374'
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM affiliate_products')) {
          return []
        }
        if (sql.includes('FROM offers')) {
          return []
        }
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('parent_request_id')) {
          return []
        }
        return []
      }),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-offer-fix-heuristic-low-rate-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            parent_request_id: 'om_parent_low_rate',
            request_method: 'POST',
            request_path: '/api/offers/extract',
            request_query_json: null,
            request_body_json: JSON.stringify({
              affiliate_link: affiliateLink,
              target_country: 'US',
              product_price: '$157.48',
              commission_payout: '11.81%',
              page_type: 'product',
              skipCache: true,
              skipWarmup: false,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true, taskId: 'task-offer-heuristic-low-rate-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-offer-fix-heuristic-low-rate-1'))
    expect(result.success).toBe(true)

    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/offers/extract',
        method: 'POST',
        body: expect.objectContaining({
          commission_payout: '11.81%',
        }),
      })
    )
  })

  it('does not auto-correct quarter percent via sibling consensus amount-derived pattern', async () => {
    const parentRequestId = 'om_x100b569a1d988ca8c3454b17cf79415'
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM affiliate_products')) {
          return []
        }
        if (sql.includes('FROM offers')) {
          return []
        }
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('parent_request_id')) {
          return [
            {
              id: 'run-offer-fix-sibling-anchor',
              request_body_json: JSON.stringify({
                affiliate_link: 'https://yeahpromos.com/index/index/openurlproduct?track=3117168dd1120720&pid=435374',
                target_country: 'US',
                product_price: '$157.48',
                commission_payout: '11.81%',
                page_type: 'product',
                skipCache: true,
                skipWarmup: false,
              }),
            },
          ]
        }
        return []
      }),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-offer-fix-sibling-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            parent_request_id: parentRequestId,
            request_method: 'POST',
            request_path: '/api/offers/extract',
            request_query_json: null,
            request_body_json: JSON.stringify({
              affiliate_link: 'https://yeahpromos.com/index/index/openurlproduct?track=3117168dd1120720&pid=584359',
              target_country: 'US',
              product_price: '$299.99',
              commission_payout: '22.5%',
              page_type: 'product',
              skipCache: true,
              skipWarmup: false,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true, taskId: 'task-offer-sibling-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-offer-fix-sibling-1'))
    expect(result.success).toBe(true)

    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/offers/extract',
        method: 'POST',
        body: expect.objectContaining({
          commission_payout: '22.5%',
        }),
      })
    )
  })

  it('does not apply yeahpromos heuristic to already-standard percent values', async () => {
    const affiliateLink = 'https://yeahpromos.com/index/index/openurlproduct?track=test-track&pid=1005965'
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM affiliate_products')) {
          return []
        }
        if (sql.includes('FROM offers')) {
          return []
        }
        return []
      }),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-offer-fix-heuristic-2',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'POST',
            request_path: '/api/offers/extract',
            request_query_json: null,
            request_body_json: JSON.stringify({
              affiliate_link: affiliateLink,
              target_country: 'US',
              product_price: '$22.99',
              commission_payout: '7.5%',
              page_type: 'product',
              skipCache: true,
              skipWarmup: false,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true, taskId: 'task-offer-heuristic-2' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-offer-fix-heuristic-2'))
    expect(result.success).toBe(true)

    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/offers/extract',
        method: 'POST',
        body: expect.objectContaining({
          commission_payout: '7.5%',
        }),
      })
    )
  })

  it('hydrates campaign.publish payload with fallback keywords before forwarding', async () => {
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-pub-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'POST',
            request_path: '/api/campaigns/publish',
            request_query_json: null,
            request_body_json: JSON.stringify({
              offerId: 3343,
              adCreativeId: 4331,
              googleAdsAccountId: 999,
              campaignConfig: {
                budget_amount: 10,
                budget_type: 'DAILY',
                target_country: 'US',
                target_language: 'en',
                bidding_strategy: 'MAXIMIZE_CLICKS',
                max_cpc_bid: 0.2,
              },
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        if (sql.includes('FROM ad_creatives')) {
          return {
            id: 4331,
            keywords: JSON.stringify(['sonic toothbrush', 'electric toothbrush']),
            negative_keywords: JSON.stringify(['manual', 'free']),
          }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-pub-1'))

    expect(result.success).toBe(true)
    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/campaigns/publish',
        method: 'POST',
        body: expect.objectContaining({
          campaignConfig: expect.objectContaining({
            targetCountry: 'US',
            keywords: [
              { text: 'sonic toothbrush', matchType: 'EXACT' },
              { text: 'electric toothbrush', matchType: 'PHRASE' },
            ],
            negativeKeywords: ['manual', 'free'],
          }),
        }),
      })
    )

    const forwardedBody = (mocks.fetchAutoadsAsUser.mock.calls[0]?.[0] as any)?.body || {}
    expect(forwardedBody.campaignConfig?.target_country).toBeUndefined()
    expect(forwardedBody.campaignConfig?.budget_amount).toBeUndefined()
  })

  it('applies web defaults for campaign.publish when params are omitted', async () => {
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-pub-default-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'POST',
            request_path: '/api/campaigns/publish',
            request_query_json: null,
            request_body_json: JSON.stringify({
              offerId: 3343,
              adCreativeId: 4331,
              googleAdsAccountId: 999,
              campaignConfig: {},
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        if (sql.includes('FROM offers')) {
          return {
            url: 'https://offer.example.com',
            target_country: 'US',
            target_language: 'en',
          }
        }

        if (sql.includes('FROM google_ads_accounts')) {
          return {
            currency: 'USD',
          }
        }

        if (sql.includes('FROM ad_creatives')) {
          return {
            id: 4331,
            keywords: JSON.stringify(['fallback keyword']),
            keywords_with_volume: JSON.stringify([
              { keyword: 'Water Flosser' },
              { keyword: 'Sonic Toothbrush' },
            ]),
            negative_keywords: JSON.stringify(['free', 'manual', 'FREE']),
            final_url: 'https://creative.example.com',
            final_url_suffix: 'src=openclaw',
          }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-pub-default-1'))
    expect(result.success).toBe(true)

    const forwardedBody = (mocks.fetchAutoadsAsUser.mock.calls[0]?.[0] as any)?.body || {}
    expect(forwardedBody.campaignConfig).toMatchObject({
      budgetAmount: 10,
      budgetType: 'DAILY',
      targetCountry: 'US',
      targetLanguage: 'en',
      biddingStrategy: 'MAXIMIZE_CLICKS',
      marketingObjective: 'WEB_TRAFFIC',
      maxCpcBid: 0.17,
      finalUrlSuffix: 'src=openclaw',
      finalUrls: ['https://creative.example.com'],
      keywords: [
        { text: 'Water Flosser', matchType: 'EXACT' },
        { text: 'Sonic Toothbrush', matchType: 'PHRASE' },
      ],
      negativeKeywords: ['free', 'manual'],
    })
    expect(forwardedBody.campaignConfig?.negativeKeywordMatchType?.free).toBeDefined()
    expect(forwardedBody.campaignConfig?.negativeKeywordMatchType?.manual).toBeDefined()
  })

  it('rejects campaign.publish when explicit finalUrls violate web ownership', async () => {
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-pub-final-url-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'POST',
            request_path: '/api/campaigns/publish',
            request_query_json: null,
            request_body_json: JSON.stringify({
              offerId: 3343,
              adCreativeId: 4331,
              googleAdsAccountId: 999,
              campaignConfig: {
                budgetAmount: 10,
                budgetType: 'DAILY',
                targetCountry: 'US',
                targetLanguage: 'en',
                biddingStrategy: 'MAXIMIZE_CLICKS',
                maxCpcBid: 0.2,
                finalUrls: ['https://pboost.me/demo'],
              },
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        if (sql.includes('FROM offers')) {
          return {
            url: 'https://offer.example.com',
            final_url: 'https://offer-final.example.com/landing',
            final_url_suffix: 'offer_suffix=1',
            target_country: 'US',
            target_language: 'en',
          }
        }

        if (sql.includes('FROM google_ads_accounts')) {
          return {
            currency: 'USD',
          }
        }

        if (sql.includes('FROM ad_creatives')) {
          return {
            id: 4331,
            keywords: JSON.stringify(['fallback keyword']),
            keywords_with_volume: JSON.stringify([{ keyword: 'Water Flosser' }]),
            negative_keywords: JSON.stringify(['free']),
            final_url: 'https://creative.example.com/pdp',
            final_url_suffix: 'creative_suffix=1',
          }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    await expect(executeOpenclawCommandTask(createTask('run-pub-final-url-1'))).rejects.toThrow(
      'campaign.publish URL字段归属校验失败'
    )
    expect(mocks.fetchAutoadsAsUser).not.toHaveBeenCalled()
    expect(mocks.recordOpenclawAction).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        action: 'POST /api/campaigns/publish',
      })
    )
  })

  it('rejects update-cpc when path id is local campaign id instead of googleCampaignId', async () => {
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-cpc-local-id-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'PUT',
            request_path: '/api/campaigns/1972/update-cpc',
            request_query_json: null,
            request_body_json: JSON.stringify({
              newCpc: 0.2,
            }),
            risk_level: 'high',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        if (sql.includes('google_campaign_id = ?')) {
          return null
        }

        if (sql.includes('FROM campaigns')) {
          return {
            id: 1972,
            campaign_id: '23578044853',
            google_campaign_id: '23578044853',
            status: 'ENABLED',
            is_deleted: false,
          }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    await expect(executeOpenclawCommandTask(createTask('run-cpc-local-id-1'))).rejects.toThrow(
      'update-cpc 的 :id 必须是 googleCampaignId'
    )

    expect(mocks.fetchAutoadsAsUser).not.toHaveBeenCalled()
    expect(mocks.recordOpenclawAction).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        action: 'PUT /api/campaigns/1972/update-cpc',
      })
    )
  })

  it('rejects update-budget when path id is local campaign id instead of googleCampaignId', async () => {
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-budget-local-id-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'PUT',
            request_path: '/api/campaigns/1972/update-budget',
            request_query_json: null,
            request_body_json: JSON.stringify({
              budgetAmount: 18,
              budgetType: 'DAILY',
            }),
            risk_level: 'high',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        if (sql.includes('google_campaign_id = ?')) {
          return null
        }

        if (sql.includes('FROM campaigns')) {
          return {
            id: 1972,
            campaign_id: '23578044853',
            google_campaign_id: '23578044853',
            status: 'ENABLED',
            is_deleted: false,
          }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    await expect(executeOpenclawCommandTask(createTask('run-budget-local-id-1'))).rejects.toThrow(
      'update-budget 的 :id 必须是 googleCampaignId'
    )

    expect(mocks.fetchAutoadsAsUser).not.toHaveBeenCalled()
    expect(mocks.recordOpenclawAction).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        action: 'PUT /api/campaigns/1972/update-budget',
      })
    )
  })

  it('rejects toggle-status when path id is googleCampaignId instead of local campaign id', async () => {
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-toggle-google-id-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'PUT',
            request_path: '/api/campaigns/23578044853/toggle-status',
            request_query_json: null,
            request_body_json: JSON.stringify({
              status: 'PAUSED',
            }),
            risk_level: 'high',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        // local id 不存在
        if (sql.includes('AND id = ?')) {
          return null
        }

        // 但作为 google_campaign_id 可以命中
        if (sql.includes('google_campaign_id = ?')) {
          return {
            id: 1972,
            campaign_id: '23578044853',
            google_campaign_id: '23578044853',
          }
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    await expect(executeOpenclawCommandTask(createTask('run-toggle-google-id-1'))).rejects.toThrow(
      '必须是本地 campaign.id'
    )

    expect(mocks.fetchAutoadsAsUser).not.toHaveBeenCalled()
    expect(mocks.recordOpenclawAction).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        action: 'PUT /api/campaigns/23578044853/toggle-status',
      })
    )
  })
})
