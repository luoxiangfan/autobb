import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
  execMock: vi.fn(),
  fetchAutoadsJsonMock: vi.fn(),
  invokeOpenclawToolMock: vi.fn(),
  resolveUserFeishuAccountIdMock: vi.fn(),
  writeDailyReportToBitableMock: vi.fn(),
  writeDailyReportToDocMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: async () => ({
    type: 'sqlite',
    query: hoisted.queryMock,
    queryOne: hoisted.queryOneMock,
    exec: hoisted.execMock,
  }),
}))

vi.mock('@/lib/openclaw/autoads-client', () => ({
  fetchAutoadsJson: hoisted.fetchAutoadsJsonMock,
}))

vi.mock('@/lib/openclaw/gateway', () => ({
  invokeOpenclawTool: hoisted.invokeOpenclawToolMock,
}))

vi.mock('@/lib/openclaw/feishu-accounts', () => ({
  resolveUserFeishuAccountId: hoisted.resolveUserFeishuAccountIdMock,
}))

vi.mock('@/lib/openclaw/feishu-docs', () => ({
  writeDailyReportToBitable: hoisted.writeDailyReportToBitableMock,
  writeDailyReportToDoc: hoisted.writeDailyReportToDocMock,
}))

import { sendDailyReportToFeishu } from './reports'

describe('sendDailyReportToFeishu', () => {
  const cachedReportPayload = {
    date: '2026-02-14',
    generatedAt: '2026-02-14T01:02:03.000Z',
  }

  beforeEach(() => {
    hoisted.queryMock.mockReset()
    hoisted.queryOneMock.mockReset()
    hoisted.execMock.mockReset()
    hoisted.fetchAutoadsJsonMock.mockReset()
    hoisted.invokeOpenclawToolMock.mockReset()
    hoisted.resolveUserFeishuAccountIdMock.mockReset()
    hoisted.writeDailyReportToBitableMock.mockReset()
    hoisted.writeDailyReportToDocMock.mockReset()

    hoisted.queryMock.mockResolvedValue([])
    hoisted.execMock.mockResolvedValue({ changes: 1 })
    hoisted.fetchAutoadsJsonMock.mockResolvedValue({})
    hoisted.invokeOpenclawToolMock.mockResolvedValue({ ok: true })
    hoisted.resolveUserFeishuAccountIdMock.mockResolvedValue(null)
    hoisted.writeDailyReportToBitableMock.mockResolvedValue(undefined)
    hoisted.writeDailyReportToDocMock.mockResolvedValue(undefined)
  })

  it('skips duplicate delivery when same task already marked as sent', async () => {
    hoisted.queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT payload_json FROM openclaw_daily_reports')) {
        return { payload_json: JSON.stringify(cachedReportPayload) }
      }
      if (sql.includes('SELECT sent_status, last_delivery_task_id')) {
        return { sent_status: 'sent', last_delivery_task_id: 'delivery-1' }
      }
      return undefined
    })

    await sendDailyReportToFeishu({
      userId: 7,
      target: 'ou_xxx',
      date: '2026-02-14',
      deliveryTaskId: 'delivery-1',
    })

    expect(hoisted.execMock).toHaveBeenCalledTimes(1)
    expect(String(hoisted.execMock.mock.calls[0]?.[0] || '')).toContain('SET payload_json')
    expect(hoisted.invokeOpenclawToolMock).not.toHaveBeenCalled()
    expect(hoisted.writeDailyReportToBitableMock).not.toHaveBeenCalled()
    expect(hoisted.writeDailyReportToDocMock).not.toHaveBeenCalled()
  })

  it('passes deterministic idempotency key to gateway when delivery task id is provided', async () => {
    hoisted.queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT payload_json FROM openclaw_daily_reports')) {
        return { payload_json: JSON.stringify(cachedReportPayload) }
      }
      if (sql.includes('SELECT sent_status, last_delivery_task_id')) {
        return { sent_status: 'pending', last_delivery_task_id: 'delivery-0' }
      }
      return undefined
    })

    await sendDailyReportToFeishu({
      userId: 7,
      target: 'ou_xxx',
      date: '2026-02-14',
      deliveryTaskId: 'delivery-2',
    })

    expect(hoisted.invokeOpenclawToolMock).toHaveBeenCalledTimes(1)
    expect(hoisted.invokeOpenclawToolMock.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: 'daily-report:7:2026-02-14:ou_xxx:delivery-2',
    })
  })

  it('coalesces concurrent delivery calls for same delivery task id', async () => {
    hoisted.queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT payload_json FROM openclaw_daily_reports')) {
        return { payload_json: JSON.stringify(cachedReportPayload) }
      }
      if (sql.includes('SELECT sent_status, last_delivery_task_id')) {
        return { sent_status: 'pending', last_delivery_task_id: 'delivery-0' }
      }
      return undefined
    })
    hoisted.invokeOpenclawToolMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15))
      return { ok: true }
    })

    const params = {
      userId: 7,
      target: 'ou_xxx',
      date: '2026-02-14',
      deliveryTaskId: 'delivery-3',
    }
    await Promise.all([
      sendDailyReportToFeishu(params),
      sendDailyReportToFeishu(params),
    ])

    expect(hoisted.invokeOpenclawToolMock).toHaveBeenCalledTimes(1)
    expect(hoisted.writeDailyReportToBitableMock).toHaveBeenCalledTimes(1)
    expect(hoisted.writeDailyReportToDocMock).toHaveBeenCalledTimes(1)
    expect(hoisted.execMock).toHaveBeenCalledTimes(3)
  })

  it('formats daily report message with aligned daily metrics and clear conversion labels', async () => {
    hoisted.queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT payload_json FROM openclaw_daily_reports')) {
        return {
          payload_json: JSON.stringify({
            date: '2026-02-22',
            generatedAt: '2026-02-22T09:00:00.000Z',
            summary: {
              kpis: {
                totalOffers: 13,
                totalCampaigns: 15,
                totalClicks: 185,
                totalCost: 132.706319,
              },
            },
            kpis: {
              data: {
                current: {
                  impressions: 1707,
                  clicks: 185,
                  cost: 132.706319,
                  conversions: 38.52,
                },
              },
            },
            dailySnapshot: {
              impressions: 1707,
              clicks: 185,
              cost: 41.21,
              conversions: 38.52,
            },
            roi: {
              data: {
                overall: {
                  totalCost: 41.21,
                  totalRevenue: 0,
                  totalProfit: -41.21,
                  roi: -100,
                  roas: 0,
                  conversions: 38.52,
                  revenueAvailable: true,
                  affiliateBreakdown: [
                    { platform: 'partnerboost', totalCommission: 0, records: 0 },
                    { platform: 'yeahpromos', totalCommission: 0, records: 0 },
                  ],
                  affiliateAttribution: {
                    writtenRows: 0,
                  },
                },
              },
            },
            budget: {
              data: {
                overall: {
                  totalBudget: 123.33,
                  totalSpent: 41.21,
                  remaining: 82.12,
                },
              },
            },
          }),
        }
      }
      return undefined
    })

    await sendDailyReportToFeishu({
      userId: 7,
      target: 'ou_xxx',
      date: '2026-02-22',
    })

    const message = String(hoisted.invokeOpenclawToolMock.mock.calls[0]?.[0]?.args?.message || '')
    expect(message).toContain('- 投放消耗：点击 185 次｜花费 41.21 USD')
    expect(message).toContain('- 当日表现：曝光 1707｜转化（Google Ads）38.52｜联盟佣金记录 0')
    expect(message).toContain('- 预算概览：预算 123.33 USD｜已花费 41.21 USD｜剩余 82.12 USD')
    expect(message).not.toContain('转化/佣金笔数')
  })

  it('includes all currencies in spend and budget sections when budget payload is mixed-currency', async () => {
    hoisted.queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT payload_json FROM openclaw_daily_reports')) {
        return {
          payload_json: JSON.stringify({
            date: '2026-02-23',
            generatedAt: '2026-02-23T09:00:00.000Z',
            summary: {
              kpis: {
                totalOffers: 5,
                totalCampaigns: 7,
              },
            },
            dailySnapshot: {
              impressions: 900,
              clicks: 66,
              cost: 15,
              conversions: 2,
            },
            roi: {
              data: {
                overall: {
                  totalCost: 15,
                  totalRevenue: 0,
                  totalProfit: -15,
                  roi: -100,
                  roas: 0,
                  conversions: 2,
                  revenueAvailable: true,
                  affiliateBreakdown: [],
                  affiliateAttribution: {
                    writtenRows: 0,
                  },
                },
              },
            },
            budget: {
              currency: 'CNY',
              currencies: ['CNY', 'USD'],
              hasMixedCurrency: true,
              data: {
                overall: {
                  totalBudget: 130,
                  totalSpent: 0,
                  remaining: 130,
                },
              },
              multiCurrencyOverall: [
                {
                  currency: 'CNY',
                  totalBudget: 130,
                  totalSpent: 0,
                  remaining: 130,
                },
                {
                  currency: 'USD',
                  totalBudget: 75,
                  totalSpent: 15,
                  remaining: 60,
                },
              ],
            },
          }),
        }
      }
      return undefined
    })

    await sendDailyReportToFeishu({
      userId: 7,
      target: 'ou_xxx',
      date: '2026-02-23',
    })

    const message = String(hoisted.invokeOpenclawToolMock.mock.calls[0]?.[0]?.args?.message || '')
    expect(message).toContain('- 投放消耗：点击 66 次｜花费 0 CNY｜15 USD')
    expect(message).toContain('- 预算概览（多币种）：CNY：预算 130 CNY｜已花费 0 CNY｜剩余 130 CNY；USD：预算 75 USD｜已花费 15 USD｜剩余 60 USD')
  })

  it('expands cached mixed-currency roi summary by currency', async () => {
    hoisted.queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT payload_json FROM openclaw_daily_reports')) {
        return {
          payload_json: JSON.stringify({
            date: '2026-02-24',
            generatedAt: '2026-02-24T09:00:00.000Z',
            summary: {
              kpis: {
                totalOffers: 5,
                totalCampaigns: 7,
              },
            },
            dailySnapshot: {
              impressions: 900,
              clicks: 66,
              cost: 15,
              conversions: 2,
            },
            roi: {
              currency: 'CNY',
              data: {
                overall: {
                  totalCost: 15,
                  totalRevenue: 25,
                  totalProfit: 10,
                  roi: 66.67,
                  roas: 1.67,
                  conversions: 2,
                  revenueAvailable: true,
                  affiliateBreakdown: [
                    { platform: 'partnerboost', totalCommission: 0, records: 0, currency: 'CNY' },
                    { platform: 'yeahpromos', totalCommission: 25, records: 2, currency: 'USD' },
                  ],
                  affiliateAttribution: {
                    writtenRows: 2,
                  },
                },
              },
            },
            budget: {
              currency: 'CNY',
              currencies: ['CNY', 'USD'],
              hasMixedCurrency: true,
              data: {
                overall: {
                  totalBudget: 130,
                  totalSpent: 0,
                  remaining: 130,
                },
              },
            },
          }),
        }
      }
      return undefined
    })
    hoisted.fetchAutoadsJsonMock.mockImplementation(async ({ query }: { query?: Record<string, string> }) => {
      if (query?.currency === 'CNY') {
        return {
          currency: 'CNY',
          data: {
            overall: {
              totalBudget: 130,
              totalSpent: 0,
              remaining: 130,
            },
          },
        }
      }
      if (query?.currency === 'USD') {
        return {
          currency: 'USD',
          data: {
            overall: {
              totalBudget: 75,
              totalSpent: 15,
              remaining: 60,
            },
          },
        }
      }
      return {}
    })

    await sendDailyReportToFeishu({
      userId: 7,
      target: 'ou_xxx',
      date: '2026-02-24',
    })

    const message = String(hoisted.invokeOpenclawToolMock.mock.calls[0]?.[0]?.args?.message || '')
    expect(hoisted.fetchAutoadsJsonMock).toHaveBeenCalledTimes(2)
    expect(message).toContain('- ROI概览（多币种）：CNY：佣金 0 CNY｜花费 0 CNY｜利润 0 CNY；USD：佣金 25 USD｜花费 15 USD｜利润 10 USD')
    expect(message).toContain('- 回报率（多币种）：CNY：ROAS 暂不可用｜ROI 暂不可用；USD：ROAS 1.67x｜ROI 66.67%')
    expect(message).toContain('- 预算概览（多币种）：CNY：预算 130 CNY｜已花费 0 CNY｜剩余 130 CNY；USD：预算 75 USD｜已花费 15 USD｜剩余 60 USD')
    expect(message).not.toContain('- 佣金收入：25 MIXED')
  })

  it('includes top strategy recommendations in daily report message', async () => {
    hoisted.queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT payload_json FROM openclaw_daily_reports')) {
        return {
          payload_json: JSON.stringify({
            date: '2026-02-22',
            generatedAt: '2026-02-22T09:00:00.000Z',
            summary: { kpis: { totalOffers: 3, totalCampaigns: 8 } },
            dailySnapshot: { impressions: 1000, clicks: 88, cost: 21, conversions: 0 },
            roi: {
              data: {
                overall: {
                  totalCost: 21,
                  totalRevenue: 0,
                  totalProfit: -21,
                  roi: -100,
                  roas: 0,
                  revenueAvailable: true,
                  affiliateBreakdown: [],
                  affiliateAttribution: { writtenRows: 0 },
                },
              },
            },
            strategyRecommendations: [
              {
                id: 'r1',
                recommendationType: 'offline_campaign',
                priorityScore: 95.2,
                status: 'pending',
                summary: '建议下线该 Campaign，停止低价值占用并回收预算。',
                campaignId: 11,
                data: { campaignName: 'Dovoh_3679', impactConfidenceReason: '样本：曝光 1000 / 点击 88 / 花费 21.00 / ROAS 0.00' },
              },
              {
                id: 'r2',
                recommendationType: 'adjust_cpc',
                priorityScore: 83.5,
                status: 'pending',
                summary: '建议CPC = 商品价格 × 佣金比例 ÷ 50 = 0.80。',
                campaignId: 12,
                data: { campaignName: 'Renpho_3709' },
              },
              {
                id: 'r3',
                recommendationType: 'adjust_budget',
                priorityScore: 99.9,
                status: 'dismissed',
                summary: '该条应被过滤，不应出现在TOP建议里。',
                campaignId: 13,
                data: { campaignName: 'Filtered_Out' },
              },
            ],
          }),
        }
      }
      return undefined
    })

    await sendDailyReportToFeishu({
      userId: 7,
      target: 'ou_xxx',
      date: '2026-02-22',
    })

    const message = String(hoisted.invokeOpenclawToolMock.mock.calls[0]?.[0]?.args?.message || '')
    expect(message).toContain('建议状态：总 3｜待执行 2｜已执行 0｜执行失败 0｜待重算 0｜暂不执行 1')
    expect(message).toContain('优化建议TOP2（按优先级分排序）')
    expect(message).toContain('[下线Campaign] Dovoh_3679｜优先级分 95.2')
    expect(message).toContain('[CPC调整] Renpho_3709｜优先级分 83.5')
    expect(message).not.toContain('Filtered_Out')
  })

  it('shows affiliate reconciliation gap and top failure reasons in daily report message', async () => {
    hoisted.queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT payload_json FROM openclaw_daily_reports')) {
        return {
          payload_json: JSON.stringify({
            date: '2026-02-22',
            generatedAt: '2026-02-22T09:00:00.000Z',
            summary: { kpis: { totalOffers: 3, totalCampaigns: 8 } },
            dailySnapshot: { impressions: 1000, clicks: 88, cost: 21, conversions: 0 },
            roi: {
              data: {
                overall: {
                  totalCost: 21,
                  totalRevenue: 10,
                  totalProfit: -11,
                  roi: -52.38,
                  roas: 0.48,
                  revenueAvailable: true,
                  affiliateBreakdown: [
                    { platform: 'partnerboost', totalCommission: 10, records: 4, currency: 'USD' },
                  ],
                  affiliateAttribution: {
                    attributedCommission: 6,
                    writtenRows: 2,
                  },
                  affiliateReconciliation: {
                    reportDate: '2026-02-22',
                    totalRevenue: 10,
                    attributedRevenue: 6,
                    gap: 4,
                    gapRatio: 40,
                    hasGap: true,
                    severity: 'critical',
                    failureRows: 4,
                    failureCommission: 4,
                    topFailureReasons: [
                      { code: 'product_mapping_miss', label: '商品映射缺失', count: 3, commission: 3 },
                      { code: 'campaign_mapping_miss', label: '无活动Campaign', count: 1, commission: 1 },
                    ],
                  },
                },
              },
            },
          }),
        }
      }
      return undefined
    })

    await sendDailyReportToFeishu({
      userId: 7,
      target: 'ou_xxx',
      date: '2026-02-22',
    })

    const message = String(hoisted.invokeOpenclawToolMock.mock.calls[0]?.[0]?.args?.message || '')
    expect(message).toContain('- 佣金对账（严重）：总佣金 10 USD｜已归因 6 USD｜缺口 4 USD（40%）')
    expect(message).toContain('- 缺口原因TOP：商品映射缺失 3条/3 USD；无活动Campaign 1条/1 USD')
  })

  it('formats budget adjustment recommendation label in daily report message', async () => {
    hoisted.queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT payload_json FROM openclaw_daily_reports')) {
        return {
          payload_json: JSON.stringify({
            date: '2026-02-22',
            generatedAt: '2026-02-22T09:00:00.000Z',
            summary: { kpis: { totalOffers: 1, totalCampaigns: 1 } },
            dailySnapshot: { impressions: 500, clicks: 60, cost: 18, conversions: 0 },
            roi: {
              data: {
                overall: {
                  totalCost: 18,
                  totalRevenue: 20,
                  totalProfit: 2,
                  roi: 11.1,
                  roas: 1.11,
                  revenueAvailable: true,
                  affiliateBreakdown: [],
                  affiliateAttribution: { writtenRows: 0 },
                },
              },
            },
            strategyRecommendations: [
              {
                id: 'rb1',
                recommendationType: 'adjust_budget',
                priorityScore: 88.4,
                summary: '当前预算 10.00，建议提升到 15.00（DAILY）。',
                campaignId: 66,
                data: { campaignName: 'Idoo_3702' },
              },
            ],
          }),
        }
      }
      return undefined
    })

    await sendDailyReportToFeishu({
      userId: 7,
      target: 'ou_xxx',
      date: '2026-02-22',
    })

    const message = String(hoisted.invokeOpenclawToolMock.mock.calls[0]?.[0]?.args?.message || '')
    expect(message).toContain('[预算调整] Idoo_3702｜优先级分 88.4')
  })

})
