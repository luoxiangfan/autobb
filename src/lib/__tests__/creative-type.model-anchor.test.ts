import { describe, expect, it } from 'vitest'

import { hasModelAnchorEvidence } from '../creative-type'

describe('creative-type model anchor detection', () => {
  it('does not treat ASIN-like identifiers as model anchors', () => {
    expect(hasModelAnchorEvidence({
      keywords: ['novilla b0cjj9sb4y mattress'],
    })).toBe(false)
  })

  it('keeps legacy model patterns like x200', () => {
    expect(hasModelAnchorEvidence({
      keywords: ['brandx x200 robot vacuum'],
    })).toBe(true)
  })

  it('does not classify measurement-only terms as model anchors', () => {
    expect(hasModelAnchorEvidence({
      keywords: ['novilla 10 inch memory foam mattress'],
    })).toBe(false)
  })

  it('does not classify dimension-axis fragments as model anchors', () => {
    expect(hasModelAnchorEvidence({
      keywords: ['dreo 14.37"d', 'dreo 17.32"w', 'dreo 28.13"h'],
    })).toBe(false)
  })
})
