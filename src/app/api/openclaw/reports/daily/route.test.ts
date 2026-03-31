import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/openclaw/reports/daily/route'

const authFns = vi.hoisted(() => ({
  resolveOpenclawRequestUser: vi.fn(),
}))

const reportFns = vi.hoisted(() => ({
  getOrCreateDailyReport: vi.fn(),
  buildOpenclawDailyReport: vi.fn(),
}))

const settingsFns = vi.hoisted(() => ({
  getAffiliateSyncSettingsMap: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  resolveOpenclawRequestUser: authFns.resolveOpenclawRequestUser,
}))

vi.mock('@/lib/openclaw/reports', () => ({
  getOrCreateDailyReport: reportFns.getOrCreateDailyReport,
  buildOpenclawDailyReport: reportFns.buildOpenclawDailyReport,
}))

vi.mock('@/lib/openclaw/settings', () => ({
  getAffiliateSyncSettingsMap: settingsFns.getAffiliateSyncSettingsMap,
}))

describe('openclaw reports daily route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reportFns.getOrCreateDailyReport.mockResolvedValue({
      date: '2026-02-09',
      generatedAt: '2026-02-09T00:00:00.000Z',
    })
    reportFns.buildOpenclawDailyReport.mockResolvedValue({
      date: '2026-02-09',
      generatedAt: '2026-02-09T00:00:00.000Z',
      dateRange: {
        startDate: '2026-02-01',
        endDate: '2026-02-09',
        days: 9,
        isRange: true,
      },
    })
    settingsFns.getAffiliateSyncSettingsMap.mockResolvedValue({})
  })

  it('returns 403 when request user cannot be resolved', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/openclaw/reports/daily?date=2026-02-09')
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(403)
    expect(payload.error).toContain('未授权')
    expect(reportFns.getOrCreateDailyReport).not.toHaveBeenCalled()
  })

  it('forces realtime refresh when query flag is provided', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 7,
      authType: 'session',
    })

    const req = new NextRequest('http://localhost/api/openclaw/reports/daily?date=2026-02-09&force_realtime=1')
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(reportFns.getOrCreateDailyReport).toHaveBeenCalledWith(7, '2026-02-09', { forceRefresh: true })
    expect(payload.forceRefreshApplied).toBe(true)
    expect(payload.forceRefreshReason).toBe('query')
  })

  it('forces realtime refresh for Feishu gateway binding when mode is realtime', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 11,
      authType: 'gateway-binding',
    })

    settingsFns.getAffiliateSyncSettingsMap.mockResolvedValue({
      openclaw_affiliate_sync_mode: 'realtime',
    })

    const req = new NextRequest('http://localhost/api/openclaw/reports/daily?date=2026-02-09', {
      headers: {
        'x-openclaw-channel': 'feishu',
      },
    })
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(settingsFns.getAffiliateSyncSettingsMap).toHaveBeenCalledWith(11)
    expect(reportFns.getOrCreateDailyReport).toHaveBeenCalledWith(11, '2026-02-09', { forceRefresh: true })
    expect(payload.forceRefreshApplied).toBe(true)
    expect(payload.forceRefreshReason).toBe('feishu_mode')
  })

  it('keeps cache path for Feishu gateway binding when mode is incremental', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 19,
      authType: 'gateway-binding',
    })

    settingsFns.getAffiliateSyncSettingsMap.mockResolvedValue({
      openclaw_affiliate_sync_mode: 'incremental',
    })

    const req = new NextRequest('http://localhost/api/openclaw/reports/daily?date=2026-02-09', {
      headers: {
        'x-openclaw-channel': 'feishu',
      },
    })
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(reportFns.getOrCreateDailyReport).toHaveBeenCalledWith(19, '2026-02-09', { forceRefresh: false })
    expect(payload.forceRefreshApplied).toBe(false)
    expect(payload.forceRefreshReason).toBeNull()
  })

  it('builds date-range report when start_date and end_date are provided', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 23,
      authType: 'session',
    })

    const req = new NextRequest(
      'http://localhost/api/openclaw/reports/daily?start_date=2026-02-01&end_date=2026-02-09'
    )
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(reportFns.buildOpenclawDailyReport).toHaveBeenCalledWith(
      23,
      '2026-02-09',
      { startDate: '2026-02-01' }
    )
    expect(reportFns.getOrCreateDailyReport).not.toHaveBeenCalled()
    expect(payload.report?.dateRange?.isRange).toBe(true)
  })

  it('builds single-day range report when only start_date is provided', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 24,
      authType: 'session',
    })

    const req = new NextRequest(
      'http://localhost/api/openclaw/reports/daily?start_date=2026-02-07'
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(reportFns.buildOpenclawDailyReport).toHaveBeenCalledWith(
      24,
      '2026-02-07',
      { startDate: '2026-02-07' }
    )
    expect(reportFns.getOrCreateDailyReport).not.toHaveBeenCalled()
  })

  it('supports camelCase range params', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 25,
      authType: 'session',
    })

    const req = new NextRequest(
      'http://localhost/api/openclaw/reports/daily?startDate=2026-02-03&endDate=2026-02-09'
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(reportFns.buildOpenclawDailyReport).toHaveBeenCalledWith(
      25,
      '2026-02-09',
      { startDate: '2026-02-03' }
    )
    expect(reportFns.getOrCreateDailyReport).not.toHaveBeenCalled()
  })

  it('returns 400 when range start date is later than end date', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 23,
      authType: 'session',
    })

    const req = new NextRequest(
      'http://localhost/api/openclaw/reports/daily?start_date=2026-02-10&end_date=2026-02-09'
    )
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.error).toContain('开始日期不能晚于结束日期')
    expect(reportFns.buildOpenclawDailyReport).not.toHaveBeenCalled()
  })
})
