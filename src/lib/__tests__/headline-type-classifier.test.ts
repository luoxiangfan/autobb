/**
 * 标题类型分类器单元测试
 */

import {
  classifyHeadline,
  validateTypeCoverage,
  suggestHeadlinesForMissingTypes,
  generateTypeCoverageSummary,
  type HeadlineType
} from '../headline-type-classifier'
import { mockHeadlines } from './test-utils'

describe('HeadlineTypeClassifier', () => {
  describe('classifyHeadline', () => {
    it('should classify Brand headlines correctly', () => {
      const headlines = [
        'Official Eufy Store',
        '#1 Trusted Eufy',
        'Authentic Eufy Products'
      ]

      for (const headline of headlines) {
        const result = classifyHeadline(headline)
        expect(result.types).toContain('Brand')
        expect(result.confidence).toBeGreaterThanOrEqual(0.3)
      }
    })

    it('should classify Feature headlines correctly', () => {
      const headlines = [
        '4K Resolution Display',
        'Extended Battery Life',
        'Smart Navigation System'
      ]

      for (const headline of headlines) {
        const result = classifyHeadline(headline)
        expect(result.types).toContain('Feature')
        // 修复: 单个关键词匹配得分刚好0.3，应该用 >= 而不是 >
        expect(result.confidence).toBeGreaterThanOrEqual(0.3)
      }
    })

    it('should classify Promo headlines correctly', () => {
      const headlines = [
        'Save 30% Today',
        'Limited Time Offer',
        'Free Shipping'
      ]

      for (const headline of headlines) {
        const result = classifyHeadline(headline)
        expect(result.types).toContain('Promo')
        expect(result.confidence).toBeGreaterThanOrEqual(0.3)
      }
    })

    it('should classify CTA headlines correctly', () => {
      const headlines = [
        'Shop Now',
        'Get Yours Today',
        'Claim Your Deal'
      ]

      for (const headline of headlines) {
        const result = classifyHeadline(headline)
        expect(result.types).toContain('CTA')
        expect(result.confidence).toBeGreaterThanOrEqual(0.3)
      }
    })

    it('should classify Urgency headlines correctly', () => {
      const headlines = [
        'Only 5 Left in Stock',
        'Ends Tomorrow',
        'Limited Stock Available'
      ]

      for (const headline of headlines) {
        const result = classifyHeadline(headline)
        expect(result.types).toContain('Urgency')
        expect(result.confidence).toBeGreaterThanOrEqual(0.3)
      }
    })

    it('should handle multi-type headlines', () => {
      const headline = 'Official Eufy Store - Save 30% Today'
      const result = classifyHeadline(headline)
      expect(result.types.length).toBeGreaterThan(1)
    })

    it('should return empty types for unclassifiable headlines', () => {
      const headline = 'xyz abc def'
      const result = classifyHeadline(headline)
      expect(result.types.length).toBe(0)
    })
  })

  describe('validateTypeCoverage', () => {
    it('should validate complete type coverage', () => {
      const report = validateTypeCoverage(mockHeadlines.complete)
      expect(report.isSatisfied).toBe(true)
      expect(report.missing.length).toBe(0)
    })

    it('should detect missing types', () => {
      const report = validateTypeCoverage(mockHeadlines.incomplete)
      expect(report.isSatisfied).toBe(false)
      expect(report.missing.length).toBeGreaterThan(0)
    })

    it('should count types correctly', () => {
      const report = validateTypeCoverage(mockHeadlines.complete)
      expect(report.coverage.Brand).toBeGreaterThanOrEqual(2)
      expect(report.coverage.Feature).toBeGreaterThanOrEqual(4)
      expect(report.coverage.Promo).toBeGreaterThanOrEqual(3)
      expect(report.coverage.CTA).toBeGreaterThanOrEqual(3)
      expect(report.coverage.Urgency).toBeGreaterThanOrEqual(2)
    })

    it('should generate recommendations for missing types', () => {
      const report = validateTypeCoverage(mockHeadlines.incomplete)
      expect(report.recommendations.length).toBeGreaterThan(0)
      expect(report.recommendations[0]).toContain('Missing')
    })

    it('should include classification details', () => {
      const report = validateTypeCoverage(mockHeadlines.complete)
      expect(report.details.length).toBe(mockHeadlines.complete.length)
      expect(report.details[0]).toHaveProperty('headline')
      expect(report.details[0]).toHaveProperty('types')
      expect(report.details[0]).toHaveProperty('confidence')
    })

    it('should handle empty headlines array', () => {
      const report = validateTypeCoverage([])
      expect(report.isSatisfied).toBe(false)
      expect(report.coverage.Brand).toBe(0)
    })

    it('should handle single headline', () => {
      const report = validateTypeCoverage(['Official Eufy Store'])
      expect(report.details.length).toBe(1)
      expect(report.coverage.Brand).toBeGreaterThan(0)
    })
  })

  describe('suggestHeadlinesForMissingTypes', () => {
    it('should suggest Brand headlines', () => {
      const suggestions = suggestHeadlinesForMissingTypes(['Brand'], 'Eufy')
      expect(suggestions.Brand.length).toBeGreaterThan(0)
      expect(suggestions.Brand[0]).toContain('Eufy')
    })

    it('should suggest Feature headlines', () => {
      const suggestions = suggestHeadlinesForMissingTypes(['Feature'], 'Eufy', ['4K', 'Battery'])
      expect(suggestions.Feature.length).toBeGreaterThan(0)
    })

    it('should suggest Promo headlines', () => {
      const suggestions = suggestHeadlinesForMissingTypes(['Promo'], 'Eufy')
      expect(suggestions.Promo.length).toBeGreaterThan(0)
      expect(suggestions.Promo[0]).toMatch(/save|discount|offer|deal/i)
    })

    it('should suggest CTA headlines', () => {
      const suggestions = suggestHeadlinesForMissingTypes(['CTA'], 'Eufy')
      expect(suggestions.CTA.length).toBeGreaterThan(0)
      expect(suggestions.CTA[0]).toMatch(/shop|buy|get|claim/i)
    })

    it('should suggest Urgency headlines', () => {
      const suggestions = suggestHeadlinesForMissingTypes(['Urgency'], 'Eufy')
      expect(suggestions.Urgency.length).toBeGreaterThan(0)
      expect(suggestions.Urgency[0]).toMatch(/limited|only|ends/i)
    })

    it('should suggest multiple missing types', () => {
      const suggestions = suggestHeadlinesForMissingTypes(['Brand', 'Feature', 'Promo'], 'Eufy')
      expect(suggestions.Brand.length).toBeGreaterThan(0)
      expect(suggestions.Feature.length).toBeGreaterThan(0)
      expect(suggestions.Promo.length).toBeGreaterThan(0)
    })

    it('should handle empty missing types', () => {
      const suggestions = suggestHeadlinesForMissingTypes([], 'Eufy')
      expect(Object.values(suggestions).every(arr => arr.length === 0)).toBe(true)
    })
  })

  describe('generateTypeCoverageSummary', () => {
    it('should generate summary for satisfied coverage', () => {
      const report = validateTypeCoverage(mockHeadlines.complete)
      const summary = generateTypeCoverageSummary(report)
      expect(summary).toContain('SATISFIED')
      expect(summary).toContain('✅')
    })

    it('should generate summary for unsatisfied coverage', () => {
      const report = validateTypeCoverage(mockHeadlines.incomplete)
      const summary = generateTypeCoverageSummary(report)
      expect(summary).toContain('NOT SATISFIED')
      expect(summary).toContain('❌')
    })

    it('should include coverage details', () => {
      const report = validateTypeCoverage(mockHeadlines.complete)
      const summary = generateTypeCoverageSummary(report)
      expect(summary).toContain('Brand')
      expect(summary).toContain('Feature')
      expect(summary).toContain('Promo')
      expect(summary).toContain('CTA')
      expect(summary).toContain('Urgency')
    })

    it('should include recommendations', () => {
      const report = validateTypeCoverage(mockHeadlines.incomplete)
      const summary = generateTypeCoverageSummary(report)
      if (report.recommendations.length > 0) {
        expect(summary).toContain('Recommendations')
      }
    })
  })

  describe('Edge cases', () => {
    it('should handle very long headlines', () => {
      const longHeadline = 'A'.repeat(100)
      const result = classifyHeadline(longHeadline)
      expect(result).toHaveProperty('types')
      expect(result).toHaveProperty('confidence')
    })

    it('should handle special characters', () => {
      const headline = 'Official Eufy Store™ - Save 30% Today!'
      const result = classifyHeadline(headline)
      expect(result).toHaveProperty('types')
    })

    it('should handle mixed case', () => {
      const headlines = [
        'OFFICIAL EUFY STORE',
        'official eufy store',
        'Official Eufy Store'
      ]

      for (const headline of headlines) {
        const result = classifyHeadline(headline)
        expect(result.types).toContain('Brand')
      }
    })

    it('should handle headlines with numbers', () => {
      const headline = '4K Resolution 30% Off Today'
      const result = classifyHeadline(headline)
      expect(result.types.length).toBeGreaterThan(0)
    })
  })

  describe('Performance', () => {
    it('should classify headline quickly', () => {
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        classifyHeadline('Official Eufy Store')
      }
      const duration = performance.now() - start
      expect(duration).toBeLessThan(100) // Should complete 1000 classifications in <100ms
    })

    it('should validate coverage quickly', () => {
      const start = performance.now()
      validateTypeCoverage(mockHeadlines.complete)
      const duration = performance.now() - start
      expect(duration).toBeLessThan(50) // Should complete in <50ms
    })
  })
})
