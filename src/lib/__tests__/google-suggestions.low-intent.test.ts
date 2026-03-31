import { describe, expect, it } from 'vitest'
import { filterLowIntentKeywords } from '../google-suggestions'

describe('google-suggestions filterLowIntentKeywords', () => {
  it('filters visual-asset and sizing lookup terms', () => {
    const keywords = [
      'running girl sports bra buy',
      'running girl gif buy',
      'running girl meme',
      'running girl image',
      'running girl logo',
      'running girl bra size chart',
      'running girl bra sizing',
    ]

    const filtered = filterLowIntentKeywords(keywords)

    expect(filtered).toContain('running girl sports bra buy')
    expect(filtered).not.toContain('running girl gif buy')
    expect(filtered).not.toContain('running girl meme')
    expect(filtered).not.toContain('running girl image')
    expect(filtered).not.toContain('running girl logo')
    expect(filtered).not.toContain('running girl bra size chart')
    expect(filtered).not.toContain('running girl bra sizing')
  })
})
