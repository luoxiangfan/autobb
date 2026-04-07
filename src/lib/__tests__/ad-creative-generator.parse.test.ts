import { describe, expect, it, vi } from 'vitest'
import {
  AD_CREATIVE_EMERGENCY_RETRY_RESPONSE_SCHEMA,
  AD_CREATIVE_RESPONSE_SCHEMA,
  AD_CREATIVE_RETRY_RESPONSE_SCHEMA,
  buildEmergencyAdCreativeRetryPrompt,
  buildSimplifiedAdCreativeRetryPrompt,
  filterModelIntentGeneratedKeywords,
  parseAIResponse,
  resolveAdCreativeRetryPlan,
  validateGeneratedAdCreativeBusinessLimits,
} from '../ad-creative-generator'

describe('ad-creative-generator.parseAIResponse', () => {
  it('keeps Gemini transport schema within the conservative structured-output subset', () => {
    const schemaText = JSON.stringify(AD_CREATIVE_RESPONSE_SCHEMA)
    const retrySchemaText = JSON.stringify(AD_CREATIVE_RETRY_RESPONSE_SCHEMA)
    const emergencySchemaText = JSON.stringify(AD_CREATIVE_EMERGENCY_RETRY_RESPONSE_SCHEMA)

    expect(schemaText).not.toContain('maxLength')
    expect(schemaText).not.toContain('minLength')
    expect(schemaText).not.toContain('minimum')
    expect(schemaText).not.toContain('maximum')
    expect(schemaText).not.toContain('keywordCandidates')
    expect(schemaText).not.toContain('evidenceProducts')
    expect(schemaText).not.toContain('cannotGenerateReason')
    expect(schemaText).not.toContain('copyAngle')
    expect(retrySchemaText).not.toContain('maxLength')
    expect(retrySchemaText).not.toContain('keywordCandidates')
    expect(retrySchemaText).not.toContain('evidenceProducts')
    expect(retrySchemaText).not.toContain('cannotGenerateReason')
    expect(emergencySchemaText).not.toContain('maxLength')
    expect(emergencySchemaText).not.toContain('keywordCandidates')
    expect(emergencySchemaText).not.toContain('evidenceProducts')
    expect(emergencySchemaText).not.toContain('cannotGenerateReason')
  })

  it('builds a simplified retry prompt that strips optional metadata instructions', () => {
    const basePrompt = `header\n## 输出（JSON only）\nold output section\n## Structured Evidence Metadata (recommended)\nmetadata`
    const retryPrompt = buildSimplifiedAdCreativeRetryPrompt(basePrompt)

    expect(retryPrompt).toContain('## RETRY OVERRIDE (CRITICAL)')
    expect(retryPrompt).not.toContain('old output section')
    expect(retryPrompt).not.toContain('Structured Evidence Metadata')
    expect(retryPrompt).toContain('Do NOT return copyAngle, keywordCandidates, evidenceProducts')
  })

  it('builds an emergency retry prompt with the reduced output contract', () => {
    const basePrompt = `header\n## 输出（JSON only）\nold output section`
    const retryPrompt = buildEmergencyAdCreativeRetryPrompt(basePrompt)

    expect(retryPrompt).toContain('## EMERGENCY OUTPUT CONTRACT (CRITICAL)')
    expect(retryPrompt).toContain('Return ONLY the five required top-level fields')
    expect(retryPrompt).toContain('omit length, group, theme, path1, path2, explanation')
    expect(retryPrompt).not.toContain('old output section')
  })

  it('routes runaway MAX_TOKENS failures to the emergency retry path', () => {
    expect(resolveAdCreativeRetryPlan({
      code: 'MAX_TOKENS',
      isRunawayCandidate: true,
      message: 'Gemini API 输出达到token限制被截断。',
    }, false)).toEqual({
      mode: 'emergency',
      reason: 'max_tokens_runaway',
    })

    expect(resolveAdCreativeRetryPlan({
      code: 'MAX_TOKENS',
      message: 'Gemini API 输出达到token限制被截断。',
    }, false)).toEqual({
      mode: 'simplified',
      reason: 'max_tokens',
    })
  })

  it('enforces exact business limits after parsing', () => {
    const creative = validateGeneratedAdCreativeBusinessLimits({
      headlines: Array.from({ length: 16 }, (_, i) => `Headline ${i + 1}`),
      descriptions: Array.from({ length: 5 }, (_, i) => `Description ${i + 1}`),
      keywords: Array.from({ length: 22 }, (_, i) => `keyword ${i + 1}`),
      callouts: Array.from({ length: 7 }, (_, i) => `Callout ${i + 1}`),
      sitelinks: Array.from({ length: 7 }, (_, i) => ({
        text: `Link ${i + 1}`,
        url: '/',
        description: `Description ${i + 1}`,
      })),
      theme: 'Theme',
      explanation: 'Explanation',
    })

    expect(creative.headlines).toHaveLength(15)
    expect(creative.descriptions).toHaveLength(4)
    expect(creative.keywords).toHaveLength(20)
    expect(creative.callouts).toHaveLength(6)
    expect(creative.sitelinks).toHaveLength(6)
  })

  it('throws when business-limit minimums are missing', () => {
    expect(() => validateGeneratedAdCreativeBusinessLimits({
      headlines: ['H1', 'H2', 'H3'],
      descriptions: ['D1', 'D2'],
      keywords: ['k1', 'k2', 'k3'],
      callouts: ['c1'],
      sitelinks: [{ text: 'Link', url: '/' }],
      theme: 'Theme',
      explanation: 'Explanation',
    })).toThrow('广告创意业务约束未满足')
  })

  it('filters transactional+model template keywords for model_intent bucket', () => {
    const result = filterModelIntentGeneratedKeywords({
      headlines: Array.from({ length: 15 }, (_, i) => `Headline ${i + 1}`),
      descriptions: Array.from({ length: 4 }, (_, i) => `Description ${i + 1}`),
      keywords: [
        'brandx x200 vacuum',
        'buy brandx x200 vacuum',
        'brandx gen 2 ring price',
        'brandx x300 vacuum',
        'brandx x400 vacuum',
        'brandx x500 vacuum',
        'brandx x600 vacuum',
        'brandx x700 vacuum',
        'brandx x800 vacuum',
        'brandx x900 vacuum',
      ],
      callouts: Array.from({ length: 6 }, (_, i) => `Callout ${i + 1}`),
      sitelinks: Array.from({ length: 6 }, (_, i) => ({
        text: `Link ${i + 1}`,
        url: '/',
        description: `Description ${i + 1}`,
      })),
      theme: 'Theme',
      explanation: 'Explanation',
    }, 'B')

    expect(result.keywords).toEqual([
      'brandx x200 vacuum',
      'brandx x300 vacuum',
      'brandx x400 vacuum',
      'brandx x500 vacuum',
      'brandx x600 vacuum',
      'brandx x700 vacuum',
      'brandx x800 vacuum',
      'brandx x900 vacuum',
    ])
  })

  it('keeps keywords unchanged outside model_intent bucket', () => {
    const creative = {
      headlines: Array.from({ length: 15 }, (_, i) => `Headline ${i + 1}`),
      descriptions: Array.from({ length: 4 }, (_, i) => `Description ${i + 1}`),
      keywords: [
        'buy brandx x200 vacuum',
        'brandx x200 vacuum price',
        'brandx cordless vacuum',
        'brandx vacuum cleaner',
        'brandx pet vacuum',
        'brandx lightweight vacuum',
        'brandx quiet vacuum',
        'brandx fast charging vacuum',
        'brandx auto empty vacuum',
        'brandx vacuum deals',
      ],
      callouts: Array.from({ length: 6 }, (_, i) => `Callout ${i + 1}`),
      sitelinks: Array.from({ length: 6 }, (_, i) => ({
        text: `Link ${i + 1}`,
        url: '/',
        description: `Description ${i + 1}`,
      })),
      theme: 'Theme',
      explanation: 'Explanation',
    }

    const result = filterModelIntentGeneratedKeywords(creative, 'D')
    expect(result.keywords).toEqual(creative.keywords)
  })

  it('parses responsive_search_ads format (objects with text/group)', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const aiText = `\`\`\`json
{
  "responsive_search_ads": {
    "headlines": [
      { "group": "Brand", "text": "{KeyWord:Colijoy} Official Store" },
      { "group": "Brand", "text": "Colijoy Custom Photo Blanket" },
      { "group": "Features", "text": "Crystal Clear HD Printing" }
    ],
    "descriptions": [
      { "group": "Benefits", "text": "Premium HD printing & soft flannel." },
      { "group": "Benefits", "text": "Upload photos fast. Ships quickly." }
    ],
    "keywords": ["colijoy", "colijoy photo blanket"],
    "callouts": ["Free Shipping", "Easy Customization"],
    "sitelinks": [
      { "text": "Shop Blankets", "url": "https://example.com", "description": "Pick your size & style." }
    ]
  }
}
\`\`\``

    const result = parseAIResponse(aiText)
    expect(result.headlines.length).toBeGreaterThanOrEqual(3)
    expect(result.descriptions.length).toBeGreaterThanOrEqual(2)
    expect(result.keywords.length).toBeGreaterThanOrEqual(1)
    expect(result.callouts.length).toBeGreaterThanOrEqual(1)
    expect(result.sitelinks.length).toBeGreaterThanOrEqual(1)
    expect(result.headlines[0]).toContain('Colijoy')
  })

  it('clamps RSA asset counts (≤15 headlines, ≤4 descriptions)', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const payload = {
      responsive_search_ads: {
        headlines: Array.from({ length: 16 }, (_, i) => ({ group: 'Test', text: `Headline ${i + 1}` })),
        descriptions: Array.from({ length: 5 }, (_, i) => ({ group: 'Test', text: `Description ${i + 1}` })),
        keywords: ['kw1', 'kw2'],
        callouts: ['Callout 1'],
        sitelinks: [{ text: 'Sitelink 1', url: 'https://example.com', description: 'Desc' }],
      },
    }

    const aiText = `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``

    const result = parseAIResponse(aiText)
    expect(result.headlines).toHaveLength(15)
    expect(result.descriptions).toHaveLength(4)
  })

  it('repairs missing commas between objects in arrays', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const aiText = `{
  "headlines": [
    {"text": "A", "type": "brand", "length": 1}
    {"text": "B", "type": "feature", "length": 1},
    {"text": "C", "type": "cta", "length": 1}
  ],
  "descriptions": [
    {"text": "Desc 1", "type": "feature-benefit-cta", "length": 6}
    {"text": "Desc 2", "type": "feature-benefit-cta", "length": 6}
  ],
  "keywords": ["k1", "k2", "k3"],
  "callouts": ["Callout 1"],
  "sitelinks": [{"text": "Link 1", "url": "/", "description": "Desc"}]
}`

    const result = parseAIResponse(aiText)
    expect(result.headlines.length).toBeGreaterThanOrEqual(3)
    expect(result.descriptions.length).toBeGreaterThanOrEqual(2)
  })

  it('repairs raw newlines inside string values', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const aiText = `{
  "headlines": [
    {"text": "Line1
Line2", "type": "brand", "length": 10},
    {"text": "Two", "type": "feature", "length": 3},
    {"text": "Three", "type": "cta", "length": 5}
  ],
  "descriptions": [
    {"text": "Desc line1
line2", "type": "feature-benefit-cta", "length": 10},
    {"text": "Desc two", "type": "feature-benefit-cta", "length": 8}
  ],
  "keywords": ["k1", "k2", "k3"],
  "callouts": ["Callout 1"],
  "sitelinks": [{"text": "Link 1", "url": "/", "description": "Desc"}]
}`

    const result = parseAIResponse(aiText)
    expect(result.headlines[0]).toContain('Line1 Line2')
    expect(result.descriptions[0]).toContain('Desc line1 line2')
  })

  it('sanitizes policy-sensitive health terms in assets and keywords', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const aiText = `{
  "headlines": [
    {"text": "Sleep Apnea Ring", "type": "brand", "length": 16},
    {"text": "Diagnose Overnight", "type": "feature", "length": 18},
    {"text": "Clinical Sleep Tracking", "type": "cta", "length": 22}
  ],
  "descriptions": [
    {"text": "Diagnose sleep apnea at home.", "type": "feature-benefit-cta", "length": 30},
    {"text": "Treatment insights for patients.", "type": "feature-benefit-cta", "length": 31}
  ],
  "keywords": ["ringconn sleep apnea monitoring", "sleep apnea diagnosis ring", "clinical sleep ring"],
  "callouts": ["Sleep Apnea Support", "Clinical Grade Tracking"],
  "sitelinks": [{"text": "Sleep Apnea Info", "url": "/", "description": "Diagnosis and treatment guide"}]
}`

    const result = parseAIResponse(aiText)
    const combinedText = [
      ...result.headlines,
      ...result.descriptions,
      ...(result.callouts || []),
      ...(result.sitelinks || []).map((s) => `${s.text} ${s.description || ''}`),
      ...result.keywords
    ].join(' ').toLowerCase()

    expect(combinedText).not.toContain('sleep apnea')
    expect(combinedText).not.toContain('diagnos')
    expect(combinedText).not.toContain('clinical')
    expect(result.keywords.some((kw) => kw.toLowerCase().includes('sleep quality'))).toBe(true)
  })

  it('applies text guardrails to avoid broken truncation tails and unbalanced parentheses', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const aiText = `{
  "headlines": [
    {"text": "{KeyWord:Dreo} Official", "type": "brand", "length": 24},
    {"text": "Dreo 14000 BTU ASHRAE (10000 BTU DOE) Smart AC", "type": "feature", "length": 47},
    {"text": "Shop Dreo Portable Air Conditioner For Bedroom Cooling", "type": "cta", "length": 54}
  ],
  "descriptions": [
    {"text": "Experience Dreo cooling comfort with 14000 BTU power and low noise sleep mode. Shop No", "type": "feature-benefit-cta", "length": 94},
    {"text": "Drainage-free cooling plus app control for daily comfort in summer rooms and apartments", "type": "feature-benefit-cta", "length": 95}
  ],
  "keywords": ["dreo portable air conditioner", "dreo air conditioner"],
  "callouts": ["Free Shipping", "Official Store"],
  "sitelinks": [{"text": "Shop Dreo", "url": "/", "description": "Learn more"}]
}`

    const result = parseAIResponse(aiText)

    expect(result.headlines.every((h) => h.length <= 30)).toBe(true)
    expect(result.descriptions.every((d) => d.length <= 90)).toBe(true)
    expect(result.descriptions[0].toLowerCase().endsWith('shop no')).toBe(false)
    expect(result.headlines[1].split('(').length - 1).toBe(result.headlines[1].split(')').length - 1)
  })

  it('preserves optional structured metadata fields for auditability', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const aiText = `{
  "copyAngle": "Brand + verified hot model coverage",
  "headlines": [
    {"text": "BrandX X200 Vacuum", "type": "brand", "length": 20},
    {"text": "BrandX X100 Series", "type": "feature", "length": 19},
    {"text": "Shop BrandX Robot Vacs", "type": "cta", "length": 23}
  ],
  "descriptions": [
    {"text": "Shop BrandX X200 and X100 robot vacuum models today.", "type": "feature-benefit-cta", "length": 55},
    {"text": "Verified hot products only, no unsupported model claims.", "type": "usp-differentiation", "length": 57}
  ],
  "keywords": ["brandx x200 vacuum", "brandx x100 vacuum", "brandx robot vacuum"],
  "keywordCandidates": [
    {
      "text": "brandx x200 vacuum",
      "sourceType": "search_term",
      "sourceField": "topProducts",
      "anchorType": "model",
      "evidence": ["deepScrapeResults.topProducts[0].title", "search_terms:brandx x200 vacuum"],
      "suggestedMatchType": "EXACT",
      "confidence": 0.96,
      "qualityReason": "verified model from hot products"
    },
    {
      "text": "brandx robot vacuum",
      "sourceType": "planner",
      "sourceField": "title",
      "anchorType": "category",
      "evidence": ["productTitle", "planner:brandx robot vacuum"],
      "suggestedMatchType": "PHRASE",
      "confidence": 0.82,
      "qualityReason": "verified category demand",
      "rejectionReason": "drop if model evidence is required"
    }
  ],
  "evidenceProducts": ["BrandX X200 Vacuum", "BrandX X100 Vacuum"],
  "callouts": ["Free Shipping"],
  "sitelinks": [{"text": "Shop X200", "url": "/", "description": "Verified hot model"}]
}`

    const result = parseAIResponse(aiText)
    expect(result.copyAngle).toBe('Brand + verified hot model coverage')
    expect(result.evidenceProducts).toEqual(['BrandX X200 Vacuum', 'BrandX X100 Vacuum'])
    expect(result.keywordCandidates).toEqual([
      {
        text: 'brandx x200 vacuum',
        sourceType: 'search_term',
        sourceField: 'topProducts',
        anchorType: 'model',
        evidence: ['deepScrapeResults.topProducts[0].title', 'search_terms:brandx x200 vacuum'],
        suggestedMatchType: 'EXACT',
        confidence: 0.96,
        qualityReason: 'verified model from hot products',
      },
      {
        text: 'brandx robot vacuum',
        sourceType: 'planner',
        sourceField: 'title',
        anchorType: 'category',
        evidence: ['productTitle', 'planner:brandx robot vacuum'],
        suggestedMatchType: 'PHRASE',
        confidence: 0.82,
        qualityReason: 'verified category demand',
        rejectionReason: 'drop if model evidence is required',
      },
    ])
  })
})
