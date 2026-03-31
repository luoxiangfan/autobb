import { describe, expect, it } from 'vitest'
import { __testOnly } from '@/lib/affiliate-products'

describe('affiliate products publish backfill helpers', () => {
  it('extracts asin from common amazon url patterns', () => {
    expect(__testOnly.extractAsinFromUrlLike('https://www.amazon.com/dp/B0CCY6VG8Z')).toBe('B0CCY6VG8Z')
    expect(
      __testOnly.extractAsinFromUrlLike(
        'https://example.com/redirect?to=https%3A%2F%2Fwww.amazon.com%2Fgp%2Fproduct%2FB0CCY6VG8Z'
      )
    ).toBe('B0CCY6VG8Z')
  })

  it('extracts partnerboost link id from raw and encoded urls', () => {
    expect(
      __testOnly.extractPartnerboostLinkId('https://pboost.example/click?aa_adgroupid=pb_adg_123')
    ).toBe('pb_adg_123')
    expect(
      __testOnly.extractPartnerboostLinkId(
        'https://example.com/redirect?next=https%3A%2F%2Fpboost.example%2Fclick%3Faa_adgroupid%3Dpb_adg_123'
      )
    ).toBe('pb_adg_123')
  })

  it('prefers exact url match when it is unique', () => {
    const result = __testOnly.resolveOfferProductBackfillDecision({
      exactUrlProductIds: [11],
      linkIdProductIds: [21, 22],
      asinProductIds: [31, 32],
    })

    expect(result.productId).toBe(11)
    expect(result.reason).toBe('exact_url')
  })

  it('uses linkId+asin intersection when each signal alone is ambiguous', () => {
    const result = __testOnly.resolveOfferProductBackfillDecision({
      exactUrlProductIds: [],
      linkIdProductIds: [11, 22],
      asinProductIds: [22, 33],
    })

    expect(result.productId).toBe(22)
    expect(result.reason).toBe('link_id_asin_intersection')
  })

  it('does not force link when linkId and asin signals conflict', () => {
    const result = __testOnly.resolveOfferProductBackfillDecision({
      exactUrlProductIds: [],
      linkIdProductIds: [11],
      asinProductIds: [22],
    })

    expect(result.productId).toBeNull()
    expect(result.reason).toBe('conflicting_link_id_asin')
  })

  it('returns ambiguous reason when linkId candidates are multiple', () => {
    const result = __testOnly.resolveOfferProductBackfillDecision({
      exactUrlProductIds: [],
      linkIdProductIds: [11, 22],
      asinProductIds: [],
    })

    expect(result.productId).toBeNull()
    expect(result.reason).toBe('ambiguous_link_id')
  })
})
