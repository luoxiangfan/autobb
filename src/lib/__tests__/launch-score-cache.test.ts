import { describe, expect, it } from 'vitest'
import { buildLaunchScoreHashes } from '../launch-score-cache'

describe('buildLaunchScoreHashes', () => {
  const offer = {
    id: 1,
    target_country: 'US',
    target_language: 'en',
    final_url: 'https://example.com/o',
    url: 'https://example.com/o',
  } as any

  const creative = {
    id: 10,
    headlines: ['H1', 'H2'],
    descriptions: ['D1'],
    keywords: ['kw'],
    negativeKeywords: ['neg'],
    final_url: 'https://example.com/c',
  } as any

  it('returns stable hashes for the same content', () => {
    const a = buildLaunchScoreHashes(creative, offer)
    const b = buildLaunchScoreHashes(creative, offer)
    expect(a).toEqual(b)
  })

  it('changes content hash when headlines change', () => {
    const base = buildLaunchScoreHashes(creative, offer)
    const changed = buildLaunchScoreHashes(
      { ...creative, headlines: ['H1', 'H3'] },
      offer
    )
    expect(changed.contentHash).not.toBe(base.contentHash)
  })
})
