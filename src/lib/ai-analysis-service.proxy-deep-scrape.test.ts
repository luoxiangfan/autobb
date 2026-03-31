import { describe, expect, it, vi } from 'vitest'

const acquire = vi.fn(async (_proxyUrl: string) => ({
  context: {
    newPage: vi.fn(async () => ({
      goto: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    })),
  },
  instanceId: 'inst-1',
}))
const release = vi.fn()

vi.mock('./ai', () => ({
  analyzeProductPage: vi.fn(async () => ({
    brandDescription: 'bd',
    uniqueSellingPoints: ['usp'],
    productHighlights: ['ph'],
    targetAudience: 'ta',
    category: 'cat',
  })),
}))

vi.mock('./settings', () => ({
  getProxyUrlForCountry: vi.fn(async () => 'https://proxy-provider.example/api?cc=US'),
}))

vi.mock('@/lib/review-analyzer', () => ({
  scrapeAmazonReviews: vi.fn(async () => {
    throw new Error('blocked or captcha')
  }),
}))

vi.mock('@/lib/competitor-analyzer', () => ({
  scrapeAmazonCompetitors: vi.fn(async () => {
    throw new Error('blocked or captcha')
  }),
}))

vi.mock('@/lib/playwright-pool', () => ({
  getPlaywrightPool: () => ({ acquire, release }),
}))

describe('executeAIAnalysis deep scraping uses proxy', () => {
  it('passes proxyUrl into PlaywrightPool.acquire for Amazon review/competitor deep scraping', async () => {
    const { executeAIAnalysis } = await import('./ai-analysis-service')

    await executeAIAnalysis({
      extractResult: {
        finalUrl: 'https://www.amazon.com/dp/B07W1Z6KS4',
        brand: 'Sunyear',
        productName: 'Sunyear Product',
        productPrice: '$49.99',
        rating: '4.6',
        reviewCount: '39',
        relatedAsins: [],
        topReviews: [],
        reviewHighlights: [],
        debug: { isAmazonProductPage: true, isAmazonStore: false },
      },
      targetCountry: 'US',
      targetLanguage: 'English',
      userId: 1,
      enableReviewAnalysis: true,
      enableCompetitorAnalysis: true,
      enableAdExtraction: false,
      enablePlaywrightDeepScraping: true,
    } as any)

    expect(acquire).toHaveBeenCalled()
    expect(acquire.mock.calls[0]?.[0]).toBe('https://proxy-provider.example/api?cc=US')
    expect(acquire.mock.calls[1]?.[0]).toBe('https://proxy-provider.example/api?cc=US')
  })
})
