import { describe, expect, it } from 'vitest'
import {
  getCommissionPerConversion,
  normalizeOfferCommissionInput,
  normalizeOfferCommissionPayoutInput,
  normalizeOfferProductPriceInput,
  parseCommissionPayoutValue,
} from '@/lib/offer-monetization'

describe('offer monetization helpers', () => {
  it('normalizes plain product price using target-country symbol', () => {
    expect(normalizeOfferProductPriceInput('349.99', 'US')).toBe('$349.99')
    expect(normalizeOfferProductPriceInput('349.99', 'GB')).toBe('£349.99')
  })

  it('preserves explicitly currency-marked product price', () => {
    expect(normalizeOfferProductPriceInput('EUR 349.99', 'US')).toBe('EUR 349.99')
    expect(normalizeOfferProductPriceInput('€349.99', 'US')).toBe('€349.99')
  })

  it('normalizes commission payout in percent and absolute modes', () => {
    expect(normalizeOfferCommissionPayoutInput('30%', 'US')).toBe('30%')
    expect(normalizeOfferCommissionPayoutInput('15', 'US')).toBe('15')
    expect(normalizeOfferCommissionPayoutInput('15', 'GB')).toBe('15')
    expect(normalizeOfferCommissionPayoutInput('0.225', 'US')).toBe('22.5%')
    expect(normalizeOfferCommissionPayoutInput('15', 'US', { numericMode: 'amount' })).toBe('$15')
  })

  it('parses commission payout with percent and amount semantics', () => {
    const percent = parseCommissionPayoutValue('30%', { targetCountry: 'US' })
    expect(percent).toEqual({
      mode: 'percent',
      rate: 0.3,
      displayRate: 30,
    })

    const amount = parseCommissionPayoutValue('$15', { targetCountry: 'US' })
    expect(amount).toEqual({
      mode: 'amount',
      amount: 15,
      currency: 'USD',
      explicitCurrency: true,
    })

    const numericPercent = parseCommissionPayoutValue('0.125', { targetCountry: 'US' })
    expect(numericPercent).toEqual({
      mode: 'percent',
      rate: 0.125,
      displayRate: 12.5,
    })

    expect(parseCommissionPayoutValue('12.5', { targetCountry: 'US' })).toEqual({
      mode: 'amount',
      amount: 12.5,
      currency: 'USD',
      explicitCurrency: false,
    })
  })

  it('normalizes structured commission input and validates conflicts', () => {
    expect(normalizeOfferCommissionInput({
      targetCountry: 'US',
      commissionType: 'percent',
      commissionValue: '7.5',
    })).toEqual({
      commissionType: 'percent',
      commissionValue: '7.5',
      commissionCurrency: null,
      commissionPayout: '7.5%',
    })

    expect(normalizeOfferCommissionInput({
      targetCountry: 'US',
      commissionType: 'amount',
      commissionValue: '22.5',
      commissionCurrency: 'USD',
    })).toEqual({
      commissionType: 'amount',
      commissionValue: '22.5',
      commissionCurrency: 'USD',
      commissionPayout: '$22.5',
    })

    expect(normalizeOfferCommissionInput({
      targetCountry: 'US',
      commissionPayout: '11.25%',
    })).toEqual({
      commissionType: 'percent',
      commissionValue: '11.25',
      commissionCurrency: null,
      commissionPayout: '11.25%',
    })

    expect(normalizeOfferCommissionInput({
      targetCountry: 'US',
      commissionPayout: '11.25',
    })).toEqual({
      commissionType: 'amount',
      commissionValue: '11.25',
      commissionCurrency: 'USD',
      commissionPayout: '$11.25',
    })

    expect(() => normalizeOfferCommissionInput({
      targetCountry: 'US',
      commissionType: 'percent',
      commissionValue: '7.5',
      commissionPayout: '$7.5',
    })).toThrow('语义冲突')
  })

  it('computes commission per conversion for percent and absolute payout', () => {
    expect(getCommissionPerConversion({
      productPrice: '$100',
      commissionPayout: '10%',
      targetCountry: 'US',
    })).toEqual({
      amount: 10,
      currency: 'USD',
      mode: 'percent',
      rate: 0.1,
    })

    expect(getCommissionPerConversion({
      productPrice: '$100',
      commissionPayout: '$15',
      targetCountry: 'US',
    })).toEqual({
      amount: 15,
      currency: 'USD',
      mode: 'amount',
    })
  })
})
