import { describe, expect, it } from 'vitest'
import type { GeneratedAdCreativeData, HeadlineAsset } from '../ad-creative'
import { enforceTitlePriorityTopHeadlines } from '../ad-creative-generator'

function buildCreativeDraft(): GeneratedAdCreativeData {
  const headlines = [
    '{KeyWord:Sunco} Official',
    'Placeholder Headline 2',
    'Placeholder Headline 3',
    'Placeholder Headline 4',
    'Placeholder Headline 5',
  ]

  const headlinesWithMetadata: HeadlineAsset[] = headlines.map((text) => ({
    text,
    length: Math.min(30, text.length),
  }))

  return {
    headlines,
    descriptions: ['Desc 1', 'Desc 2', 'Desc 3', 'Desc 4'],
    keywords: ['sunco led shop lights', 'sunco garage lighting'],
    callouts: [],
    sitelinks: [],
    theme: 'test',
    explanation: 'test',
    headlinesWithMetadata,
  }
}

describe('ad-creative-generator enforceTitlePriorityTopHeadlines', () => {
  it('uses title-derived headlines for #2-#4 when title candidates are sufficient', () => {
    const creative = buildCreativeDraft()

    const result = enforceTitlePriorityTopHeadlines(creative, {
      brandName: 'Sunco',
      productTitle: 'Sunco LED Shop Lights for Workshop 4FT, Linkable Garage Lighting, 4500 LM, 40W(150W Equivalent), 5000K Daylight, Surface + Suspension Mount, 48 Inch Integrated Fixture, White 4 Pack.',
      aboutItems: ['V-shape design with wide lighting coverage', 'Easy installation and mounting options'],
      targetLanguage: 'English',
    })

    const top3 = creative.headlines.slice(1, 4)
    expect(result.selected).toHaveLength(3)
    expect(result.titleCount).toBe(3)
    expect(result.aboutCount).toBe(0)
    expect(top3.every((headline) => headline.length <= 30)).toBe(true)
    expect(top3.every((headline) => /sunco/i.test(headline))).toBe(true)
    expect(new Set(top3.map((headline) => headline.toLowerCase())).size).toBe(3)
    expect((creative.headlinesWithMetadata || []).slice(1, 4).every((asset) => asset.text.length <= 30)).toBe(true)
  })

  it('falls back to about/features only when title cannot provide 3 qualified headlines', () => {
    const creative = buildCreativeDraft()

    const result = enforceTitlePriorityTopHeadlines(creative, {
      brandName: 'Acme',
      productTitle: 'Acme Pro',
      aboutItems: ['Waterproof outdoor design', '20-hour battery life', 'Fast USB-C charging support'],
      targetLanguage: 'English',
    })

    const top3 = creative.headlines.slice(1, 4)
    expect(result.selected).toHaveLength(3)
    expect(result.titleCount).toBeLessThan(3)
    expect(result.aboutCount).toBeGreaterThan(0)
    expect(top3.every((headline) => headline.length <= 30)).toBe(true)
    expect(top3.every((headline) => /acme/i.test(headline))).toBe(true)
    expect(new Set(top3.map((headline) => headline.toLowerCase())).size).toBe(3)
  })

  it('does not split thousand separators in title segments', () => {
    const creative = buildCreativeDraft()

    const result = enforceTitlePriorityTopHeadlines(creative, {
      brandName: 'Dreo',
      productTitle: 'Dreo 14,000 BTU DOE Portable AC Unit for Bedroom Cooling',
      aboutItems: ['Smart app control with low-noise sleep mode'],
      targetLanguage: 'English',
    })

    const top3 = creative.headlines.slice(1, 4).join(' | ')
    expect(result.selected.length).toBeGreaterThanOrEqual(2)
    expect(top3).not.toContain('Dreo 000 BTU')
    expect(top3).toContain('14,000')
  })

  it('does not inject latin-script title headlines into CJK target language slots', () => {
    const creative = buildCreativeDraft()
    const before = [...creative.headlines]

    const result = enforceTitlePriorityTopHeadlines(creative, {
      brandName: 'Sunco',
      productTitle: 'Sunco LED Shop Lights for Workshop 4FT, Linkable Garage Lighting',
      aboutItems: ['Fast install and suspension mount'],
      targetLanguage: 'Japanese',
    })

    expect(result.selected).toEqual([])
    expect(result.replaced).toBe(0)
    expect(creative.headlines).toEqual(before)
  })
})
