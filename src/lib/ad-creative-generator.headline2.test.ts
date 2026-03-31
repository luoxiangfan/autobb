import { describe, expect, it } from 'vitest'
import { selectPrimaryKeywordForHeadline2 } from './ad-creative-generator'

describe('selectPrimaryKeywordForHeadline2', () => {
  it('avoids generic intent-only words like "shop"', () => {
    const brand = 'Redtiger'
    const result = selectPrimaryKeywordForHeadline2(
      [
        { keyword: 'redtiger shop', searchVolume: 10 },
        { keyword: 'redtiger f17', searchVolume: 2400 },
        { keyword: 'buy redtiger dashcam', searchVolume: 0 },
        { keyword: 'redtiger dash cam', searchVolume: 18100 },
      ],
      brand,
      [
        'On-Dash Cameras',
        'REDTIGER 4 Channel 360° View Dash Cam, Dual STARVIS 2, 2.5K Dashcam',
      ]
    )

    expect(result.toLowerCase()).toContain('dash')
    expect(result.toLowerCase()).not.toBe('shop')
    expect(result.toLowerCase()).not.toBe('f17')
  })

  it('falls back to offer text when candidates are not relevant', () => {
    const result = selectPrimaryKeywordForHeadline2(
      [{ keyword: 'shop', searchVolume: 9999 }],
      'AnyBrand',
      ['On-Dash Cameras']
    )

    expect(result.toLowerCase()).toContain('dash')
  })

  it('allows a model code when it is present in offer context', () => {
    const result = selectPrimaryKeywordForHeadline2(
      [{ keyword: 'redtiger f17', searchVolume: 2400 }],
      'Redtiger',
      ['Redtiger F17 Rangefinder']
    )

    expect(result.toLowerCase()).toBe('f17')
  })
})

