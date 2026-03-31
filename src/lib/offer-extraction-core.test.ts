import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/url-resolver-enhanced', () => ({
  resolveAffiliateLink: vi.fn(),
  BATCH_MODE_RETRY_CONFIG: { retryCount: 1, timeout: 3000 },
  getProxyPool: () => ({
    getProxyInfo: () => ({
      proxy: null,
      isTargetCountryMatch: true,
      usedCountry: 'US',
    }),
  }),
}))

vi.mock('@/lib/scraper', () => ({
  extractProductInfo: vi.fn(),
}))

vi.mock('@/lib/stealth-scraper', () => ({
  scrapeAmazonStoreDeep: vi.fn(),
  scrapeIndependentStoreDeep: vi.fn(),
  scrapeAmazonProduct: vi.fn(),
  scrapeIndependentProduct: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getProxyUrlForCountry: vi.fn(),
}))

vi.mock('@/lib/proxy-warmup', () => ({
  warmupAffiliateLink: vi.fn(),
}))

vi.mock('@/lib/google-brand-search', () => ({
  fetchBrandSearchSupplement: vi.fn(),
}))

vi.mock('@/lib/offer-utils', () => ({
  detectPageType: vi.fn(() => ({
    pageType: 'unknown',
    isAmazonStore: false,
    isAmazonProductPage: false,
    isIndependentStore: false,
  })),
  initializeProxyPool: vi.fn(async () => {}),
  getTargetLanguage: vi.fn(() => 'en'),
  normalizeBrandName: (brand: string) => {
    const trimmed = typeof brand === 'string' ? brand.trim() : ''
    if (!trimmed) return trimmed
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
  },
}))

function createAmazonProductMock(overrides: Record<string, any> = {}) {
  return {
    productName: 'Sample Product',
    productDescription: 'Sample description',
    productPrice: '$19.99',
    originalPrice: null,
    discount: null,
    brandName: 'SampleBrand',
    features: ['Feature A'],
    aboutThisItem: ['About item A'],
    imageUrls: ['https://example.com/image.jpg'],
    rating: '4.5',
    reviewCount: '100',
    salesRank: null,
    badge: null,
    availability: 'In Stock',
    primeEligible: true,
    reviewHighlights: [],
    topReviews: [],
    technicalDetails: {},
    asin: 'B09RF5MPGK',
    category: 'Home',
    relatedAsins: [],
    ...overrides,
  }
}

describe('extractOffer brand fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to domain brand when independent product scraping times out', async () => {
    const { extractOffer } = await import('@/lib/offer-extraction-core')
    const { resolveAffiliateLink } = await import('@/lib/url-resolver-enhanced')
    const { extractProductInfo } = await import('@/lib/scraper')
    const { scrapeIndependentProduct } = await import('@/lib/stealth-scraper')
    const { getProxyUrlForCountry } = await import('@/lib/settings')

    vi.mocked(getProxyUrlForCountry).mockResolvedValue('https://proxy-provider.example/api?cc=US')
    vi.mocked(resolveAffiliateLink).mockResolvedValue({
      finalUrl: 'https://www.hitmanpro.com/en-us',
      finalUrlSuffix: 'affiliate=abc',
      brand: null,
      redirectCount: 3,
      redirectChain: ['https://click-ecom.com/', 'https://prf.hn/', 'https://www.hitmanpro.com/en-us'],
      pageTitle: null,
      statusCode: 200,
      resolveMethod: 'http',
      proxyUsed: 'US',
    })

    vi.mocked(extractProductInfo).mockRejectedValue(new Error('timeout of 30000ms exceeded'))
    vi.mocked(scrapeIndependentProduct).mockRejectedValue(new Error('playwright failed'))

    const result = await extractOffer({
      affiliateLink: 'https://click-ecom.com/?a=284403&c=275883&co=347178&mt=5',
      targetCountry: 'US',
      userId: 1,
      skipWarmup: true,
    })

    expect(result.success).toBe(true)
    expect(result.data?.brand).toBe('Hitmanpro')

    expect(vi.mocked(extractProductInfo)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(extractProductInfo).mock.calls[0]?.[2]).toBe('https://proxy-provider.example/api?cc=US')
  })

  it('retries Amazon product scraping with canonical URL when tracked URL data is insufficient', async () => {
    const { extractOffer } = await import('@/lib/offer-extraction-core')
    const { resolveAffiliateLink } = await import('@/lib/url-resolver-enhanced')
    const { getProxyUrlForCountry } = await import('@/lib/settings')
    const { detectPageType } = await import('@/lib/offer-utils')
    const { scrapeAmazonProduct } = await import('@/lib/stealth-scraper')

    vi.mocked(getProxyUrlForCountry).mockResolvedValue('https://proxy-provider.example/api?cc=US')
    vi.mocked(resolveAffiliateLink).mockResolvedValue({
      finalUrl: 'https://www.amazon.com/dp/B09RF5MPGK',
      finalUrlSuffix: 'maas=abc&aa_campaignid=123',
      brand: null,
      redirectCount: 2,
      redirectChain: [
        'https://yeahpromos.com/index/index/openurlproduct?track=43e8d385119b639d&pid=429324',
        'https://www.amazon.com/dp/B09RF5MPGK',
      ],
      pageTitle: null,
      statusCode: 200,
      resolveMethod: 'http',
      proxyUsed: 'US',
    })

    vi.mocked(detectPageType).mockImplementation((url: string) => {
      if (url.includes('amazon.com/dp/')) {
        return {
          pageType: 'amazon_product',
          isAmazonStore: false,
          isAmazonProductPage: true,
          isIndependentStore: false,
        }
      }
      return {
        pageType: 'unknown',
        isAmazonStore: false,
        isAmazonProductPage: false,
        isIndependentStore: false,
      }
    })

    vi.mocked(scrapeAmazonProduct)
      .mockResolvedValueOnce(createAmazonProductMock({
        productName: null,
        productDescription: null,
        brandName: null,
        features: [],
        aboutThisItem: [],
        imageUrls: [],
      }))
      .mockResolvedValueOnce(createAmazonProductMock({
        productName: 'Katchy Indoor Insect Trap',
        brandName: 'Katchy',
        features: ['UV light attracts flying insects'],
        aboutThisItem: ['No zapping, no chemicals'],
      }))

    const result = await extractOffer({
      affiliateLink: 'https://yeahpromos.com/index/index/openurlproduct?track=43e8d385119b639d&pid=429324',
      targetCountry: 'US',
      userId: 1,
      skipWarmup: true,
    })

    expect(result.success).toBe(true)
    expect(result.data?.brand).toBe('Katchy')
    expect(result.data?.productName).toBe('Katchy Indoor Insect Trap')

    expect(vi.mocked(scrapeAmazonProduct)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(scrapeAmazonProduct).mock.calls[0]?.[0])
      .toBe('https://www.amazon.com/dp/B09RF5MPGK?maas=abc&aa_campaignid=123')
    expect(vi.mocked(scrapeAmazonProduct).mock.calls[1]?.[0])
      .toBe('https://www.amazon.com/dp/B09RF5MPGK')
  })

  it('falls back to Playwright for independent products when light scrape richness is insufficient', async () => {
    const { extractOffer } = await import('@/lib/offer-extraction-core')
    const { resolveAffiliateLink } = await import('@/lib/url-resolver-enhanced')
    const { extractProductInfo } = await import('@/lib/scraper')
    const { scrapeIndependentProduct } = await import('@/lib/stealth-scraper')
    const { getProxyUrlForCountry } = await import('@/lib/settings')

    vi.mocked(getProxyUrlForCountry).mockResolvedValue('https://proxy-provider.example/api?cc=US')
    vi.mocked(resolveAffiliateLink).mockResolvedValue({
      finalUrl: 'https://handwovenlamp.com/products/rattan-pendant-light-wabi-sabi-style-retro-dining-room-chandelier',
      finalUrlSuffix: 'source_type=sales_plugin_af',
      brand: null,
      redirectCount: 1,
      redirectChain: ['https://handwovenlamp.com/products/slug?source_type=sales_plugin_af'],
      pageTitle: 'Rattan Pendant Light Wabi Sabi Style Retro Dining Room Chandelier',
      statusCode: 200,
      resolveMethod: 'playwright',
      proxyUsed: 'US',
    })

    vi.mocked(extractProductInfo).mockResolvedValue({
      productName: 'Rattan Pendant Light Wabi Sabi Style Retro Dining Room Chandelier',
      rawProductTitle: 'Rattan Pendant Light Wabi Sabi Style Retro Dining Room Chandelier',
      rawAboutThisItem: [],
      productDescription: 'This round pendant light is made of natural rattan and wood.',
      productPrice: '$329.99 USD',
      productCategory: null,
      productFeatures: [],
      brandName: 'handwovenlamp',
      imageUrls: [],
      metaTitle: null,
      metaDescription: null,
    })

    vi.mocked(scrapeIndependentProduct).mockResolvedValue({
      productName: 'Rattan Pendant Light Wabi Sabi Style Retro Dining Room Chandelier',
      rawProductTitle: 'Rattan Pendant Light Wabi Sabi Style Retro Dining Room Chandelier',
      rawAboutThisItem: ['Brand: Handwovenlamp', 'Material: Rattan, Wood'],
      productDescription: 'This round pendant light is made of natural rattan and wood.',
      productPrice: '$329.99 USD',
      originalPrice: null,
      discount: null,
      brandName: 'Handwovenlamp',
      features: ['Hand-woven rattan body', 'Adjustable cord length'],
      imageUrls: ['https://img.example.com/1.jpg'],
      technicalDetails: { Material: 'Rattan, Wood', Certification: 'UL' },
      category: 'Pendant Light',
      rating: '5',
      reviewCount: '42',
      availability: 'In Stock',
      reviews: ['Amazing shades!!!! Seller was super helpful and items arrived looking just like the photo!'],
      reviewHighlights: ['RECOMMEND!: Amazing shades!!!! Seller was super helpful and items arrived looking just like the photo!'],
      topReviews: ['RECOMMEND!: Amazing shades!!!! Seller was super helpful and items arrived looking just like the photo!'],
      structuredReviews: [{
        rating: 5,
        date: '2025-08-07',
        author: 'Patricia Adrian-Hanson',
        title: 'RECOMMEND!',
        body: 'Amazing shades!!!! Seller was super helpful and items arrived looking just like the photo!',
        verifiedBuyer: false,
      }],
      qaPairs: [{
        question: 'Is the 80CM able to be mounted with a slanted ceiling?',
        answer: 'Yes, it can be installed on slanted ceilings. Hope it helps you!',
      }],
      socialProof: [
        { metric: 'rating', value: '5' },
        { metric: 'reviews', value: '42' },
      ],
      coreFeatures: ['Hand-woven rattan body'],
      secondaryFeatures: ['Adjustable cord length'],
    })

    const result = await extractOffer({
      affiliateLink: 'https://handwovenlamp.com/products/slug?source_type=sales_plugin_af',
      targetCountry: 'US',
      userId: 1,
      skipWarmup: true,
    })

    expect(result.success).toBe(true)
    expect(vi.mocked(scrapeIndependentProduct)).toHaveBeenCalledTimes(1)
    expect(result.data?.reviewCount).toBe('42')
    expect(result.data?.topReviews?.[0]).toContain('Amazing shades')
    expect(result.data?.reviews?.[0]?.author).toBe('Patricia Adrian-Hanson')
    expect(result.data?.specifications).toEqual({ Material: 'Rattan, Wood', Certification: 'UL' })
  })

  it('falls back to Playwright when light scrape has zero review signals on product detail URL', async () => {
    const { extractOffer } = await import('@/lib/offer-extraction-core')
    const { resolveAffiliateLink } = await import('@/lib/url-resolver-enhanced')
    const { extractProductInfo } = await import('@/lib/scraper')
    const { scrapeIndependentProduct } = await import('@/lib/stealth-scraper')
    const { getProxyUrlForCountry } = await import('@/lib/settings')

    vi.mocked(getProxyUrlForCountry).mockResolvedValue('https://proxy-provider.example/api?cc=US')
    vi.mocked(resolveAffiliateLink).mockResolvedValue({
      finalUrl: 'https://handwovenlamp.com/products/smart-bedside-table-multifunctional-cabinet-with-light-wireless-charging-speaker-fingerprint-unlocking',
      finalUrlSuffix: 'source_type=sales_plugin_af',
      brand: null,
      redirectCount: 1,
      redirectChain: ['https://handwovenlamp.com/products/slug?source_type=sales_plugin_af'],
      pageTitle: 'Smart Bedside Table',
      statusCode: 200,
      resolveMethod: 'playwright',
      proxyUsed: 'US',
    })

    vi.mocked(extractProductInfo).mockResolvedValue({
      productName: 'Smart Bedside Table',
      rawProductTitle: 'Smart Bedside Table',
      rawAboutThisItem: ['Wireless charging', 'Bluetooth speaker'],
      productDescription: 'This bedside table integrates ambient lighting, wireless charging, bluetooth speakers and fingerprint unlocking functions.',
      productPrice: '$299.00',
      productCategory: 'Smart Furniture',
      productFeatures: ['Wireless charging', 'Bluetooth speaker', 'Fingerprint unlock'],
      brandName: 'Handwovenlamp',
      imageUrls: ['https://img.example.com/smart-bedside.jpg'],
      metaTitle: 'Smart Bedside Table',
      metaDescription: 'Smart bedside table with lighting and charging.',
      rating: null,
      reviewCount: '0',
      topReviews: [],
      reviews: [],
    })

    vi.mocked(scrapeIndependentProduct).mockResolvedValue({
      productName: 'Smart Bedside Table',
      rawProductTitle: 'Smart Bedside Table',
      rawAboutThisItem: ['Wireless charging', 'Bluetooth speaker'],
      productDescription: 'This bedside table integrates ambient lighting, wireless charging, bluetooth speakers and fingerprint unlocking functions.',
      productPrice: '$299.00',
      originalPrice: null,
      discount: null,
      brandName: 'Handwovenlamp',
      features: ['Wireless charging', 'Bluetooth speaker', 'Fingerprint unlock'],
      imageUrls: ['https://img.example.com/smart-bedside.jpg'],
      technicalDetails: { Material: 'Solid Wood' },
      category: 'Smart Furniture',
      rating: '5',
      reviewCount: '27',
      availability: 'In Stock',
      reviews: ['Excellent quality and function.'],
      reviewHighlights: ['Excellent quality and function.'],
      topReviews: ['Excellent quality and function.'],
      structuredReviews: [{
        rating: 5,
        date: '2026-01-08',
        author: 'Olivia',
        title: 'Worth it',
        body: 'Excellent quality and function.',
        verifiedBuyer: true,
      }],
      qaPairs: [],
      socialProof: [
        { metric: 'rating', value: '5' },
        { metric: 'reviews', value: '27' },
      ],
      coreFeatures: ['Wireless charging'],
      secondaryFeatures: ['Bluetooth speaker'],
    })

    const result = await extractOffer({
      affiliateLink: 'https://handwovenlamp.com/products/slug?source_type=sales_plugin_af',
      targetCountry: 'US',
      userId: 1,
      skipWarmup: true,
    })

    expect(result.success).toBe(true)
    expect(vi.mocked(scrapeIndependentProduct)).toHaveBeenCalledTimes(1)
    expect(result.data?.reviewCount).toBe('27')
    expect(result.data?.reviews?.[0]?.author).toBe('Olivia')
  })
})
