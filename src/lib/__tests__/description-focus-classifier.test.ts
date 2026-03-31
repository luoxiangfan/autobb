/**
 * 描述焦点类型分类器单元测试
 */

import {
  classifyDescription,
  validateFocusCoverage,
  hasCTA,
  suggestDescriptionsForMissingFocus,
  generateFocusCoverageSummary,
  type DescriptionFocus
} from '../description-focus-classifier'
import { mockDescriptions } from './test-utils'

describe('DescriptionFocusClassifier', () => {
  describe('hasCTA', () => {
    it('should detect CTA in description', () => {
      const descriptions = [
        'Shop Now',
        'Buy Today',
        'Get Yours',
        'Claim Deal',
        'Order Now',
        'Discover More',
        'Learn More',
        'Start Free Trial'
      ]

      for (const desc of descriptions) {
        const result = hasCTA(desc)
        expect(result.hasCTA).toBe(true)
        expect(result.ctaWords.length).toBeGreaterThan(0)
      }
    })

    it('should not detect CTA when missing', () => {
      const descriptions = [
        'This is a great product',
        'High quality materials',
        'Available in multiple colors'
      ]

      for (const desc of descriptions) {
        const result = hasCTA(desc)
        expect(result.hasCTA).toBe(false)
        expect(result.ctaWords.length).toBe(0)
      }
    })

    it('should find multiple CTA words', () => {
      const result = hasCTA('Shop Now and Buy Today')
      expect(result.ctaWords.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('classifyDescription', () => {
    it('should classify Value focus correctly', () => {
      const descriptions = [
        'Award-Winning Tech. Rated 4.8 stars by 50K+ customers.',
        'Trusted by 100K+ Happy Customers',
        'Highly Rated Product'
      ]

      for (const desc of descriptions) {
        const result = classifyDescription(desc)
        expect(result.focus).toBe('Value')
        expect(result.confidence).toBeGreaterThan(0.3)
      }
    })

    it('should classify Action focus correctly', () => {
      const descriptions = [
        'Shop Now for Fast, Free Delivery',
        'Get Yours Today with Easy Returns',
        'Buy Now and Save'
      ]

      for (const desc of descriptions) {
        const result = classifyDescription(desc)
        expect(result.focus).toBe('Action')
        expect(result.confidence).toBeGreaterThan(0.3)
      }
    })

    it('should classify Feature focus correctly', () => {
      const descriptions = [
        '4K Resolution. Solar Powered. Works Rain or Shine.',
        'Advanced Technology. Smart Design.',
        'High Performance. Durable Quality.'
      ]

      for (const desc of descriptions) {
        const result = classifyDescription(desc)
        expect(result.focus).toBe('Feature')
        expect(result.confidence).toBeGreaterThan(0.3)
      }
    })

    it('should classify Proof focus correctly', () => {
      const descriptions = [
        'Trusted by 100K+ Buyers. 30-Day Money-Back Promise.',
        'Certified Quality. Verified by Customers.',
        'Official Product. Authentic Guarantee.'
      ]

      for (const desc of descriptions) {
        const result = classifyDescription(desc)
        expect(result.focus).toBe('Proof')
        expect(result.confidence).toBeGreaterThan(0.3)
      }
    })

    it('should detect CTA presence', () => {
      const result = classifyDescription('Award-Winning Tech. Shop Now')
      expect(result.hasCTA).toBe(true)
      expect(result.ctaWords.length).toBeGreaterThan(0)
    })

    it('should handle descriptions without clear focus', () => {
      const result = classifyDescription('xyz abc def')
      expect(result).toHaveProperty('focus')
      expect(result).toHaveProperty('confidence')
    })
  })

  describe('validateFocusCoverage', () => {
    it('should validate complete focus coverage', () => {
      const report = validateFocusCoverage(mockDescriptions.complete)
      expect(report.isSatisfied).toBe(true)
      expect(report.missing.length).toBe(0)
      expect(report.ctaMissing.length).toBe(0)
    })

    it('should detect missing focus types', () => {
      const report = validateFocusCoverage(mockDescriptions.incomplete)
      expect(report.isSatisfied).toBe(false)
      expect(report.missing.length).toBeGreaterThan(0)
    })

    it('should detect missing CTA', () => {
      const report = validateFocusCoverage(mockDescriptions.noCTA)
      expect(report.ctaMissing.length).toBeGreaterThan(0)
      expect(report.isSatisfied).toBe(false)
    })

    it('should count focus types correctly', () => {
      const report = validateFocusCoverage(mockDescriptions.complete)
      expect(report.coverage.Value).toBeGreaterThanOrEqual(1)
      expect(report.coverage.Action).toBeGreaterThanOrEqual(1)
      expect(report.coverage.Feature).toBeGreaterThanOrEqual(1)
      expect(report.coverage.Proof).toBeGreaterThanOrEqual(1)
    })

    it('should validate CTA presence for each description', () => {
      const report = validateFocusCoverage(mockDescriptions.complete)
      expect(Object.keys(report.ctaValidation).length).toBe(mockDescriptions.complete.length)
    })

    it('should generate recommendations', () => {
      const report = validateFocusCoverage(mockDescriptions.incomplete)
      expect(report.recommendations.length).toBeGreaterThan(0)
    })

    it('should include classification details', () => {
      const report = validateFocusCoverage(mockDescriptions.complete)
      expect(report.details.length).toBe(mockDescriptions.complete.length)
      expect(report.details[0]).toHaveProperty('description')
      expect(report.details[0]).toHaveProperty('focus')
      expect(report.details[0]).toHaveProperty('hasCTA')
    })

    it('should handle empty descriptions array', () => {
      const report = validateFocusCoverage([])
      expect(report.isSatisfied).toBe(false)
      expect(report.coverage.Value).toBe(0)
    })

    it('should handle single description', () => {
      const report = validateFocusCoverage(['Award-Winning Tech. Shop Now'])
      expect(report.details.length).toBe(1)
    })
  })

  describe('suggestDescriptionsForMissingFocus', () => {
    it('should suggest Value focus descriptions', () => {
      const suggestions = suggestDescriptionsForMissingFocus(['Value'], 'Eufy', [], { rating: 4.8, reviewCount: 50000 })
      expect(suggestions.Value.length).toBeGreaterThan(0)
      expect(suggestions.Value[0]).toMatch(/rated|stars|customers|reviews/i)
    })

    it('should suggest Action focus descriptions', () => {
      const suggestions = suggestDescriptionsForMissingFocus(['Action'], 'Eufy')
      expect(suggestions.Action.length).toBeGreaterThan(0)
      expect(suggestions.Action[0]).toMatch(/shop|buy|order|delivery/i)
    })

    it('should suggest Feature focus descriptions', () => {
      const suggestions = suggestDescriptionsForMissingFocus(['Feature'], 'Eufy', ['4K', 'Battery'])
      expect(suggestions.Feature.length).toBeGreaterThan(0)
    })

    it('should suggest Proof focus descriptions', () => {
      const suggestions = suggestDescriptionsForMissingFocus(['Proof'], 'Eufy')
      expect(suggestions.Proof.length).toBeGreaterThan(0)
      expect(suggestions.Proof[0]).toMatch(/trusted|guarantee|promise|money-back/i)
    })

    it('should suggest multiple missing focus types', () => {
      const suggestions = suggestDescriptionsForMissingFocus(['Value', 'Action', 'Feature'], 'Eufy')
      expect(suggestions.Value.length).toBeGreaterThan(0)
      expect(suggestions.Action.length).toBeGreaterThan(0)
      expect(suggestions.Feature.length).toBeGreaterThan(0)
    })

    it('should include social proof when provided', () => {
      const suggestions = suggestDescriptionsForMissingFocus(['Value'], 'Eufy', [], { rating: 4.9, reviewCount: 100000 })
      expect(suggestions.Value[0]).toContain('4.9')
      expect(suggestions.Value[0]).toContain('100000')
    })

    it('should handle empty missing focus types', () => {
      const suggestions = suggestDescriptionsForMissingFocus([], 'Eufy')
      expect(Object.values(suggestions).every(arr => arr.length === 0)).toBe(true)
    })
  })

  describe('generateFocusCoverageSummary', () => {
    it('should generate summary for satisfied coverage', () => {
      const report = validateFocusCoverage(mockDescriptions.complete)
      const summary = generateFocusCoverageSummary(report)
      expect(summary).toContain('SATISFIED')
      expect(summary).toContain('✅')
    })

    it('should generate summary for unsatisfied coverage', () => {
      const report = validateFocusCoverage(mockDescriptions.incomplete)
      const summary = generateFocusCoverageSummary(report)
      expect(summary).toContain('NOT SATISFIED')
      expect(summary).toContain('❌')
    })

    it('should include focus coverage details', () => {
      const report = validateFocusCoverage(mockDescriptions.complete)
      const summary = generateFocusCoverageSummary(report)
      expect(summary).toContain('Value')
      expect(summary).toContain('Action')
      expect(summary).toContain('Feature')
      expect(summary).toContain('Proof')
    })

    it('should include CTA validation details', () => {
      const report = validateFocusCoverage(mockDescriptions.complete)
      const summary = generateFocusCoverageSummary(report)
      expect(summary).toContain('CTA Validation')
    })

    it('should include recommendations', () => {
      const report = validateFocusCoverage(mockDescriptions.incomplete)
      const summary = generateFocusCoverageSummary(report)
      if (report.recommendations.length > 0) {
        expect(summary).toContain('Recommendations')
      }
    })
  })

  describe('Edge cases', () => {
    it('should handle very long descriptions', () => {
      const longDesc = 'A'.repeat(200)
      const result = classifyDescription(longDesc)
      expect(result).toHaveProperty('focus')
      expect(result).toHaveProperty('confidence')
    })

    it('should handle special characters', () => {
      const desc = 'Award-Winning™ Tech. Rated 4.8★ by 50K+ customers. Shop Now!'
      const result = classifyDescription(desc)
      expect(result).toHaveProperty('focus')
    })

    it('should handle mixed case', () => {
      const descriptions = [
        'AWARD-WINNING TECH. SHOP NOW',
        'award-winning tech. shop now',
        'Award-Winning Tech. Shop Now'
      ]

      for (const desc of descriptions) {
        const result = classifyDescription(desc)
        expect(result).toHaveProperty('focus')
      }
    })

    it('should handle descriptions with numbers', () => {
      const desc = 'Rated 4.8 stars by 50K+ customers. Save 30% today. Shop Now'
      const result = classifyDescription(desc)
      expect(result.focus).toBeDefined()
    })

    it('should handle descriptions with URLs', () => {
      const desc = 'Visit https://example.com for more info. Shop Now'
      const result = classifyDescription(desc)
      expect(result).toHaveProperty('focus')
    })
  })

  describe('Performance', () => {
    it('should classify description quickly', () => {
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        classifyDescription('Award-Winning Tech. Shop Now')
      }
      const duration = performance.now() - start
      expect(duration).toBeLessThan(100)
    })

    it('should validate focus coverage quickly', () => {
      const start = performance.now()
      validateFocusCoverage(mockDescriptions.complete)
      const duration = performance.now() - start
      expect(duration).toBeLessThan(50)
    })

    it('should detect CTA quickly', () => {
      const start = performance.now()
      for (let i = 0; i < 10000; i++) {
        hasCTA('Shop Now')
      }
      const duration = performance.now() - start
      expect(duration).toBeLessThan(100)
    })
  })
})
