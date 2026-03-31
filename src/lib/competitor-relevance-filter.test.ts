import { describe, expect, it } from 'vitest'
import type { CompetitorProduct } from './competitor-analyzer'
import {
  createCompetitorRelevanceContext,
  filterRelevantCompetitors,
  isCompetitorRelevant,
} from './competitor-relevance-filter'

function makeCompetitor(
  name: string,
  overrides: Partial<CompetitorProduct> = {}
): CompetitorProduct {
  return {
    asin: 'B000000000',
    name,
    brand: 'TestBrand',
    price: null,
    priceText: null,
    rating: null,
    reviewCount: null,
    imageUrl: null,
    source: 'related_products',
    features: [],
    ...overrides,
  }
}

describe('competitor-relevance-filter', () => {
  it('filters unrelated products for video conferencing cameras', () => {
    const context = createCompetitorRelevanceContext({
      productName: 'WYRESTORM 4K Webcam with AI Tracking for Zoom and Microsoft Teams',
      category: 'Video Conferencing Cameras',
      features: ['Conference room camera', 'Auto framing'],
    })

    const candidates: CompetitorProduct[] = [
      makeCompetitor('Ailun Screen Protector for iPad 11th Generation'),
      makeCompetitor('Apple iPad 11-inch with 12MP front/12MP back camera'),
      makeCompetitor('Logitech Brio 4K Webcam for Video Meetings'),
      makeCompetitor('EMEET Conference Webcam with Auto Framing'),
    ]

    const { kept, removed } = filterRelevantCompetitors(candidates, context)

    expect(context.mode).toBe('video_conferencing_camera')
    expect(kept.map((c) => c.name)).toEqual([
      'Logitech Brio 4K Webcam for Video Meetings',
      'EMEET Conference Webcam with Auto Framing',
    ])
    expect(removed.map((c) => c.name)).toEqual([
      'Ailun Screen Protector for iPad 11th Generation',
      'Apple iPad 11-inch with 12MP front/12MP back camera',
    ])
  })

  it('keeps security-camera competitors and removes unrelated accessories', () => {
    const context = createCompetitorRelevanceContext({
      productName: '2K Outdoor Security Camera',
      category: 'Home Security Cameras',
    })

    const securityCompetitor = makeCompetitor('Wireless Doorbell Camera with Night Vision')
    const unrelatedAccessory = makeCompetitor('Universal Tablet Stand Mount')

    expect(isCompetitorRelevant(securityCompetitor, context)).toBe(true)
    expect(isCompetitorRelevant(unrelatedAccessory, context)).toBe(false)
  })

  it('falls back to pass-through when product context is missing', () => {
    const context = createCompetitorRelevanceContext({
      productName: null,
      category: null,
      productCategory: null,
    })

    expect(context.hasContext).toBe(false)
    expect(isCompetitorRelevant(makeCompetitor('Any product name'), context)).toBe(true)
  })
})
