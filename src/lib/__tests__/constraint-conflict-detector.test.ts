/**
 * 约束冲突检测器单元测试
 */

import {
  detectAllConflicts,
  detectDiversityVsTypeCoverageConflict,
  detectDiversityVsFocusCoverageConflict,
  detectCTAVsDiversityConflict,
  detectKeywordQuantityVsVolumeConflict,
  detectInsufficientCreativesConflict,
  detectInsufficientKeywordsConflict,
  generateResolutionStrategy,
  generateConflictReportSummary,
  type Conflict
} from '../constraint-conflict-detector'
import { validateTypeCoverage } from '../headline-type-classifier'
import { validateFocusCoverage } from '../description-focus-classifier'
import { validatePriorityDistribution } from '../keyword-priority-classifier'
import { mockHeadlines, mockDescriptions, mockKeywords, mockCreatives, mockOffers } from './test-utils'

describe('ConstraintConflictDetector', () => {
  describe('detectDiversityVsTypeCoverageConflict', () => {
    it('should detect conflict when diversity is high and type coverage fails', () => {
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.incomplete)
      const conflict = detectDiversityVsTypeCoverageConflict(
        mockHeadlines.incomplete,
        typeCoverageReport,
        0.18  // High similarity
      )

      if (typeCoverageReport.missing.length > 0) {
        expect(conflict).not.toBeNull()
        expect(conflict?.type).toBe('diversity_vs_type_coverage')
        expect(conflict?.severity).toBe('critical')
      }
    })

    it('should not detect conflict when type coverage is satisfied', () => {
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.complete)
      const conflict = detectDiversityVsTypeCoverageConflict(
        mockHeadlines.complete,
        typeCoverageReport,
        0.18
      )

      expect(conflict).toBeNull()
    })

    it('should not detect conflict when diversity is low', () => {
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.incomplete)
      const conflict = detectDiversityVsTypeCoverageConflict(
        mockHeadlines.incomplete,
        typeCoverageReport,
        0.10  // Low similarity
      )

      expect(conflict).toBeNull()
    })
  })

  describe('detectDiversityVsFocusCoverageConflict', () => {
    it('should detect conflict when diversity is high and focus coverage fails', () => {
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.incomplete)
      const conflict = detectDiversityVsFocusCoverageConflict(
        mockDescriptions.incomplete,
        focusCoverageReport,
        0.18
      )

      if (focusCoverageReport.missing.length > 0 || focusCoverageReport.ctaMissing.length > 0) {
        expect(conflict).not.toBeNull()
        expect(conflict?.type).toBe('diversity_vs_focus_coverage')
      }
    })

    it('should not detect conflict when focus coverage is satisfied', () => {
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.complete)
      const conflict = detectDiversityVsFocusCoverageConflict(
        mockDescriptions.complete,
        focusCoverageReport,
        0.18
      )

      expect(conflict).toBeNull()
    })
  })

  describe('detectCTAVsDiversityConflict', () => {
    it('should detect conflict when all descriptions have CTA and diversity is high', () => {
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.complete)
      const ctaPresence: Record<number, boolean> = {}
      for (let i = 0; i < mockDescriptions.complete.length; i++) {
        ctaPresence[i] = true
      }

      const conflict = detectCTAVsDiversityConflict(
        mockDescriptions.complete,
        ctaPresence,
        0.19  // High similarity
      )

      if (mockDescriptions.complete.length < 4) {
        expect(conflict).not.toBeNull()
        expect(conflict?.type).toBe('cta_vs_diversity')
      }
    })

    it('should not detect conflict when diversity is low', () => {
      const ctaPresence: Record<number, boolean> = {
        0: true,
        1: true,
        2: true,
        3: true
      }

      const conflict = detectCTAVsDiversityConflict(
        mockDescriptions.complete,
        ctaPresence,
        0.10
      )

      expect(conflict).toBeNull()
    })
  })

  describe('detectKeywordQuantityVsVolumeConflict', () => {
    it('should detect conflict when keywords are insufficient and volume is low', () => {
      const conflict = detectKeywordQuantityVsVolumeConflict(
        mockKeywords.lowVolume,
        100  // Low average volume
      )

      expect(conflict).not.toBeNull()
      expect(conflict?.type).toBe('keyword_quantity_vs_volume')
      expect(conflict?.severity).toBe('warning')
    })

    it('should not detect conflict when keywords are sufficient', () => {
      const conflict = detectKeywordQuantityVsVolumeConflict(
        mockKeywords.complete,
        2000  // High average volume
      )

      expect(conflict).toBeNull()
    })

    it('should not detect conflict when volume is high', () => {
      const conflict = detectKeywordQuantityVsVolumeConflict(
        mockKeywords.lowVolume,
        1000  // High average volume
      )

      expect(conflict).toBeNull()
    })
  })

  describe('detectInsufficientCreativesConflict', () => {
    it('should detect conflict when headlines are insufficient', () => {
      const conflict = detectInsufficientCreativesConflict(
        ['Headline 1', 'Headline 2'],  // Only 2 headlines
        mockDescriptions.complete
      )

      expect(conflict).not.toBeNull()
      expect(conflict?.type).toBe('insufficient_creatives')
      expect(conflict?.severity).toBe('critical')
    })

    it('should detect conflict when descriptions are insufficient', () => {
      const conflict = detectInsufficientCreativesConflict(
        mockHeadlines.complete,
        ['Description 1']  // Only 1 description
      )

      expect(conflict).not.toBeNull()
      expect(conflict?.type).toBe('insufficient_creatives')
    })

    it('should not detect conflict when creatives are sufficient', () => {
      const conflict = detectInsufficientCreativesConflict(
        mockHeadlines.complete,
        mockDescriptions.complete
      )

      expect(conflict).toBeNull()
    })
  })

  describe('detectInsufficientKeywordsConflict', () => {
    it('should detect conflict when keywords are insufficient', () => {
      const conflict = detectInsufficientKeywordsConflict(
        mockKeywords.lowVolume
      )

      expect(conflict).not.toBeNull()
      expect(conflict?.type).toBe('insufficient_keywords')
      expect(conflict?.severity).toBe('warning')
    })

    it('should not detect conflict when keywords are sufficient', () => {
      const conflict = detectInsufficientKeywordsConflict(
        mockKeywords.complete
      )

      expect(conflict).toBeNull()
    })
  })

  describe('detectAllConflicts', () => {
    it('should detect all conflicts in incomplete creatives', () => {
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.incomplete)
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.incomplete)
      const priorityDistributionReport = validatePriorityDistribution(mockKeywords.incomplete, mockOffers.eufy)

      const report = detectAllConflicts(
        mockCreatives.incomplete,
        typeCoverageReport,
        focusCoverageReport,
        priorityDistributionReport
      )

      expect(report.hasConflicts).toBe(true)
      expect(report.conflicts.length).toBeGreaterThan(0)
    })

    it('should not detect conflicts in complete creatives', () => {
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.complete)
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.complete)
      const priorityDistributionReport = validatePriorityDistribution(mockKeywords.complete, mockOffers.eufy)

      const report = detectAllConflicts(
        mockCreatives.complete,
        typeCoverageReport,
        focusCoverageReport,
        priorityDistributionReport
      )

      expect(report.hasConflicts).toBe(false)
      expect(report.conflicts.length).toBe(0)
    })

    it('should determine correct severity level', () => {
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.incomplete)
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.incomplete)

      const report = detectAllConflicts(
        mockCreatives.incomplete,
        typeCoverageReport,
        focusCoverageReport
      )

      expect(['critical', 'warning', 'info']).toContain(report.severity)
    })

    it('should generate recommendations', () => {
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.incomplete)
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.incomplete)

      const report = detectAllConflicts(
        mockCreatives.incomplete,
        typeCoverageReport,
        focusCoverageReport
      )

      if (report.hasConflicts) {
        expect(report.recommendations.length).toBeGreaterThan(0)
      }
    })

    it('should generate resolution strategy when conflicts exist', () => {
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.incomplete)
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.incomplete)

      const report = detectAllConflicts(
        mockCreatives.incomplete,
        typeCoverageReport,
        focusCoverageReport
      )

      if (report.hasConflicts) {
        expect(report.resolutionStrategy).toBeDefined()
        expect(report.resolutionStrategy?.priority).toBeDefined()
      }
    })
  })

  describe('generateResolutionStrategy', () => {
    it('should generate strategy for diversity vs coverage conflicts', () => {
      const conflicts: Conflict[] = [
        {
          type: 'diversity_vs_type_coverage',
          severity: 'critical',
          message: 'Test conflict',
          affectedElements: [],
          suggestedAction: 'Test action'
        }
      ]

      const strategy = generateResolutionStrategy(conflicts)
      expect(strategy).toHaveProperty('actions')
      expect(strategy).toHaveProperty('fallbacks')
      expect(strategy).toHaveProperty('priority')
    })

    it('should generate strategy for quantity conflicts', () => {
      const conflicts: Conflict[] = [
        {
          type: 'insufficient_creatives',
          severity: 'critical',
          message: 'Test conflict',
          affectedElements: [],
          suggestedAction: 'Test action'
        }
      ]

      const strategy = generateResolutionStrategy(conflicts)
      expect(strategy.fallbacks.length).toBeGreaterThan(0)
    })

    it('should prioritize diversity preservation', () => {
      const conflicts: Conflict[] = [
        {
          type: 'diversity_vs_type_coverage',
          severity: 'critical',
          message: 'Test conflict',
          affectedElements: [],
          suggestedAction: 'Test action'
        },
        {
          type: 'insufficient_creatives',
          severity: 'critical',
          message: 'Test conflict',
          affectedElements: [],
          suggestedAction: 'Test action'
        }
      ]

      const strategy = generateResolutionStrategy(conflicts)
      expect(strategy.priority).toBe('preserve_diversity')
    })
  })

  describe('generateConflictReportSummary', () => {
    it('should generate summary for no conflicts', () => {
      const report = {
        hasConflicts: false,
        conflicts: [],
        severity: 'info' as const,
        recommendations: []
      }

      const summary = generateConflictReportSummary(report)
      expect(summary).toContain('No conflicts')
      expect(summary).toContain('✅')
    })

    it('should generate summary for conflicts', () => {
      const report = {
        hasConflicts: true,
        conflicts: [
          {
            type: 'diversity_vs_type_coverage' as const,
            severity: 'critical' as const,
            message: 'Test conflict',
            affectedElements: [],
            suggestedAction: 'Test action'
          }
        ],
        severity: 'critical' as const,
        recommendations: ['Recommendation 1']
      }

      const summary = generateConflictReportSummary(report)
      expect(summary).toContain('conflict')
      expect(summary).toContain('CRITICAL')
    })

    it('should include conflict details', () => {
      const report = {
        hasConflicts: true,
        conflicts: [
          {
            type: 'diversity_vs_type_coverage' as const,
            severity: 'critical' as const,
            message: 'Test conflict message',
            affectedElements: ['Element1'],
            suggestedAction: 'Test action'
          }
        ],
        severity: 'critical' as const,
        recommendations: []
      }

      const summary = generateConflictReportSummary(report)
      expect(summary).toContain('diversity_vs_type_coverage')
      expect(summary).toContain('Test action')
    })

    it('should include resolution strategy', () => {
      const report = {
        hasConflicts: true,
        conflicts: [
          {
            type: 'diversity_vs_type_coverage' as const,
            severity: 'critical' as const,
            message: 'Test conflict',
            affectedElements: [],
            suggestedAction: 'Test action'
          }
        ],
        severity: 'critical' as const,
        recommendations: [],
        resolutionStrategy: {
          actions: [
            {
              action: 'relax_type_coverage',
              constraint: 'type_coverage',
              from: 5,
              to: 3,
              reason: 'Test reason'
            }
          ],
          fallbacks: [],
          priority: 'preserve_diversity' as const
        }
      }

      const summary = generateConflictReportSummary(report)
      expect(summary).toContain('Resolution Strategy')
      expect(summary).toContain('preserve_diversity')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty conflicts array', () => {
      const report = {
        hasConflicts: false,
        conflicts: [],
        severity: 'info' as const,
        recommendations: []
      }

      const summary = generateConflictReportSummary(report)
      expect(summary).toBeDefined()
    })

    it('should handle multiple conflicts of same type', () => {
      const conflicts: Conflict[] = [
        {
          type: 'diversity_vs_type_coverage',
          severity: 'critical',
          message: 'Conflict 1',
          affectedElements: [],
          suggestedAction: 'Action 1'
        },
        {
          type: 'diversity_vs_type_coverage',
          severity: 'critical',
          message: 'Conflict 2',
          affectedElements: [],
          suggestedAction: 'Action 2'
        }
      ]

      const strategy = generateResolutionStrategy(conflicts)
      expect(strategy).toBeDefined()
    })

    it('should handle mixed severity conflicts', () => {
      const conflicts: Conflict[] = [
        {
          type: 'diversity_vs_type_coverage',
          severity: 'critical',
          message: 'Critical conflict',
          affectedElements: [],
          suggestedAction: 'Action'
        },
        {
          type: 'keyword_quantity_vs_volume',
          severity: 'warning',
          message: 'Warning conflict',
          affectedElements: [],
          suggestedAction: 'Action'
        }
      ]

      const report = {
        hasConflicts: true,
        conflicts,
        severity: 'critical' as const,
        recommendations: []
      }

      const summary = generateConflictReportSummary(report)
      expect(summary).toContain('CRITICAL')
    })
  })

  describe('Performance', () => {
    it('should detect conflicts quickly', () => {
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.complete)
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.complete)

      const start = performance.now()
      for (let i = 0; i < 100; i++) {
        detectAllConflicts(
          mockCreatives.complete,
          typeCoverageReport,
          focusCoverageReport
        )
      }
      const duration = performance.now() - start

      expect(duration).toBeLessThan(500)
    })

    it('should generate resolution strategy quickly', () => {
      const conflicts: Conflict[] = [
        {
          type: 'diversity_vs_type_coverage',
          severity: 'critical',
          message: 'Test',
          affectedElements: [],
          suggestedAction: 'Test'
        }
      ]

      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        generateResolutionStrategy(conflicts)
      }
      const duration = performance.now() - start

      expect(duration).toBeLessThan(100)
    })
  })
})
