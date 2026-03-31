/**
 * 关键词优先级分类器单元测试
 */

import {
  classifyKeywordPriority,
  validatePriorityDistribution,
  suggestKeywordsForMissingPriority,
  generatePriorityDistributionSummary,
  type KeywordPriority
} from '../keyword-priority-classifier'
import { mockKeywords, mockOffers } from './test-utils'

describe('KeywordPriorityClassifier', () => {
  describe('classifyKeywordPriority', () => {
    it('should classify Brand keywords correctly', () => {
      const keywords = [
        'eufy',
        'eufy robot vacuum',
        'eufy official',
        'eufy store'
      ]

      for (const keyword of keywords) {
        const result = classifyKeywordPriority(keyword, mockOffers.eufy)
        expect(result.priority).toBe('Brand')
        expect(result.confidence).toBeGreaterThan(0.5)
      }
    })

    it('should classify Core keywords correctly', () => {
      const keywords = [
        'robot vacuum',
        'smart vacuum',
        'automated cleaning',
        'robot cleaner'
      ]

      for (const keyword of keywords) {
        const result = classifyKeywordPriority(keyword)
        expect(result.priority).toBe('Core')
      }
    })

    it('should classify Intent keywords correctly', () => {
      const keywords = [
        'best robot vacuum',
        'cheap robot vacuum',
        'affordable robot vacuum',
        'robot vacuum for pets'
      ]

      for (const keyword of keywords) {
        const result = classifyKeywordPriority(keyword)
        expect(result.priority).toBe('Intent')
      }
    })

    it('should classify LongTail keywords correctly', () => {
      const keywords = [
        'best robot vacuum for pet hair',
        'robot vacuum with app control',
        'quiet robot vacuum for small apartments',
        'robot vacuum with mopping'
      ]

      for (const keyword of keywords) {
        const result = classifyKeywordPriority(keyword)
        expect(result.priority).toBe('LongTail')
      }
    })

    it('should prioritize Brand keywords when brand is provided', () => {
      const result = classifyKeywordPriority('eufy robot vacuum', mockOffers.eufy)
      expect(result.priority).toBe('Brand')
      expect(result.confidence).toBeGreaterThan(0.8)
    })

    it('should handle keywords without brand', () => {
      const result = classifyKeywordPriority('robot vacuum')
      expect(result.priority).toBeDefined()
      expect(['Core', 'Intent', 'LongTail']).toContain(result.priority)
    })

    it('should calculate confidence score', () => {
      const result = classifyKeywordPriority('best robot vacuum for pet hair')
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    })
  })

  describe('validatePriorityDistribution', () => {
    it('should validate complete priority distribution', () => {
      const report = validatePriorityDistribution(mockKeywords.complete, mockOffers.eufy)
      expect(report.isSatisfied).toBe(true)
      expect(report.missing.length).toBe(0)
      expect(report.excess.length).toBe(0)
    })

    it('should detect missing priorities', () => {
      const report = validatePriorityDistribution(mockKeywords.incomplete, mockOffers.eufy)
      expect(report.isSatisfied).toBe(false)
      expect(report.missing.length).toBeGreaterThan(0)
    })

    it('should count priorities correctly', () => {
      const report = validatePriorityDistribution(mockKeywords.complete, mockOffers.eufy)
      expect(report.distribution.Brand).toBeGreaterThanOrEqual(8)
      expect(report.distribution.Core).toBeGreaterThanOrEqual(6)
      expect(report.distribution.Intent).toBeGreaterThanOrEqual(3)
      expect(report.distribution.LongTail).toBeGreaterThanOrEqual(3)
    })

    it('should check expected ranges', () => {
      const report = validatePriorityDistribution(mockKeywords.complete, mockOffers.eufy)
      expect(report.expected.Brand).toEqual([8, 10])
      expect(report.expected.Core).toEqual([6, 8])
      expect(report.expected.Intent).toEqual([3, 5])
      expect(report.expected.LongTail).toEqual([3, 7])
    })

    it('should generate recommendations for missing priorities', () => {
      const report = validatePriorityDistribution(mockKeywords.incomplete, mockOffers.eufy)
      expect(report.recommendations.length).toBeGreaterThan(0)
      expect(report.recommendations[0]).toContain('Need')
    })

    it('should detect excess priorities', () => {
      const excessKeywords = [
        ...mockKeywords.complete,
        ...mockKeywords.complete.slice(0, 5)
      ]
      const report = validatePriorityDistribution(excessKeywords, mockOffers.eufy)
      if (report.excess.length > 0) {
        expect(report.recommendations.some(r => r.includes('Too many'))).toBe(true)
      }
    })

    it('should include classification details', () => {
      const report = validatePriorityDistribution(mockKeywords.complete, mockOffers.eufy)
      expect(report.details.length).toBe(mockKeywords.complete.length)
      expect(report.details[0]).toHaveProperty('keyword')
      expect(report.details[0]).toHaveProperty('priority')
      expect(report.details[0]).toHaveProperty('confidence')
    })

    it('should handle empty keywords array', () => {
      const report = validatePriorityDistribution([], mockOffers.eufy)
      expect(report.isSatisfied).toBe(false)
      expect(report.distribution.Brand).toBe(0)
    })

    it('should handle single keyword', () => {
      const report = validatePriorityDistribution([{ keyword: 'eufy', searchVolume: 5000 }], mockOffers.eufy)
      expect(report.details.length).toBe(1)
    })

    it('should check total keyword count', () => {
      const report = validatePriorityDistribution(mockKeywords.complete, mockOffers.eufy)
      const total = Object.values(report.distribution).reduce((a, b) => a + b, 0)
      expect(total).toBeGreaterThanOrEqual(20)
      expect(total).toBeLessThanOrEqual(30)
    })
  })

  describe('suggestKeywordsForMissingPriority', () => {
    it('should suggest Brand keywords', () => {
      const suggestions = suggestKeywordsForMissingPriority(['Brand'], 'Eufy', 'Robot Vacuum')
      expect(suggestions.Brand.length).toBeGreaterThan(0)
      expect(suggestions.Brand[0]).toContain('eufy')
    })

    it('should suggest Core keywords', () => {
      const suggestions = suggestKeywordsForMissingPriority(['Core'], 'Eufy', 'Robot Vacuum')
      expect(suggestions.Core.length).toBeGreaterThan(0)
      expect(suggestions.Core[0]).toContain('robot vacuum')
    })

    it('should suggest Intent keywords', () => {
      const suggestions = suggestKeywordsForMissingPriority(['Intent'], 'Eufy', 'Robot Vacuum')
      expect(suggestions.Intent.length).toBeGreaterThan(0)
      expect(suggestions.Intent[0]).toMatch(/best|cheap|affordable|sale/i)
    })

    it('should suggest LongTail keywords', () => {
      const suggestions = suggestKeywordsForMissingPriority(['LongTail'], 'Eufy', 'Robot Vacuum', ['4K', 'Battery'])
      expect(suggestions.LongTail.length).toBeGreaterThan(0)
      expect(suggestions.LongTail[0].split(' ').length).toBeGreaterThanOrEqual(4)
    })

    it('should suggest multiple missing priorities', () => {
      const suggestions = suggestKeywordsForMissingPriority(['Brand', 'Core', 'Intent'], 'Eufy', 'Robot Vacuum')
      expect(suggestions.Brand.length).toBeGreaterThan(0)
      expect(suggestions.Core.length).toBeGreaterThan(0)
      expect(suggestions.Intent.length).toBeGreaterThan(0)
    })

    it('should include product features in suggestions', () => {
      const suggestions = suggestKeywordsForMissingPriority(['LongTail'], 'Eufy', 'Robot Vacuum', ['4K', 'Battery'])
      expect(suggestions.LongTail.some(kw => kw.includes('4K') || kw.includes('Battery'))).toBe(true)
    })

    it('should handle empty missing priorities', () => {
      const suggestions = suggestKeywordsForMissingPriority([], 'Eufy', 'Robot Vacuum')
      expect(Object.values(suggestions).every(arr => arr.length === 0)).toBe(true)
    })
  })

  describe('generatePriorityDistributionSummary', () => {
    it('should generate summary for satisfied distribution', () => {
      const report = validatePriorityDistribution(mockKeywords.complete, mockOffers.eufy)
      const summary = generatePriorityDistributionSummary(report)
      expect(summary).toContain('SATISFIED')
      expect(summary).toContain('✅')
    })

    it('should generate summary for unsatisfied distribution', () => {
      const report = validatePriorityDistribution(mockKeywords.incomplete, mockOffers.eufy)
      const summary = generatePriorityDistributionSummary(report)
      expect(summary).toContain('NOT SATISFIED')
      expect(summary).toContain('❌')
    })

    it('should include distribution details', () => {
      const report = validatePriorityDistribution(mockKeywords.complete, mockOffers.eufy)
      const summary = generatePriorityDistributionSummary(report)
      expect(summary).toContain('Brand')
      expect(summary).toContain('Core')
      expect(summary).toContain('Intent')
      expect(summary).toContain('LongTail')
    })

    it('should include total count', () => {
      const report = validatePriorityDistribution(mockKeywords.complete, mockOffers.eufy)
      const summary = generatePriorityDistributionSummary(report)
      expect(summary).toContain('Total')
    })

    it('should include recommendations', () => {
      const report = validatePriorityDistribution(mockKeywords.incomplete, mockOffers.eufy)
      const summary = generatePriorityDistributionSummary(report)
      if (report.recommendations.length > 0) {
        expect(summary).toContain('Recommendations')
      }
    })
  })

  describe('Multi-language support', () => {
    it('should handle German keywords', () => {
      const report = validatePriorityDistribution(mockKeywords.complete, mockOffers.eufyDE)
      expect(report).toHaveProperty('distribution')
      expect(report).toHaveProperty('isSatisfied')
    })

    it('should handle Italian keywords', () => {
      const report = validatePriorityDistribution(mockKeywords.complete, mockOffers.eufyIT)
      expect(report).toHaveProperty('distribution')
      expect(report).toHaveProperty('isSatisfied')
    })

    it('should handle Japanese keywords', () => {
      const report = validatePriorityDistribution(mockKeywords.complete, mockOffers.eufyJA)
      expect(report).toHaveProperty('distribution')
      expect(report).toHaveProperty('isSatisfied')
    })
  })

  describe('Edge cases', () => {
    it('should handle very long keywords', () => {
      const longKeyword = 'best robot vacuum for pet hair with app control and self emptying'
      const result = classifyKeywordPriority(longKeyword)
      expect(result.priority).toBeDefined()
    })

    it('should handle single word keywords', () => {
      const result = classifyKeywordPriority('vacuum')
      expect(result.priority).toBeDefined()
    })

    it('should handle keywords with special characters', () => {
      const result = classifyKeywordPriority('robot-vacuum & cleaner')
      expect(result.priority).toBeDefined()
    })

    it('should handle keywords with numbers', () => {
      const result = classifyKeywordPriority('robot vacuum 2024')
      expect(result.priority).toBeDefined()
    })

    it('should handle mixed case keywords', () => {
      const keywords = [
        'ROBOT VACUUM',
        'robot vacuum',
        'Robot Vacuum'
      ]

      for (const keyword of keywords) {
        const result = classifyKeywordPriority(keyword)
        expect(result.priority).toBe('Core')
      }
    })
  })

  describe('Performance', () => {
    it('should classify keyword quickly', () => {
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        classifyKeywordPriority('robot vacuum', mockOffers.eufy)
      }
      const duration = performance.now() - start
      expect(duration).toBeLessThan(100)
    })

    it('should validate distribution quickly', () => {
      const start = performance.now()
      validatePriorityDistribution(mockKeywords.complete, mockOffers.eufy)
      const duration = performance.now() - start
      expect(duration).toBeLessThan(100)
    })

    it('should handle large keyword sets', () => {
      const largeKeywordSet = Array.from({ length: 100 }, (_, i) => ({
        keyword: `keyword ${i}`,
        searchVolume: Math.random() * 5000
      }))

      const start = performance.now()
      const report = validatePriorityDistribution(largeKeywordSet, mockOffers.eufy)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(200)
      expect(report).toHaveProperty('distribution')
    })
  })
})
