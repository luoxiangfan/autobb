/**
 * 质量指标计算器单元测试
 */

import {
  hasKeyword,
  hasNumber,
  hasUrgency,
  getHeadlineLengthCategory,
  calculateKeywordDensity,
  calculateNumberDensity,
  calculateUrgencyDensity,
  calculateLengthDistribution,
  calculateOverallQualityScore,
  generateQualityRecommendations,
  calculateQualityMetrics,
  generateQualityReport,
  generateQualityReportSummary,
  meetsMinimumQualityStandard
} from '../quality-metrics-calculator'
import { mockHeadlines } from './test-utils'

describe('QualityMetricsCalculator', () => {
  describe('hasKeyword', () => {
    it('should detect keyword in headline', () => {
      expect(hasKeyword('robot vacuum cleaner', ['robot', 'vacuum'])).toBe(true)
      expect(hasKeyword('smart home cleaning', ['smart', 'home'])).toBe(true)
    })

    it('should not detect missing keyword', () => {
      expect(hasKeyword('robot vacuum', ['xyz', 'abc'])).toBe(false)
    })

    it('should be case insensitive', () => {
      expect(hasKeyword('ROBOT VACUUM', ['robot'])).toBe(true)
      expect(hasKeyword('Robot Vacuum', ['ROBOT'])).toBe(true)
    })

    it('should handle empty keywords array', () => {
      expect(hasKeyword('robot vacuum', [])).toBe(false)
    })
  })

  describe('hasNumber', () => {
    it('should detect numbers in headline', () => {
      expect(hasNumber('4K Resolution')).toBe(true)
      expect(hasNumber('Save 30% Today')).toBe(true)
      expect(hasNumber('5 Star Rating')).toBe(true)
    })

    it('should not detect missing numbers', () => {
      expect(hasNumber('Robot Vacuum')).toBe(false)
      expect(hasNumber('Smart Cleaning')).toBe(false)
    })

    it('should detect various number formats', () => {
      expect(hasNumber('4K')).toBe(true)
      expect(hasNumber('30%')).toBe(true)
      expect(hasNumber('2024')).toBe(true)
      expect(hasNumber('3.5')).toBe(true)
    })
  })

  describe('hasUrgency', () => {
    it('should detect urgency words', () => {
      expect(hasUrgency('Limited Time Offer')).toBe(true)
      expect(hasUrgency('Only 5 Left')).toBe(true)
      expect(hasUrgency('Ends Tomorrow')).toBe(true)
      expect(hasUrgency('Hurry Now')).toBe(true)
    })

    it('should not detect missing urgency', () => {
      expect(hasUrgency('Robot Vacuum')).toBe(false)
      expect(hasUrgency('Smart Cleaning')).toBe(false)
    })

    it('should be case insensitive', () => {
      expect(hasUrgency('LIMITED TIME')).toBe(true)
      expect(hasUrgency('limited time')).toBe(true)
    })
  })

  describe('getHeadlineLengthCategory', () => {
    it('should categorize short headlines', () => {
      expect(getHeadlineLengthCategory('Shop Now')).toBe('short')
      expect(getHeadlineLengthCategory('A'.repeat(20))).toBe('short')
    })

    it('should categorize medium headlines', () => {
      expect(getHeadlineLengthCategory('A'.repeat(21))).toBe('medium')
      expect(getHeadlineLengthCategory('A'.repeat(25))).toBe('medium')
    })

    it('should categorize long headlines', () => {
      expect(getHeadlineLengthCategory('A'.repeat(26))).toBe('long')
      expect(getHeadlineLengthCategory('A'.repeat(30))).toBe('long')
    })
  })

  describe('calculateKeywordDensity', () => {
    it('should calculate keyword density correctly', () => {
      const headlines = [
        'robot vacuum',
        'smart robot',
        'vacuum cleaner',
        'other product'
      ]
      const keywords = ['robot', 'vacuum']
      const density = calculateKeywordDensity(headlines, keywords)
      expect(density).toBe(0.75) // 3 out of 4
    })

    it('should return 0 for empty headlines', () => {
      const density = calculateKeywordDensity([], ['robot'])
      expect(density).toBe(0)
    })

    it('should return 0 when no keywords match', () => {
      const headlines = ['product a', 'product b']
      const keywords = ['xyz', 'abc']
      const density = calculateKeywordDensity(headlines, keywords)
      expect(density).toBe(0)
    })

    it('should return 1 when all headlines have keywords', () => {
      const headlines = ['robot vacuum', 'robot cleaner', 'vacuum robot']
      const keywords = ['robot', 'vacuum']
      const density = calculateKeywordDensity(headlines, keywords)
      expect(density).toBe(1)
    })
  })

  describe('calculateNumberDensity', () => {
    it('should calculate number density correctly', () => {
      const headlines = [
        '4K Resolution',
        'Save 30%',
        'Robot Vacuum',
        '5 Star Rating'
      ]
      const density = calculateNumberDensity(headlines)
      expect(density).toBe(0.75) // 3 out of 4
    })

    it('should return 0 for empty headlines', () => {
      const density = calculateNumberDensity([])
      expect(density).toBe(0)
    })

    it('should return 0 when no numbers present', () => {
      const headlines = ['Robot', 'Vacuum', 'Cleaner']
      const density = calculateNumberDensity(headlines)
      expect(density).toBe(0)
    })

    it('should return 1 when all headlines have numbers', () => {
      const headlines = ['4K', '30%', '5 Star', '2024']
      const density = calculateNumberDensity(headlines)
      expect(density).toBe(1)
    })
  })

  describe('calculateUrgencyDensity', () => {
    it('should calculate urgency density correctly', () => {
      const headlines = [
        'Limited Time',
        'Only 5 Left',
        'Robot Vacuum',
        'Ends Tomorrow'
      ]
      const density = calculateUrgencyDensity(headlines)
      expect(density).toBe(0.75) // 3 out of 4
    })

    it('should return 0 for empty headlines', () => {
      const density = calculateUrgencyDensity([])
      expect(density).toBe(0)
    })

    it('should return 0 when no urgency present', () => {
      const headlines = ['Robot', 'Vacuum', 'Cleaner']
      const density = calculateUrgencyDensity(headlines)
      expect(density).toBe(0)
    })

    it('should return 1 when all headlines have urgency', () => {
      const headlines = ['Limited', 'Only', 'Ends', 'Hurry']
      const density = calculateUrgencyDensity(headlines)
      expect(density).toBe(1)
    })
  })

  describe('calculateLengthDistribution', () => {
    it('should calculate length distribution correctly', () => {
      const headlines = [
        'A'.repeat(15), // short
        'A'.repeat(15), // short
        'A'.repeat(15), // short
        'A'.repeat(15), // short
        'A'.repeat(15), // short
        'A'.repeat(22), // medium
        'A'.repeat(22), // medium
        'A'.repeat(22), // medium
        'A'.repeat(22), // medium
        'A'.repeat(22), // medium
        'A'.repeat(28), // long
        'A'.repeat(28), // long
        'A'.repeat(28), // long
        'A'.repeat(28), // long
        'A'.repeat(28)  // long
      ]
      const distribution = calculateLengthDistribution(headlines)
      expect(distribution.short).toBe(5)
      expect(distribution.medium).toBe(5)
      expect(distribution.long).toBe(5)
      expect(distribution.isSatisfied).toBe(true)
    })

    it('should detect unsatisfied distribution', () => {
      const headlines = Array(15).fill('A'.repeat(15)) // All short
      const distribution = calculateLengthDistribution(headlines)
      expect(distribution.isSatisfied).toBe(false)
    })

    it('should allow ±1 deviation', () => {
      const headlines = [
        ...Array(6).fill('A'.repeat(15)), // 6 short (±1 from 5)
        ...Array(5).fill('A'.repeat(22)), // 5 medium
        ...Array(4).fill('A'.repeat(28))  // 4 long (±1 from 5)
      ]
      const distribution = calculateLengthDistribution(headlines)
      expect(distribution.isSatisfied).toBe(true)
    })
  })

  describe('calculateOverallQualityScore', () => {
    it('should calculate score for high quality metrics', () => {
      const metrics = {
        keywordDensity: 0.6,
        numberDensity: 0.4,
        urgencyDensity: 0.25,
        lengthDistribution: {
          short: 5,
          medium: 5,
          long: 5,
          isSatisfied: true
        }
      }
      const score = calculateOverallQualityScore(metrics)
      expect(score).toBeGreaterThan(70)
    })

    it('should calculate score for low quality metrics', () => {
      const metrics = {
        keywordDensity: 0.2,
        numberDensity: 0.1,
        urgencyDensity: 0.05,
        lengthDistribution: {
          short: 2,
          medium: 2,
          long: 2,
          isSatisfied: false
        }
      }
      const score = calculateOverallQualityScore(metrics)
      expect(score).toBeLessThan(50)
    })

    it('should return score between 0 and 100', () => {
      const metrics = {
        keywordDensity: 0.5,
        numberDensity: 0.3,
        urgencyDensity: 0.2,
        lengthDistribution: {
          short: 5,
          medium: 5,
          long: 5,
          isSatisfied: true
        }
      }
      const score = calculateOverallQualityScore(metrics)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    })
  })

  describe('generateQualityRecommendations', () => {
    it('should recommend adding keywords', () => {
      const metrics = {
        keywordDensity: 0.3,
        numberDensity: 0.5,
        urgencyDensity: 0.3,
        lengthDistribution: { short: 5, medium: 5, long: 5, isSatisfied: true },
        overallScore: 60,
        recommendations: []
      }
      const recommendations = generateQualityRecommendations(metrics)
      expect(recommendations.some(r => r.includes('keyword'))).toBe(true)
    })

    it('should recommend adding numbers', () => {
      const metrics = {
        keywordDensity: 0.6,
        numberDensity: 0.1,
        urgencyDensity: 0.3,
        lengthDistribution: { short: 5, medium: 5, long: 5, isSatisfied: true },
        overallScore: 60,
        recommendations: []
      }
      const recommendations = generateQualityRecommendations(metrics)
      expect(recommendations.some(r => r.includes('number'))).toBe(true)
    })

    it('should recommend adding urgency', () => {
      const metrics = {
        keywordDensity: 0.6,
        numberDensity: 0.4,
        urgencyDensity: 0.05,
        lengthDistribution: { short: 5, medium: 5, long: 5, isSatisfied: true },
        overallScore: 60,
        recommendations: []
      }
      const recommendations = generateQualityRecommendations(metrics)
      expect(recommendations.some(r => r.includes('urgency'))).toBe(true)
    })

    it('should recommend fixing length distribution', () => {
      const metrics = {
        keywordDensity: 0.6,
        numberDensity: 0.4,
        urgencyDensity: 0.3,
        lengthDistribution: { short: 2, medium: 2, long: 2, isSatisfied: false },
        overallScore: 60,
        recommendations: []
      }
      const recommendations = generateQualityRecommendations(metrics)
      expect(recommendations.some(r => r.includes('short') || r.includes('medium') || r.includes('long'))).toBe(true)
    })
  })

  describe('calculateQualityMetrics', () => {
    it('should calculate all metrics', () => {
      const headlines = mockHeadlines.complete
      const keywords = ['robot', 'vacuum', 'smart']
      const metrics = calculateQualityMetrics(headlines, keywords)

      expect(metrics).toHaveProperty('keywordDensity')
      expect(metrics).toHaveProperty('numberDensity')
      expect(metrics).toHaveProperty('urgencyDensity')
      expect(metrics).toHaveProperty('lengthDistribution')
      expect(metrics).toHaveProperty('overallScore')
      expect(metrics).toHaveProperty('recommendations')
    })

    it('should include recommendations', () => {
      const headlines = mockHeadlines.short
      const keywords = ['robot']
      const metrics = calculateQualityMetrics(headlines, keywords)

      expect(Array.isArray(metrics.recommendations)).toBe(true)
    })
  })

  describe('generateQualityReport', () => {
    it('should generate complete report', () => {
      const headlines = mockHeadlines.complete
      const keywords = ['robot', 'vacuum']
      const report = generateQualityReport(headlines, keywords)

      expect(report).toHaveProperty('headlines')
      expect(report).toHaveProperty('keywords')
      expect(report).toHaveProperty('metrics')
      expect(report).toHaveProperty('isHighQuality')
      expect(report).toHaveProperty('details')
    })

    it('should identify high quality creatives', () => {
      const headlines = mockHeadlines.complete
      const keywords = ['robot', 'vacuum', 'smart', 'cleaning']
      const report = generateQualityReport(headlines, keywords)

      expect(report.isHighQuality).toBe(report.metrics.overallScore >= 70)
    })

    it('should include detailed breakdown', () => {
      const headlines = mockHeadlines.complete
      const keywords = ['robot']
      const report = generateQualityReport(headlines, keywords)

      expect(report.details).toHaveProperty('headlinesWithKeywords')
      expect(report.details).toHaveProperty('headlinesWithNumbers')
      expect(report.details).toHaveProperty('headlinesWithUrgency')
      expect(report.details).toHaveProperty('headlinesByLength')
    })
  })

  describe('generateQualityReportSummary', () => {
    it('should generate summary', () => {
      const headlines = mockHeadlines.complete
      const keywords = ['robot']
      const report = generateQualityReport(headlines, keywords)
      const summary = generateQualityReportSummary(report)

      expect(summary).toBeDefined()
      expect(summary.length).toBeGreaterThan(0)
    })

    it('should include score', () => {
      const headlines = mockHeadlines.complete
      const keywords = ['robot']
      const report = generateQualityReport(headlines, keywords)
      const summary = generateQualityReportSummary(report)

      expect(summary).toContain('Overall Score')
      expect(summary).toContain(report.metrics.overallScore.toString())
    })

    it('should include metrics details', () => {
      const headlines = mockHeadlines.complete
      const keywords = ['robot']
      const report = generateQualityReport(headlines, keywords)
      const summary = generateQualityReportSummary(report)

      expect(summary).toContain('Keyword Density')
      expect(summary).toContain('Number Density')
      expect(summary).toContain('Urgency Density')
      expect(summary).toContain('Length Distribution')
    })
  })

  describe('meetsMinimumQualityStandard', () => {
    it('should pass for high quality report', () => {
      const headlines = mockHeadlines.complete
      const keywords = ['robot', 'vacuum', 'smart']
      const report = generateQualityReport(headlines, keywords)

      const meets = meetsMinimumQualityStandard(report)
      expect(typeof meets).toBe('boolean')
    })

    it('should check keyword density', () => {
      const headlines = Array(15).fill('Product')
      const keywords = ['xyz']
      const report = generateQualityReport(headlines, keywords)

      const meets = meetsMinimumQualityStandard(report)
      expect(meets).toBe(false)
    })

    it('should check overall score', () => {
      const headlines = mockHeadlines.complete
      const keywords = ['robot']
      const report = generateQualityReport(headlines, keywords)

      const meets = meetsMinimumQualityStandard(report)
      expect(meets).toBe(report.metrics.overallScore >= 50)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty headlines array', () => {
      const metrics = calculateQualityMetrics([], ['robot'])
      expect(metrics.keywordDensity).toBe(0)
      expect(metrics.numberDensity).toBe(0)
      expect(metrics.urgencyDensity).toBe(0)
    })

    it('should handle empty keywords array', () => {
      const metrics = calculateQualityMetrics(mockHeadlines.complete, [])
      expect(metrics.keywordDensity).toBe(0)
    })

    it('should handle very long headlines', () => {
      const headlines = Array(15).fill('A'.repeat(100))
      const metrics = calculateQualityMetrics(headlines, ['A'])
      expect(metrics).toHaveProperty('overallScore')
    })

    it('should handle special characters', () => {
      const headlines = ['4K™ Resolution™', 'Save 30%™', 'Limited™ Time™']
      const metrics = calculateQualityMetrics(headlines, ['resolution'])
      expect(metrics).toHaveProperty('overallScore')
    })
  })

  describe('Performance', () => {
    it('should calculate metrics quickly', () => {
      const start = performance.now()
      for (let i = 0; i < 100; i++) {
        calculateQualityMetrics(mockHeadlines.complete, ['robot'])
      }
      const duration = performance.now() - start
      expect(duration).toBeLessThan(500)
    })

    it('should generate report quickly', () => {
      const start = performance.now()
      for (let i = 0; i < 100; i++) {
        generateQualityReport(mockHeadlines.complete, ['robot'])
      }
      const duration = performance.now() - start
      expect(duration).toBeLessThan(500)
    })
  })
})
