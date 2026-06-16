import { describe, expect, it } from 'vitest'
import { extractAsinFromOfferUrls, normalizeOfferAsin } from '@/lib/openclaw/offer-asin'
import {
  compressJsonPayloadText,
  decompressJsonPayloadText,
  serializeJsonPayloadForStorage,
} from '@/lib/common/server'

describe('offer-asin', () => {
  it('extracts ASIN from amazon urls', () => {
    expect(extractAsinFromOfferUrls('https://www.amazon.com/dp/B0BGPF71Q6', null)).toBe(
      'B0BGPF71Q6'
    )
  })

  it('normalizes ASIN values', () => {
    expect(normalizeOfferAsin(' b0bgpf71q6 ')).toBe('B0BGPF71Q6')
  })

  it('prefers final_url over url when both contain ASIN', () => {
    expect(
      extractAsinFromOfferUrls(
        'https://www.amazon.com/dp/B0OLDASIN0',
        'https://www.amazon.com/dp/B0NEWASIN9'
      )
    ).toBe('B0NEWASIN9')
  })
})

describe('json-payload-compression', () => {
  it('round-trips gzip payloads', () => {
    const source = 'x'.repeat(5000)
    const compressed = compressJsonPayloadText(source)
    expect(compressed.codec).toBe('gzip-base64')
    expect(decompressJsonPayloadText(compressed.payload, compressed.codec)).toBe(source)
  })

  it('keeps small payloads uncompressed', () => {
    const stored = serializeJsonPayloadForStorage({ ok: true })
    expect(stored.codec).toBe('json')
  })
})
