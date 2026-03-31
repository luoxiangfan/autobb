import { describe, expect, it } from 'vitest'
import type { GeneratedAdCreativeData } from '../ad-creative'
import {
  CREATIVE_RELEVANCE_NOISE_TERMS,
  createCreativeRuleContext,
  evaluateCreativeRuleGate,
  filterPromptExtrasByRelevance
} from '../ad-creative-rule-gate'

function buildCreative(partial?: Partial<GeneratedAdCreativeData>): GeneratedAdCreativeData {
  return {
    headlines: [
      'Seamless Sports Bra for Workouts',
      'Breathable Yoga Support Bra',
      'Shop Activewear Essentials'
    ],
    descriptions: [
      'Stay comfortable with medium support and breathable fabric. Shop Now.',
      'Trusted fit for gym sessions and daily movement. Learn More.',
      'Lightweight support with premium comfort for women.'
    ],
    keywords: ['sports bra', 'yoga bra', 'workout bra'],
    callouts: ['Breathable Fabric', 'Flexible Support'],
    sitelinks: [{ text: 'Shop Sports Bra', url: '/', description: 'Find Your Best Fit' }],
    theme: 'test',
    explanation: 'test',
    ...partial
  }
}

describe('ad-creative-rule-gate', () => {
  it('exposes enumerable noise terms', () => {
    expect(CREATIVE_RELEVANCE_NOISE_TERMS.length).toBeGreaterThan(8)
    expect(CREATIVE_RELEVANCE_NOISE_TERMS).toContain('repair')
    expect(CREATIVE_RELEVANCE_NOISE_TERMS).toContain('drill')
  })

  it('blocks off-topic repair/tool language for non-tool products', () => {
    const creative = buildCreative({
      headlines: [
        'Reliable Fix for Real Projects',
        'Tackle Repairs With Confidence',
        'Tool-Grade Performance'
      ],
      descriptions: [
        'Repair jobs made easier. Buy now.',
        'Perfect drill companion for workshop tasks.',
        'Trusted quality for hardware projects.'
      ]
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en'
    })

    expect(result.relevance.passed).toBe(false)
    expect(result.relevance.offTopicHits.some(hit => /repair|fix|tool|drill/i.test(hit))).toBe(true)
  })

  it('passes relevant sports-bra creatives', () => {
    const creative = buildCreative()
    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en'
    })

    expect(result.relevance.passed).toBe(true)
  })

  it('blocks weak high-rank bestseller claims', () => {
    const creative = buildCreative({
      descriptions: [
        '#18,696 Best Seller in Clothing. Running Girl style comfort.',
        'Stay comfortable with medium support and breathable fabric. Shop Now.',
        'Trusted fit for gym sessions and daily movement. Learn More.'
      ]
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en'
    })

    expect(result.relevance.passed).toBe(false)
    expect(result.relevance.reasons.join(' ')).toMatch(/weak sales-rank claims/i)
    expect(result.relevance.offTopicHits).toContain('#18,696')
  })

  it('allows strong top-rank claims', () => {
    const creative = buildCreative({
      descriptions: [
        '#12 Best Seller in Sports Bras. Trusted support for workouts.',
        'Stay comfortable with medium support and breathable fabric. Shop Now.',
        'Trusted fit for gym sessions and daily movement. Learn More.'
      ]
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en'
    })

    expect(result.relevance.passed).toBe(true)
  })

  it('blocks risky social-proof percentages and slang', () => {
    const creative = buildCreative({
      descriptions: [
        '80% of women love this sports bra cuz it works great.',
        'Stay comfortable with medium support and breathable fabric. Shop Now.',
        'Trusted fit for gym sessions and daily movement. Learn More.'
      ]
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en'
    })

    expect(result.relevance.passed).toBe(false)
    expect(result.relevance.reasons.join(' ')).toMatch(/negative trust signals/i)
    expect(result.relevance.offTopicHits.some(hit => /80% of women love|cuz/i.test(hit))).toBe(true)
  })

  it('flags low diversity when headlines are duplicated', () => {
    const creative = buildCreative({
      headlines: Array.from({ length: 10 }, () => 'Shop Sports Bra Today')
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en'
    })

    expect(result.diversity.passed).toBe(false)
    expect(result.diversity.reasons.join(' ')).toMatch(/uniqueness|duplicate/i)
  })

  it('blocks strong negative emotion for bucket A creatives', () => {
    const creative = buildCreative({
      descriptions: [
        'Do not panic about bounce issues. Shop Now.',
        'No more embarrassing workouts. Learn More.',
        'Trusted support for daily exercise.'
      ]
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en',
      bucket: 'A'
    })

    expect(result.conversion.passed).toBe(false)
    expect(result.conversion.reasons.join(' ')).toMatch(/strong negative emotion/i)
  })

  it('does not require mild pain cue for bucket B creatives by default', () => {
    const creative = buildCreative({
      descriptions: [
        'Premium comfort and breathable fit. Shop Now.',
        'Trusted quality for training sessions. Learn More.',
        'Lightweight support for daily wear.'
      ]
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en',
      bucket: 'B'
    })

    expect(result.conversion.passed).toBe(true)
  })

  it('does not hard-require trust token for english bucket B creatives', () => {
    const creative = buildCreative({
      descriptions: [
        'Premium comfort and breathable fit. Shop Now.',
        'Save more with lightweight comfort for daily wear.',
        'Efficient cooling fabric for long workouts. Learn More.'
      ],
      callouts: ['Breathable Fabric', 'Save More'],
      sitelinks: [{ text: 'Shop Activewear', url: '/', description: 'Best Value Deals' }]
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en',
      bucket: 'B'
    })

    expect(result.conversion.hasTrust).toBe(false)
    expect(result.conversion.passed).toBe(true)
  })

  it('keeps trust token hard-required for english bucket A creatives', () => {
    const creative = buildCreative({
      descriptions: [
        'Premium comfort and breathable fit. Shop Now.',
        'Save more with lightweight comfort for daily wear.',
        'Efficient cooling fabric for long workouts. Learn More.'
      ],
      callouts: ['Breathable Fabric', 'Save More'],
      sitelinks: [{ text: 'Shop Activewear', url: '/', description: 'Best Value Deals' }]
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en',
      bucket: 'A'
    })

    expect(result.conversion.passed).toBe(false)
    expect(result.conversion.reasons.join(' ')).toMatch(/missing trust\/proof signal/i)
  })

  it('does not hard-require value signal for english store bucket A creatives', () => {
    const creative = buildCreative({
      descriptions: [
        'Official FitFlow support for active routines. Shop Now.',
        'Trusted quality and secure checkout. Learn More.',
        'Certified materials for daily workouts.'
      ],
      callouts: ['Official Store', 'Trusted Quality'],
      sitelinks: [{ text: 'Shop FitFlow', url: '/', description: 'Official Support' }]
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en',
      bucket: 'A',
      pageType: 'store'
    })

    expect(result.conversion.hasValue).toBe(false)
    expect(result.conversion.passed).toBe(true)
  })

  it('skips off-topic tool-noise blocking for store bucket A creatives', () => {
    const creative = buildCreative({
      headlines: [
        'Zoro Official Industrial Supply',
        'Trusted Maintenance Tool Source',
        'Shop Zoro Business Essentials'
      ],
      descriptions: [
        'Official Zoro store for industrial buyers. Shop Now.',
        'Trusted fulfillment and secure checkout. Learn More.',
        'Certified support for maintenance teams.'
      ],
      keywords: ['zoro industrial supply', 'zoro maintenance tools']
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'Zoro',
      category: 'Industrial Supply',
      productName: '',
      productTitle: 'Zoro Industrial Supply',
      productDescription: 'Industrial supplies and business tools',
      keywords: creative.keywords,
      targetLanguage: 'en',
      bucket: 'A',
      pageType: 'store'
    })

    expect(result.relevance.passed).toBe(true)
    expect(result.relevance.offTopicHits).toEqual([])
  })

  it('accepts practical benefit wording as value signal in english conversion gate', () => {
    const creative = buildCreative({
      descriptions: [
        'Trusted quality with efficient cooling performance. Shop Now.',
        'Tankless filtration design for clean daily water. Learn More.',
        'Official support for long-term use.'
      ]
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'Waterdrop',
      category: 'Water Filter',
      productName: 'Waterdrop X16 Filtration System',
      productTitle: 'Waterdrop X16',
      keywords: ['water filter', 'filtration system'],
      targetLanguage: 'en',
      bucket: 'A'
    })

    expect(result.conversion.hasValue).toBe(true)
    expect(result.conversion.passed).toBe(true)
  })

  it('can require mild pain cue for bucket B creatives when strict flag is enabled', () => {
    process.env.AD_CREATIVE_RULE_GATE_REQUIRE_BUCKET_B_PAIN_CUE = '1'
    const creative = buildCreative({
      descriptions: [
        'Premium comfort and breathable fit. Shop Now.',
        'Trusted quality for training sessions. Learn More.',
        'Lightweight support for daily wear.'
      ]
    })

    const result = evaluateCreativeRuleGate(creative, {
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: creative.keywords,
      targetLanguage: 'en',
      bucket: 'B'
    })

    expect(result.conversion.passed).toBe(false)
    expect(result.conversion.reasons.join(' ')).toMatch(/pain-point cue/i)
    delete process.env.AD_CREATIVE_RULE_GATE_REQUIRE_BUCKET_B_PAIN_CUE
  })

  it('filters noisy prompt extras by relevance context', () => {
    const context = createCreativeRuleContext({
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: ['sports bra', 'workout bra'],
      targetLanguage: 'en'
    })

    const filtered = filterPromptExtrasByRelevance([
      'CORE FEATURES: Breathable fabric, medium support',
      'COMPETITOR WEAKNESSES: Great for tackle repairs and drill projects'
    ], context)

    expect(filtered.filtered.length).toBe(1)
    expect(filtered.removed.length).toBe(1)
    expect(filtered.removed[0]).toMatch(/repair|drill/i)
  })

  it('filters weak sales-rank prompt extras', () => {
    const context = createCreativeRuleContext({
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: ['sports bra', 'workout bra'],
      targetLanguage: 'en'
    })

    const filtered = filterPromptExtrasByRelevance([
      'SALES RANK: #18,696',
      'CORE FEATURES: Breathable fabric, medium support'
    ], context)

    expect(filtered.filtered).toEqual(['CORE FEATURES: Breathable fabric, medium support'])
    expect(filtered.removed.length).toBe(1)
    expect(filtered.removed[0]).toMatch(/weak_rank|#18,696/i)
  })

  it('filters risky social-proof extras', () => {
    const context = createCreativeRuleContext({
      brandName: 'FitFlow',
      category: 'Sports Bra',
      productName: 'Women Sports Bra',
      productTitle: 'FitFlow Seamless Sports Bra',
      keywords: ['sports bra', 'workout bra'],
      targetLanguage: 'en'
    })

    const filtered = filterPromptExtrasByRelevance([
      'SOCIAL PROOF: 80% of women love this bra',
      'TOP REVIEWS: It is awesome and comfy',
      'CORE FEATURES: Breathable fabric, medium support'
    ], context)

    expect(filtered.filtered).toEqual(['CORE FEATURES: Breathable fabric, medium support'])
    expect(filtered.removed.length).toBe(2)
    expect(filtered.removed.join(' ')).toMatch(/trust_risk|80% of women love|awesome/i)
  })
})
