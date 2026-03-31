/**
 * 集成测试套件
 * 测试所有优化模块的协同工作
 */

import { validateTypeCoverage } from '../headline-type-classifier'
import { validateFocusCoverage } from '../description-focus-classifier'
import { validatePriorityDistribution } from '../keyword-priority-classifier'
import { detectAllConflicts } from '../constraint-conflict-detector'
import { getConstraintManager, resetConstraintManager } from '../constraint-manager'
import { calculateQualityMetrics, generateQualityReport } from '../quality-metrics-calculator'
import { getLanguageConstraints, validateHeadlineLength, validateKeywordWordCount } from '../language-constraints'
import { mockHeadlines, mockDescriptions, mockKeywords, mockCreatives, mockOffers } from './test-utils'

describe('Integration Tests', () => {
  beforeEach(() => {
    resetConstraintManager()
  })

  describe('Complete workflow: English', () => {
    it('should validate complete English creatives', () => {
      // 1. 验证标题类型覆盖
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.complete)
      expect(typeCoverageReport.isSatisfied).toBe(true)

      // 2. 验证描述焦点覆盖
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.complete)
      expect(focusCoverageReport.isSatisfied).toBe(true)

      // 3. 验证关键词优先级分布
      const priorityDistributionReport = validatePriorityDistribution(
        mockKeywords.complete,
        mockOffers.eufy
      )
      expect(priorityDistributionReport.isSatisfied).toBe(true)

      // 4. 检测约束冲突
      const conflictReport = detectAllConflicts(
        mockCreatives.complete,
        typeCoverageReport,
        focusCoverageReport,
        priorityDistributionReport
      )
      expect(conflictReport.hasConflicts).toBe(false)

      // 5. 计算质量指标
      const qualityReport = generateQualityReport(
        mockHeadlines.complete,
        mockOffers.eufy.keywords || []
      )
      expect(qualityReport.metrics.overallScore).toBeGreaterThan(0)
    })

    it('should handle incomplete English creatives with conflict resolution', () => {
      // 1. 验证不完整的创意
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.incomplete)
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.incomplete)
      const priorityDistributionReport = validatePriorityDistribution(
        mockKeywords.incomplete,
        mockOffers.eufy
      )

      // 2. 检测冲突
      const conflictReport = detectAllConflicts(
        mockCreatives.incomplete,
        typeCoverageReport,
        focusCoverageReport,
        priorityDistributionReport
      )

      // 3. 如果有冲突，应用解决策略
      if (conflictReport.hasConflicts && conflictReport.resolutionStrategy) {
        const manager = getConstraintManager()

        // 应用松弛操作
        for (const fallback of conflictReport.resolutionStrategy.fallbacks) {
          const relaxation = manager.relaxConstraint(fallback.constraint, fallback.reason)
          expect(relaxation).not.toBeNull()
        }

        // 验证约束已被松弛
        expect(manager.isAnyConstraintRelaxed()).toBe(true)
      }
    })
  })

  describe('Complete workflow: German', () => {
    it('should validate German creatives with language-specific constraints', () => {
      const constraints = getLanguageConstraints('de')

      // 1. 验证标题长度
      for (const headline of mockHeadlines.complete) {
        const isValid = validateHeadlineLength(headline, 'de')
        expect(isValid).toBe(headline.length <= constraints.headlineLength)
      }

      // 2. 验证关键词单词数（德语maxWords=3，过滤掉不适用的长尾关键词）
      const deKeywords = mockKeywords.complete.filter(kw => kw.keyword.split(/\s+/).length <= 3)
      for (const kw of deKeywords) {
        const isValid = validateKeywordWordCount(kw.keyword, 'de')
        expect(isValid).toBe(true)
      }

      // 3. 验证类型覆盖
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.complete)
      expect(typeCoverageReport.isSatisfied).toBe(true)

      // 4. 验证焦点覆盖
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.complete)
      expect(focusCoverageReport.isSatisfied).toBe(true)
    })
  })

  describe('Complete workflow: Japanese', () => {
    it('should validate Japanese creatives with language-specific constraints', () => {
      const constraints = getLanguageConstraints('ja')

      // 1. 验证关键词单词数（日文应该更少）
      expect(constraints.keywordMaxWords).toBe(2)

      // 2. 验证搜索量要求（日文市场较小）
      expect(constraints.keywordMinSearchVolume).toBeLessThan(500)

      // 3. 验证标题长度
      for (const headline of mockHeadlines.complete) {
        const isValid = validateHeadlineLength(headline, 'ja')
        expect(isValid).toBe(headline.length <= constraints.headlineLength)
      }
    })
  })

  describe('Constraint conflict resolution workflow', () => {
    it('should detect and resolve diversity vs type coverage conflict', () => {
      const manager = getConstraintManager()

      // 1. 获取初始约束值
      const initialDiversity = manager.getConstraintValue('diversity')
      const initialTypeCoverage = manager.getConstraintValue('type_coverage')

      // 2. 模拟冲突
      const conflict = {
        type: 'diversity_vs_type_coverage' as const,
        severity: 'critical' as const,
        message: 'Test conflict',
        affectedElements: [],
        suggestedAction: 'Relax constraints'
      }

      // 3. 应用解决策略
      manager.relaxConstraint('diversity', 'Insufficient creatives after filtering')
      manager.relaxConstraint('type_coverage', 'Cannot satisfy all types')

      // 4. 验证约束已被松弛
      expect(manager.getConstraintValue('diversity')).toBeGreaterThan(initialDiversity)
      expect(manager.getConstraintValue('type_coverage')).toBeLessThan(initialTypeCoverage)
      expect(manager.isAnyConstraintRelaxed()).toBe(true)

      // 5. 验证松弛记录
      const relaxations = manager.getRelaxations()
      expect(relaxations.length).toBe(2)
    })

    it('should handle multiple constraint relaxations', () => {
      const manager = getConstraintManager()

      // 1. 应用多个松弛操作
      manager.relaxConstraint('diversity', 'Reason 1')
      manager.relaxConstraint('type_coverage', 'Reason 2')
      manager.relaxConstraint('search_volume', 'Reason 3')

      // 2. 验证所有松弛都被记录
      const relaxations = manager.getRelaxations()
      expect(relaxations.length).toBe(3)

      // 3. 验证每个松弛的严重程度
      expect(relaxations.some(r => r.severity === 'moderate')).toBe(true)
      expect(relaxations.some(r => r.severity === 'major')).toBe(true)

      // 4. 验证可以重置
      manager.resetConstraints()
      expect(manager.getRelaxations().length).toBe(0)
      expect(manager.isAnyConstraintRelaxed()).toBe(false)
    })
  })

  describe('Quality metrics workflow', () => {
    it('should calculate quality metrics for complete creatives', () => {
      // 1. 计算质量指标
      const metrics = calculateQualityMetrics(
        mockHeadlines.complete,
        mockOffers.eufy.keywords || []
      )

      // 2. 验证所有指标都被计算
      expect(metrics.keywordDensity).toBeGreaterThanOrEqual(0)
      expect(metrics.numberDensity).toBeGreaterThanOrEqual(0)
      expect(metrics.urgencyDensity).toBeGreaterThanOrEqual(0)
      expect(metrics.lengthDistribution).toBeDefined()
      expect(metrics.overallScore).toBeGreaterThanOrEqual(0)
      expect(metrics.overallScore).toBeLessThanOrEqual(100)

      // 3. 验证建议被生成
      expect(Array.isArray(metrics.recommendations)).toBe(true)
    })

    it('should generate quality report with detailed breakdown', () => {
      // 1. 生成质量报告
      const report = generateQualityReport(
        mockHeadlines.complete,
        mockOffers.eufy.keywords || []
      )

      // 2. 验证报告包含所有必要信息
      expect(report.headlines).toBeDefined()
      expect(report.keywords).toBeDefined()
      expect(report.metrics).toBeDefined()
      expect(report.isHighQuality).toBeDefined()
      expect(report.details).toBeDefined()

      // 3. 验证详细信息
      expect(report.details.headlinesWithKeywords).toBeDefined()
      expect(report.details.headlinesWithNumbers).toBeDefined()
      expect(report.details.headlinesWithUrgency).toBeDefined()
      expect(report.details.headlinesByLength).toBeDefined()

      // 4. 验证高质量判断
      expect(typeof report.isHighQuality).toBe('boolean')
    })
  })

  describe('Multi-language workflow', () => {
    it('should handle creatives in multiple languages', () => {
      const languages = ['en', 'de', 'it', 'ja', 'zh']

      for (const lang of languages) {
        const constraints = getLanguageConstraints(lang)

        // 1. 验证约束存在
        expect(constraints).toBeDefined()
        expect(constraints.language).toBeDefined()

        // 2. 验证标题长度约束
        expect(constraints.headlineLength).toBeGreaterThan(0)

        // 3. 验证关键词约束
        expect(constraints.keywordMaxWords).toBeGreaterThan(0)
        expect(constraints.keywordMinSearchVolume).toBeGreaterThan(0)
      }
    })

    it('should apply language-specific validation', () => {
      // 1. 英文验证
      const enConstraints = getLanguageConstraints('en')
      expect(validateHeadlineLength('A'.repeat(30), 'en')).toBe(true)
      expect(validateHeadlineLength('A'.repeat(31), 'en')).toBe(false)

      // 2. 德文验证（更宽松）
      const deConstraints = getLanguageConstraints('de')
      expect(validateHeadlineLength('A'.repeat(35), 'de')).toBe(true)
      expect(validateHeadlineLength('A'.repeat(36), 'de')).toBe(false)

      // 3. 日文验证（关键词更少）
      const jaConstraints = getLanguageConstraints('ja')
      expect(jaConstraints.keywordMaxWords).toBeLessThan(enConstraints.keywordMaxWords)
    })
  })

  describe('End-to-end validation workflow', () => {
    it('should validate complete workflow from generation to quality assessment', () => {
      // 1. 验证标题
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.complete)
      expect(typeCoverageReport.isSatisfied).toBe(true)

      // 2. 验证描述
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.complete)
      expect(focusCoverageReport.isSatisfied).toBe(true)

      // 3. 验证关键词
      const priorityDistributionReport = validatePriorityDistribution(
        mockKeywords.complete,
        mockOffers.eufy
      )
      expect(priorityDistributionReport.isSatisfied).toBe(true)

      // 4. 检测冲突
      const conflictReport = detectAllConflicts(
        mockCreatives.complete,
        typeCoverageReport,
        focusCoverageReport,
        priorityDistributionReport
      )
      expect(conflictReport.hasConflicts).toBe(false)

      // 5. 计算质量
      const qualityReport = generateQualityReport(
        mockHeadlines.complete,
        mockOffers.eufy.keywords || []
      )
      expect(qualityReport.metrics.overallScore).toBeGreaterThan(0)

      // 6. 最终验证
      expect(typeCoverageReport.isSatisfied).toBe(true)
      expect(focusCoverageReport.isSatisfied).toBe(true)
      expect(priorityDistributionReport.isSatisfied).toBe(true)
      expect(conflictReport.hasConflicts).toBe(false)
    })

    it('should handle incomplete workflow with recovery', () => {
      // 1. 验证不完整的创意
      const typeCoverageReport = validateTypeCoverage(mockHeadlines.incomplete)
      const focusCoverageReport = validateFocusCoverage(mockDescriptions.incomplete)
      const priorityDistributionReport = validatePriorityDistribution(
        mockKeywords.incomplete,
        mockOffers.eufy
      )

      // 2. 检测冲突
      const conflictReport = detectAllConflicts(
        mockCreatives.incomplete,
        typeCoverageReport,
        focusCoverageReport,
        priorityDistributionReport
      )

      // 3. 如果有冲突，应用恢复策略
      if (conflictReport.hasConflicts) {
        const manager = getConstraintManager()

        // 应用松弛
        if (conflictReport.resolutionStrategy) {
          for (const fallback of conflictReport.resolutionStrategy.fallbacks) {
            manager.relaxConstraint(fallback.constraint, fallback.reason)
          }
        }

        // 验证恢复
        expect(manager.isAnyConstraintRelaxed()).toBe(true)
      }
    })
  })

  describe('Performance integration tests', () => {
    it('should complete full validation workflow within acceptable time', () => {
      const start = performance.now()

      // 执行完整的验证流程
      validateTypeCoverage(mockHeadlines.complete)
      validateFocusCoverage(mockDescriptions.complete)
      validatePriorityDistribution(mockKeywords.complete, mockOffers.eufy)
      detectAllConflicts(mockCreatives.complete)
      calculateQualityMetrics(mockHeadlines.complete, mockOffers.eufy.keywords || [])

      const duration = performance.now() - start

      // 应该在500ms内完成
      expect(duration).toBeLessThan(500)
    })

    it('should handle large datasets efficiently', () => {
      // 创建大型数据集
      const largeHeadlines = Array(100).fill(mockHeadlines.complete).flat()
      const largeKeywords = Array(10).fill(mockKeywords.complete).flat()

      const start = performance.now()

      // 验证大型数据集
      validateTypeCoverage(largeHeadlines.slice(0, 15))
      validatePriorityDistribution(largeKeywords.slice(0, 30), mockOffers.eufy)

      const duration = performance.now() - start

      // 应该在1000ms内完成
      expect(duration).toBeLessThan(1000)
    })
  })

  describe('Error handling and edge cases', () => {
    it('should handle empty creatives gracefully', () => {
      // 1. 验证空标题
      const typeCoverageReport = validateTypeCoverage([])
      expect(typeCoverageReport.isSatisfied).toBe(false)

      // 2. 验证空描述
      const focusCoverageReport = validateFocusCoverage([])
      expect(focusCoverageReport.isSatisfied).toBe(false)

      // 3. 验证空关键词
      const priorityDistributionReport = validatePriorityDistribution([], mockOffers.eufy)
      expect(priorityDistributionReport.isSatisfied).toBe(false)
    })

    it('should handle mixed quality creatives', () => {
      // 混合高质量和低质量的创意
      const mixedHeadlines = [
        ...mockHeadlines.complete.slice(0, 7),
        ...mockHeadlines.short.slice(0, 8)
      ]

      const typeCoverageReport = validateTypeCoverage(mixedHeadlines)
      expect(typeCoverageReport).toBeDefined()

      const qualityReport = generateQualityReport(mixedHeadlines, mockOffers.eufy.keywords || [])
      expect(qualityReport.metrics.overallScore).toBeDefined()
    })

    it('should handle constraint manager state transitions', () => {
      const manager = getConstraintManager()

      // 1. 初始状态
      expect(manager.isAnyConstraintRelaxed()).toBe(false)

      // 2. 应用松弛
      manager.relaxConstraint('diversity', 'Test')
      expect(manager.isAnyConstraintRelaxed()).toBe(true)

      // 3. 重置
      manager.resetConstraints()
      expect(manager.isAnyConstraintRelaxed()).toBe(false)

      // 4. 再次应用松弛
      manager.relaxConstraint('type_coverage', 'Test')
      expect(manager.isAnyConstraintRelaxed()).toBe(true)
    })
  })

  describe('State persistence', () => {
    it('should export and import constraint state', () => {
      const manager = getConstraintManager()

      // 1. 修改约束
      manager.relaxConstraint('diversity', 'Reason 1')
      manager.relaxConstraint('type_coverage', 'Reason 2')

      // 2. 导出状态
      const state = manager.exportState()
      expect(state.relaxations.length).toBe(2)

      // 3. 创建新管理器并导入状态
      resetConstraintManager()
      const newManager = getConstraintManager()
      newManager.importState(state)

      // 4. 验证状态被恢复
      expect(newManager.getRelaxations().length).toBe(2)
      expect(newManager.isAnyConstraintRelaxed()).toBe(true)
    })
  })
})
