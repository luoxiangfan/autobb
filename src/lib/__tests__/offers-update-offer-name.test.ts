import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let mockDb: any
let updateOffer: typeof import('../offers').updateOffer

const mockGenerateOfferName = vi.fn()
const mockIsOfferNameUnique = vi.fn()
const mockGetTargetLanguage = vi.fn()

vi.mock('../db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('../offer-utils', () => ({
  generateOfferName: mockGenerateOfferName,
  isOfferNameUnique: mockIsOfferNameUnique,
  getTargetLanguage: mockGetTargetLanguage,
  normalizeOfferTargetCountry: (v: string) => (String(v || '').trim().toUpperCase() === 'UK' ? 'GB' : String(v || '').trim().toUpperCase() || 'US'),
  normalizeBrandName: (v: string) => v,
  validateBrandName: (v: string) => ({ valid: true as const }),
}))

describe('updateOffer: sync offer_name with brand/country', () => {
  beforeEach(() => {
    mockDb = {
      type: 'sqlite',
      queryOne: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      close: vi.fn(),
    }
  })

  beforeEach(async () => {
    vi.resetModules()
    mockGenerateOfferName.mockReset()
    mockIsOfferNameUnique.mockReset()
    mockGetTargetLanguage.mockReset()
    ;({ updateOffer } = await import('../offers'))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('updates offer_name when brand changes (reuse sequence)', async () => {
    mockIsOfferNameUnique.mockResolvedValue(true)

    mockDb.queryOne
      .mockResolvedValueOnce({
        id: 1,
        user_id: 10,
        url: 'https://example.com',
        brand: 'OldBrand',
        category: null,
        target_country: 'US',
        target_language: 'English',
        offer_name: 'OldBrand_US_03',
        affiliate_link: null,
        brand_description: null,
        unique_selling_points: null,
        product_highlights: null,
        target_audience: null,
        final_url: null,
        final_url_suffix: null,
        product_price: null,
        commission_payout: null,
        scrape_status: 'completed',
        scrape_error: null,
        scraped_at: null,
        is_active: 1,
        industry_code: null,
        review_analysis: null,
        competitor_analysis: null,
        visual_analysis: null,
        extracted_keywords: null,
        extracted_headlines: null,
        extracted_descriptions: null,
        extraction_metadata: null,
        extracted_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        deleted_at: null,
        is_deleted: 0,
        promotions: null,
        scraped_data: null,
        ai_keywords: null,
        ai_reviews: null,
        ai_competitive_edges: null,
        ai_analysis_v32: null,
        page_type: 'product',
        generated_buckets: null,
        product_name: null,
      })
      .mockResolvedValueOnce({
        id: 1,
        user_id: 10,
        url: 'https://example.com',
        brand: 'NewBrand',
        category: null,
        target_country: 'US',
        target_language: 'English',
        offer_name: 'NewBrand_US_03',
        affiliate_link: null,
        brand_description: null,
        unique_selling_points: null,
        product_highlights: null,
        target_audience: null,
        final_url: null,
        final_url_suffix: null,
        product_price: null,
        commission_payout: null,
        scrape_status: 'completed',
        scrape_error: null,
        scraped_at: null,
        is_active: 1,
        industry_code: null,
        review_analysis: null,
        competitor_analysis: null,
        visual_analysis: null,
        extracted_keywords: null,
        extracted_headlines: null,
        extracted_descriptions: null,
        extraction_metadata: null,
        extracted_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        deleted_at: null,
        is_deleted: 0,
        promotions: null,
        scraped_data: null,
        ai_keywords: null,
        ai_reviews: null,
        ai_competitive_edges: null,
        ai_analysis_v32: null,
        page_type: 'product',
        generated_buckets: null,
        product_name: null,
      })

    const updated = await updateOffer(1, 10, { brand: 'NewBrand' })

    expect(updated.offer_name).toBe('NewBrand_US_03')
    expect(mockIsOfferNameUnique).toHaveBeenCalledWith('NewBrand_US_03', 10, 1)
    expect(mockGenerateOfferName).not.toHaveBeenCalled()

    const [sql, params] = mockDb.exec.mock.calls[0]
    expect(sql).toContain('UPDATE offers')
    expect(sql).toContain('brand = ?')
    expect(sql).toContain('offer_name = ?')
    expect(params).toEqual(expect.arrayContaining(['NewBrand', 'NewBrand_US_03', 1, 10]))
  })

  it('updates offer_name when country changes (reuse sequence) and updates target_language', async () => {
    mockIsOfferNameUnique.mockResolvedValue(true)
    mockGetTargetLanguage.mockReturnValue('German')

    mockDb.queryOne
      .mockResolvedValueOnce({
        id: 2,
        user_id: 10,
        url: 'https://example.com',
        brand: 'BrandA',
        category: null,
        target_country: 'US',
        target_language: 'English',
        offer_name: 'BrandA_US_01',
        affiliate_link: null,
        brand_description: null,
        unique_selling_points: null,
        product_highlights: null,
        target_audience: null,
        final_url: null,
        final_url_suffix: null,
        product_price: null,
        commission_payout: null,
        scrape_status: 'completed',
        scrape_error: null,
        scraped_at: null,
        is_active: 1,
        industry_code: null,
        review_analysis: null,
        competitor_analysis: null,
        visual_analysis: null,
        extracted_keywords: null,
        extracted_headlines: null,
        extracted_descriptions: null,
        extraction_metadata: null,
        extracted_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        deleted_at: null,
        is_deleted: 0,
        promotions: null,
        scraped_data: null,
        ai_keywords: null,
        ai_reviews: null,
        ai_competitive_edges: null,
        ai_analysis_v32: null,
        page_type: 'product',
        generated_buckets: null,
        product_name: null,
      })
      .mockResolvedValueOnce({
        id: 2,
        user_id: 10,
        url: 'https://example.com',
        brand: 'BrandA',
        category: null,
        target_country: 'DE',
        target_language: 'German',
        offer_name: 'BrandA_DE_01',
        affiliate_link: null,
        brand_description: null,
        unique_selling_points: null,
        product_highlights: null,
        target_audience: null,
        final_url: null,
        final_url_suffix: null,
        product_price: null,
        commission_payout: null,
        scrape_status: 'completed',
        scrape_error: null,
        scraped_at: null,
        is_active: 1,
        industry_code: null,
        review_analysis: null,
        competitor_analysis: null,
        visual_analysis: null,
        extracted_keywords: null,
        extracted_headlines: null,
        extracted_descriptions: null,
        extraction_metadata: null,
        extracted_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        deleted_at: null,
        is_deleted: 0,
        promotions: null,
        scraped_data: null,
        ai_keywords: null,
        ai_reviews: null,
        ai_competitive_edges: null,
        ai_analysis_v32: null,
        page_type: 'product',
        generated_buckets: null,
        product_name: null,
      })

    const updated = await updateOffer(2, 10, { target_country: 'DE' })

    expect(updated.offer_name).toBe('BrandA_DE_01')
    expect(updated.target_language).toBe('German')
    expect(mockIsOfferNameUnique).toHaveBeenCalledWith('BrandA_DE_01', 10, 2)
    expect(mockGetTargetLanguage).toHaveBeenCalledWith('DE')

    const [sql, params] = mockDb.exec.mock.calls[0]
    expect(sql).toContain('target_country = ?')
    expect(sql).toContain('offer_name = ?')
    expect(sql).toContain('target_language = ?')
    expect(params).toEqual(expect.arrayContaining(['DE', 'BrandA_DE_01', 'German', 2, 10]))
  })

  it('normalizes UK to GB when updating target_country and offer_name', async () => {
    mockIsOfferNameUnique.mockResolvedValue(true)
    mockGetTargetLanguage.mockReturnValue('English')

    mockDb.queryOne
      .mockResolvedValueOnce({
        id: 3,
        user_id: 10,
        url: 'https://example.com',
        brand: 'Ringconn',
        category: null,
        target_country: 'US',
        target_language: 'English',
        offer_name: 'Ringconn_US_01',
        affiliate_link: null,
        brand_description: null,
        unique_selling_points: null,
        product_highlights: null,
        target_audience: null,
        final_url: null,
        final_url_suffix: null,
        product_price: null,
        commission_payout: null,
        scrape_status: 'completed',
        scrape_error: null,
        scraped_at: null,
        is_active: 1,
        industry_code: null,
        review_analysis: null,
        competitor_analysis: null,
        visual_analysis: null,
        extracted_keywords: null,
        extracted_headlines: null,
        extracted_descriptions: null,
        extraction_metadata: null,
        extracted_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        deleted_at: null,
        is_deleted: 0,
        promotions: null,
        scraped_data: null,
        ai_keywords: null,
        ai_reviews: null,
        ai_competitive_edges: null,
        ai_analysis_v32: null,
        page_type: 'product',
        generated_buckets: null,
        product_name: null,
      })
      .mockResolvedValueOnce({
        id: 3,
        user_id: 10,
        url: 'https://example.com',
        brand: 'Ringconn',
        category: null,
        target_country: 'GB',
        target_language: 'English',
        offer_name: 'Ringconn_GB_01',
        affiliate_link: null,
        brand_description: null,
        unique_selling_points: null,
        product_highlights: null,
        target_audience: null,
        final_url: null,
        final_url_suffix: null,
        product_price: null,
        commission_payout: null,
        scrape_status: 'completed',
        scrape_error: null,
        scraped_at: null,
        is_active: 1,
        industry_code: null,
        review_analysis: null,
        competitor_analysis: null,
        visual_analysis: null,
        extracted_keywords: null,
        extracted_headlines: null,
        extracted_descriptions: null,
        extraction_metadata: null,
        extracted_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        deleted_at: null,
        is_deleted: 0,
        promotions: null,
        scraped_data: null,
        ai_keywords: null,
        ai_reviews: null,
        ai_competitive_edges: null,
        ai_analysis_v32: null,
        page_type: 'product',
        generated_buckets: null,
        product_name: null,
      })

    const updated = await updateOffer(3, 10, { target_country: 'UK' })

    expect(updated.offer_name).toBe('Ringconn_GB_01')
    expect(updated.target_language).toBe('English')
    expect(mockIsOfferNameUnique).toHaveBeenCalledWith('Ringconn_GB_01', 10, 3)
    expect(mockGetTargetLanguage).toHaveBeenCalledWith('GB')

    const [, params] = mockDb.exec.mock.calls[0]
    expect(params).toEqual(expect.arrayContaining(['GB', 'Ringconn_GB_01', 'English', 3, 10]))
  })
})
