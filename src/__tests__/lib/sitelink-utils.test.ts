import { describe, expect, it } from 'vitest'
import {
  formatSitelinkDescriptionsDisplay,
  formatSitelinkForPublish,
  normalizeSitelinkItem,
  normalizeSitelinkList,
  readSitelinkDescription1,
  readSitelinkDescription2,
} from '@/lib/creatives/sitelink-utils'

describe('sitelink-utils', () => {
  it('maps legacy description to description1', () => {
    const item = normalizeSitelinkItem({
      text: 'Shop',
      url: 'https://example.com/shop',
      description: 'Shop now',
    })
    expect(item).toEqual({
      text: 'Shop',
      url: 'https://example.com/shop',
      description1: 'Shop now',
    })
    expect(readSitelinkDescription1(item)).toBe('Shop now')
    expect(readSitelinkDescription2(item)).toBe('')
  })

  it('preserves description1 and description2', () => {
    const item = normalizeSitelinkItem({
      text: 'Support',
      url: '/support',
      description1: 'Get help fast',
      description2: '24/7 assistance',
    })
    expect(item).toEqual({
      text: 'Support',
      url: '/support',
      description1: 'Get help fast',
      description2: '24/7 assistance',
    })
    expect(formatSitelinkDescriptionsDisplay(item)).toBe('Get help fast · 24/7 assistance')
  })

  it('formats publish payload and duplicates description1 when description2 missing', () => {
    const published = formatSitelinkForPublish({
      text: 'Shop',
      url: 'https://example.com',
      description1: 'Browse deals',
    })
    expect(published).toEqual({
      text: 'Shop',
      url: 'https://example.com',
      description1: 'Browse deals',
      description2: 'Browse deals',
    })
  })

  it('omits descriptions when both are empty', () => {
    const published = formatSitelinkForPublish({
      text: 'Shop',
      url: 'https://example.com',
    })
    expect(published).toEqual({
      text: 'Shop',
      url: 'https://example.com',
    })
  })

  it('normalizes sitelink lists with fallback url', () => {
    const list = normalizeSitelinkList(['Products'], 'https://example.com')
    expect(list).toEqual([{ text: 'Products', url: 'https://example.com' }])
  })
})
