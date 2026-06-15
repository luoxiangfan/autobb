import { describe, expect, it, vi } from 'vitest'
import {
  applyCurrencyFromApiResponse,
  buildReportCurrencyQueryParam,
  isSameReportCurrencyInfo,
  resolveSelectedReportCurrency,
  type ReportCurrencyInfo,
} from '../report-currency'

describe('report-currency', () => {
  const payload = {
    currency: 'USD',
    currencies: ['USD', 'EUR'],
    hasMixedCurrency: true,
  }

  it('does not auto-initialize reportCurrency from API metadata', () => {
    const setCurrencyInfo = vi.fn()
    const setReportCurrency = vi.fn()

    applyCurrencyFromApiResponse(payload, setCurrencyInfo, setReportCurrency)

    expect(setCurrencyInfo).toHaveBeenCalledTimes(1)
    expect(setReportCurrency).toHaveBeenCalledTimes(1)

    const reportUpdater = setReportCurrency.mock.calls[0][0] as (
      prev: string | null
    ) => string | null
    expect(reportUpdater(null)).toBeNull()
  })

  it('keeps a valid user-selected reportCurrency', () => {
    const setCurrencyInfo = vi.fn()
    const setReportCurrency = vi.fn()

    applyCurrencyFromApiResponse(payload, setCurrencyInfo, setReportCurrency)

    const reportUpdater = setReportCurrency.mock.calls[0][0] as (
      prev: string | null
    ) => string | null
    expect(reportUpdater('EUR')).toBe('EUR')
  })

  it('clears an invalid user-selected reportCurrency', () => {
    const setCurrencyInfo = vi.fn()
    const setReportCurrency = vi.fn()

    applyCurrencyFromApiResponse(payload, setCurrencyInfo, setReportCurrency)

    const reportUpdater = setReportCurrency.mock.calls[0][0] as (
      prev: string | null
    ) => string | null
    expect(reportUpdater('GBP')).toBeNull()
  })

  it('resolves display currency from metadata when no user filter is active', () => {
    const currencyInfo: ReportCurrencyInfo = {
      currency: 'EUR',
      currencies: ['USD', 'EUR'],
      hasMixedCurrency: true,
    }

    expect(resolveSelectedReportCurrency(null, currencyInfo)).toBe('EUR')
    expect(resolveSelectedReportCurrency('USD', currencyInfo)).toBe('USD')
  })

  it('builds query param only for user-selected currency', () => {
    expect(buildReportCurrencyQueryParam(null)).toBe('')
    expect(buildReportCurrencyQueryParam('EUR')).toBe('&currency=EUR')
  })

  it('detects unchanged currency metadata', () => {
    const current: ReportCurrencyInfo = {
      currency: 'USD',
      currencies: ['USD', 'EUR'],
      hasMixedCurrency: true,
    }

    expect(
      isSameReportCurrencyInfo(current, {
        currency: 'USD',
        currencies: ['USD', 'EUR'],
        hasMixedCurrency: true,
      })
    ).toBe(true)
  })
})
