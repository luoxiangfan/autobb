import { describe, expect, it } from 'vitest'
import { __testOnly } from '../ad-strength-evaluator'

describe('ad-strength-evaluator AI JSON parse', () => {
  it('parses pure JSON response', () => {
    const text = JSON.stringify({
      priceAdvantage: 2,
      uniqueMarketPosition: 3,
      competitiveComparison: 1,
      valueEmphasis: 1,
      confidence: 0.9,
    })

    const parsed = __testOnly.parseCompetitivePositioningAiScores(text)

    expect(parsed.priceAdvantage).toBe(2)
    expect(parsed.uniqueMarketPosition).toBe(3)
    expect(parsed.competitiveComparison).toBe(1)
    expect(parsed.valueEmphasis).toBe(1)
    expect(parsed.confidence).toBe(0.9)
  })

  it('parses fenced JSON when extra analysis text is appended', () => {
    const text = [
      '```json',
      '{',
      '  "priceAdvantage": 3,',
      '  "uniqueMarketPosition": 3,',
      '  "competitiveComparison": 1,',
      '  "valueEmphasis": 1,',
      '  "confidence": 1.0',
      '}',
      '```',
      '',
      '### Deep Semantic Analysis:',
      '- extra explanation text',
    ].join('\n')

    const parsed = __testOnly.parseCompetitivePositioningAiScores(text)

    expect(parsed.priceAdvantage).toBe(3)
    expect(parsed.uniqueMarketPosition).toBe(3)
    expect(parsed.competitiveComparison).toBe(1)
    expect(parsed.valueEmphasis).toBe(1)
    expect(parsed.confidence).toBe(1)
  })

  it('throws when response does not contain JSON object', () => {
    expect(() => {
      __testOnly.parseCompetitivePositioningAiScores('No JSON here, only prose')
    }).toThrow('AI响应未包含可解析的JSON对象')
  })
})
