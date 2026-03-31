import { describe, expect, it } from 'vitest'
import type { GeneratedAdCreativeData } from '../ad-creative'
import { enforceHeadlineComplementarity, softlyReinforceTypeCopy } from '../ad-creative-generator'

function buildCreativeDraft(): GeneratedAdCreativeData {
  return {
    headlines: [
      '{KeyWord:ToolPro} Official',
      'Powerful Drill for Home',
      'Cordless Hammer Drill',
      'Reliable Tool for Repairs'
    ],
    descriptions: [
      'Durable power tool for daily projects',
      'Built for heavy tasks in your workshop',
      'Trusted quality and easy handling',
      'Strong performance for home and garden'
    ],
    keywords: ['hammer drill', 'cordless drill', 'garden repair tool'],
    callouts: [],
    sitelinks: [],
    theme: 'test',
    explanation: 'test'
  }
}

describe('ad-creative-generator softlyReinforceTypeCopy', () => {
  it('applies soft reinforcement for French copy without touching keywords', () => {
    const creative = buildCreativeDraft()
    const originalKeywords = [...creative.keywords]

    const fix = softlyReinforceTypeCopy(creative, 'B', 'fr', 'ToolPro')

    expect(fix.descriptionFixes).toBeGreaterThan(0)
    expect(creative.descriptions.some((d) => /(en savoir plus|acheter maintenant|commander)/i.test(d))).toBe(true)
    expect(creative.keywords).toEqual(originalKeywords)
  })

  it('supports additional mapped language variants (Swiss German -> de)', () => {
    const creative = buildCreativeDraft()

    const fix = softlyReinforceTypeCopy(creative, 'D', 'Swiss German', 'WerkPro')

    expect(fix.descriptionFixes + fix.headlineFixes).toBeGreaterThan(0)
    expect(creative.descriptions.some((d) => /(jetzt kaufen|mehr erfahren|bestellen)/i.test(d))).toBe(true)
  })

  it('applies soft reinforcement for Spanish copy', () => {
    const creative = buildCreativeDraft()

    const fix = softlyReinforceTypeCopy(creative, 'B', 'es-MX', 'ToolPro')

    expect(fix.descriptionFixes).toBeGreaterThan(0)
    expect(creative.descriptions.some((d) => /(comprar ahora|más información|pedir)/i.test(d))).toBe(true)
  })

  it('applies soft reinforcement for Chinese copy', () => {
    const creative = buildCreativeDraft()

    const fix = softlyReinforceTypeCopy(creative, 'D', 'zh-CN', 'ToolPro')

    expect(fix.descriptionFixes + fix.headlineFixes).toBeGreaterThan(0)
    expect(creative.descriptions.some((d) => /(立即购买|了解更多|立即下单)/.test(d))).toBe(true)
  })

  it('applies soft reinforcement for Arabic copy', () => {
    const creative = buildCreativeDraft()

    const fix = softlyReinforceTypeCopy(creative, 'A', 'ar', 'ToolPro')

    expect(fix.descriptionFixes + fix.headlineFixes).toBeGreaterThan(0)
    expect(creative.descriptions.some((d) => /(اشتري الآن|اعرف المزيد|اطلب الآن)/.test(d))).toBe(true)
  })

  it('keeps unsupported languages unchanged', () => {
    const creative = buildCreativeDraft()
    const before = JSON.stringify(creative)

    const fix = softlyReinforceTypeCopy(creative, 'D', 'hi', 'ToolPro')

    expect(fix.headlineFixes).toBe(0)
    expect(fix.descriptionFixes).toBe(0)
    expect(JSON.stringify(creative)).toBe(before)
  })

  it('preserves English soft reinforcement behavior', () => {
    const creative = buildCreativeDraft()

    const fix = softlyReinforceTypeCopy(creative, 'D', 'en', 'ToolPro')

    expect(fix.descriptionFixes + fix.headlineFixes).toBeGreaterThan(0)
    expect(creative.descriptions.some((d) => /(shop now|learn more|buy now)/i.test(d))).toBe(true)
  })
})

describe('ad-creative-generator enforceHeadlineComplementarity', () => {
  it('reduces top-window single-intent concentration inside first 8 headlines', () => {
    const creative: GeneratedAdCreativeData = {
      headlines: [
        '{KeyWord:ToolPro} Official',
        'Official ToolPro Store',
        'Trusted ToolPro Quality',
        'Certified ToolPro Support',
        'ToolPro Warranty Included',
        'Authentic ToolPro Source',
        'Official ToolPro Site',
        'Trusted ToolPro Choice',
        'For Home Repair Projects',
        'Buy ToolPro Today'
      ],
      descriptions: ['Trusted quality with support'],
      keywords: ['toolpro drill', 'repair tool'],
      callouts: [],
      sitelinks: [],
      theme: 'test',
      explanation: 'test'
    }

    const fix = enforceHeadlineComplementarity(creative, 'en', 'ToolPro')

    expect(fix.fixes).toBeGreaterThan(0)
    expect(creative.headlines[0]).toBe('{KeyWord:ToolPro} Official')
    const editableTop8 = creative.headlines.slice(1, 9)
    expect(editableTop8.some((h) => /Need Better Everyday Results\?/i.test(h))).toBe(true)
  })

  it('treats solution-style copy as scenario-equivalent to avoid intent conflicts', () => {
    const creative: GeneratedAdCreativeData = {
      headlines: [
        '{KeyWord:ToolPro} Official',
        'Official ToolPro Warranty',
        'Built to solve daily repair pain',
        'Buy ToolPro Today',
        'Trusted ToolPro Support'
      ],
      descriptions: ['Trusted value for daily use'],
      keywords: ['repair tool', 'home project tool'],
      callouts: [],
      sitelinks: [],
      theme: 'test',
      explanation: 'test'
    }
    const before = [...creative.headlines]

    const fix = enforceHeadlineComplementarity(creative, 'en', 'ToolPro')

    expect(fix.scenarioCount).toBeGreaterThanOrEqual(1)
    expect(fix.fixes).toBe(0)
    expect(creative.headlines).toEqual(before)
  })

  it('does not force transactional headline when bucket B has no transactional keyword signal', () => {
    const creative: GeneratedAdCreativeData = {
      headlines: [
        '{KeyWord:ToolPro} Official',
        'Official ToolPro Warranty',
        'For Home Repair Projects',
        'Built to solve daily repair pain',
        'Trusted ToolPro Support'
      ],
      descriptions: ['Trusted value for daily use'],
      keywords: ['home repair tool', 'project drill'],
      callouts: [],
      sitelinks: [],
      theme: 'test',
      explanation: 'test'
    }

    const fix = enforceHeadlineComplementarity(creative, 'en', 'ToolPro', 'B')

    expect(fix.transactionalCount).toBe(0)
    expect(creative.headlines.some((h) => /^Buy\s/i.test(h))).toBe(false)
  })
})
