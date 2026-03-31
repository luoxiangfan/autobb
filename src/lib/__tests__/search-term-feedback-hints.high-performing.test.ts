import { classifySearchTermFeedbackTerms } from '../search-term-feedback-hints'
import type { SearchTermFeedbackAggregateRow } from '../search-term-feedback-hints'

describe('classifySearchTermFeedbackTerms - High Performing Terms', () => {
  it('should identify high-performing terms by CTR', () => {
    const rows: SearchTermFeedbackAggregateRow[] = [
      {
        search_term: 'best solar lights outdoor',
        impressions: 1000,
        clicks: 50, // 5% CTR
        cost: 25,
        conversions: 1,
        conversion_value: 30
      },
      {
        search_term: 'cheap solar lights',
        impressions: 2000,
        clicks: 10, // 0.5% CTR - low
        cost: 50,
        conversions: 0,
        conversion_value: 0
      }
    ]

    const result = classifySearchTermFeedbackTerms(rows, {
      dominantCurrency: 'USD',
      maxTerms: 10
    })

    expect(result.highPerformingTerms).toContain('best solar lights outdoor')
    expect(result.highPerformingTerms).not.toContain('cheap solar lights')
  })

  it('should identify high-performing terms by conversion rate', () => {
    const rows: SearchTermFeedbackAggregateRow[] = [
      {
        search_term: 'buy solar garden lights',
        impressions: 500,
        clicks: 20, // 4% CTR
        cost: 15,
        conversions: 3, // 15% conversion rate
        conversion_value: 90
      },
      {
        search_term: 'solar lights info',
        impressions: 1000,
        clicks: 20, // 2% CTR - below threshold
        cost: 20,
        conversions: 0, // 0% conversion rate
        conversion_value: 0
      }
    ]

    const result = classifySearchTermFeedbackTerms(rows, {
      dominantCurrency: 'USD',
      maxTerms: 10
    })

    expect(result.highPerformingTerms).toContain('buy solar garden lights')
    expect(result.highPerformingTerms).not.toContain('solar lights info')
  })

  it('should not classify high performers as negative terms', () => {
    const rows: SearchTermFeedbackAggregateRow[] = [
      {
        search_term: 'premium solar lights',
        impressions: 1000,
        clicks: 40, // 4% CTR - high performing
        cost: 80, // High CPC but good CTR
        conversions: 5,
        conversion_value: 150
      }
    ]

    const result = classifySearchTermFeedbackTerms(rows, {
      dominantCurrency: 'USD',
      maxTerms: 10
    })

    expect(result.highPerformingTerms).toContain('premium solar lights')
    expect(result.hardNegativeTerms).not.toContain('premium solar lights')
    expect(result.softSuppressTerms).not.toContain('premium solar lights')
  })

  it('should handle terms with no conversion data', () => {
    const rows: SearchTermFeedbackAggregateRow[] = [
      {
        search_term: 'solar lights outdoor waterproof',
        impressions: 800,
        clicks: 30, // 3.75% CTR - meets threshold
        cost: 20,
        conversions: 0, // No conversions but good CTR
        conversion_value: 0
      }
    ]

    const result = classifySearchTermFeedbackTerms(rows, {
      dominantCurrency: 'USD',
      maxTerms: 10
    })

    // Should still be identified as high performing based on CTR alone
    expect(result.highPerformingTerms).toContain('solar lights outdoor waterproof')
  })

  it('should deduplicate and limit high-performing terms', () => {
    const rows: SearchTermFeedbackAggregateRow[] = Array.from({ length: 30 }, (_, i) => ({
      search_term: `high performing term ${i}`,
      impressions: 1000,
      clicks: 50, // 5% CTR
      cost: 25,
      conversions: 3,
      conversion_value: 90
    }))

    const result = classifySearchTermFeedbackTerms(rows, {
      dominantCurrency: 'USD',
      maxTerms: 10
    })

    expect(result.highPerformingTerms.length).toBeLessThanOrEqual(10)
  })

  it('should sanitize and validate search terms', () => {
    const rows: SearchTermFeedbackAggregateRow[] = [
      {
        search_term: '  solar lights  ', // Extra spaces
        impressions: 1000,
        clicks: 50,
        cost: 25,
        conversions: 3,
        conversion_value: 90
      },
      {
        search_term: '123', // Pure numbers - should be filtered
        impressions: 1000,
        clicks: 50,
        cost: 25,
        conversions: 3,
        conversion_value: 90
      },
      {
        search_term: 'a', // Too short
        impressions: 1000,
        clicks: 50,
        cost: 25,
        conversions: 3,
        conversion_value: 90
      }
    ]

    const result = classifySearchTermFeedbackTerms(rows, {
      dominantCurrency: 'USD',
      maxTerms: 10
    })

    expect(result.highPerformingTerms).toContain('solar lights')
    expect(result.highPerformingTerms).not.toContain('123')
    expect(result.highPerformingTerms).not.toContain('a')
  })
})
