import { describe, expect, it } from 'vitest'
import { buildEffectiveCreative } from './effective-creative'

describe('buildEffectiveCreative', () => {
  it('prefers campaignConfig overrides when provided', () => {
    const result = buildEffectiveCreative({
      dbCreative: {
        headlines: JSON.stringify(['DB H1', 'DB H2']),
        descriptions: JSON.stringify(['DB D1']),
        keywords: JSON.stringify(['db kw']),
        negativeKeywords: JSON.stringify(['db neg']),
        callouts: JSON.stringify(['DB C1']),
        sitelinks: JSON.stringify([{ text: 'DB SL', url: 'https://db.example', description: 'db' }]),
        finalUrl: 'https://db.final',
        finalUrlSuffix: 'db_suffix'
      },
      campaignConfig: {
        headlines: ['  OV H1  ', ''],
        descriptions: ['OV D1', 'OV D2'],
        keywords: [{ text: 'kw1' }, 'kw2'],
        negativeKeywords: ['neg1'],
        callouts: ['OV C1', 'OV C2'],
        sitelinks: [{ text: 'OV SL', url: 'https://ov.example', description: 'ov' }],
        finalUrls: ['https://ov.final'],
        finalUrlSuffix: 'ov_suffix'
      },
      offerUrlFallback: 'https://offer.fallback'
    })

    expect(result.headlines).toEqual(['OV H1'])
    expect(result.descriptions).toEqual(['OV D1', 'OV D2'])
    expect(result.keywords).toEqual(['kw1', 'kw2'])
    expect(result.negativeKeywords).toEqual(['neg1'])
    expect(result.callouts).toEqual(['OV C1', 'OV C2'])
    expect(result.sitelinks).toEqual([{ text: 'OV SL', url: 'https://ov.example', description: 'ov' }])
    expect(result.finalUrl).toBe('https://ov.final')
    expect(result.finalUrlSuffix).toBe('ov_suffix')
  })

  it('falls back to dbCreative values when overrides are missing/empty', () => {
    const result = buildEffectiveCreative({
      dbCreative: {
        headlines: JSON.stringify(['DB H1']),
        descriptions: JSON.stringify(['DB D1']),
        keywords: JSON.stringify(['db kw']),
        negativeKeywords: JSON.stringify(['db neg']),
        callouts: JSON.stringify(['DB C1']),
        sitelinks: JSON.stringify([{ text: 'DB SL', url: 'https://db.example', description: 'db' }]),
        finalUrl: 'https://db.final',
        finalUrlSuffix: 'db_suffix'
      },
      campaignConfig: {
        headlines: ['   ', ''],
        descriptions: [],
        keywords: [],
        negativeKeywords: [],
        callouts: [],
        sitelinks: [],
        finalUrls: ['   ']
      }
    })

    expect(result.headlines).toEqual(['DB H1'])
    expect(result.descriptions).toEqual(['DB D1'])
    expect(result.keywords).toEqual(['db kw'])
    expect(result.negativeKeywords).toEqual(['db neg'])
    expect(result.callouts).toEqual(['DB C1'])
    expect(result.sitelinks).toEqual([{ text: 'DB SL', url: 'https://db.example', description: 'db' }])
    expect(result.finalUrl).toBe('https://db.final')
    expect(result.finalUrlSuffix).toBe('db_suffix')
  })

  it('clamps RSA asset counts to Google Ads limits', () => {
    const headlines = Array.from({ length: 16 }, (_, i) => `H${i + 1}`)
    const descriptions = Array.from({ length: 5 }, (_, i) => `D${i + 1}`)

    const result = buildEffectiveCreative({
      dbCreative: {
        headlines: JSON.stringify(headlines),
        descriptions: JSON.stringify(descriptions),
        keywords: JSON.stringify(['db kw']),
        negativeKeywords: JSON.stringify([]),
        callouts: JSON.stringify([]),
        sitelinks: JSON.stringify([]),
        finalUrl: 'https://db.final',
        finalUrlSuffix: 'db_suffix',
      },
      campaignConfig: {},
    })

    expect(result.headlines).toEqual(headlines.slice(0, 15))
    expect(result.descriptions).toEqual(descriptions.slice(0, 4))
  })
})
