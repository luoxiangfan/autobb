/**
 * 约束冲突检测器
 *
 * 检测生成的创意中是否存在约束冲突
 * 例如：多样性 vs 类型覆盖、CTA vs 多样性等
 */

import type { GeneratedAdCreativeData } from './ad-creative'
import type { TypeCoverageReport } from './headline-type-classifier'
import type { FocusCoverageReport } from './description-focus-classifier'
import type { PriorityDistributionReport } from './keyword-priority-classifier'

export type ConflictType =
  | 'diversity_vs_type_coverage'
  | 'diversity_vs_focus_coverage'
  | 'cta_vs_diversity'
  | 'keyword_quantity_vs_volume'
  | 'insufficient_creatives'
  | 'insufficient_keywords'

export type ConflictSeverity = 'critical' | 'warning' | 'info'

export interface Conflict {
  type: ConflictType
  severity: ConflictSeverity
  message: string
  affectedElements: string[]
  suggestedAction: string
}

export interface ConflictReport {
  hasConflicts: boolean
  conflicts: Conflict[]
  severity: ConflictSeverity
  recommendations: string[]
  resolutionStrategy?: ResolutionStrategy
}

export interface ResolutionStrategy {
  actions: ConstraintAction[]
  fallbacks: ConstraintFallback[]
  priority: 'preserve_diversity' | 'preserve_coverage' | 'preserve_quantity'
}

export interface ConstraintAction {
  action: string
  constraint: string
  from: any
  to: any
  reason: string
}

export interface ConstraintFallback {
  constraint: string
  from: any
  to: any
  reason: string
  severity: 'minor' | 'moderate' | 'major'
}

/**
 * 检测多样性 vs 类型覆盖冲突
 *
 * 问题：同类型标题天然相似度高，难以满足≤20%多样性要求
 * 症状：
 * - 多样性过滤移除了很多标题
 * - 无法覆盖所有5种类型
 * - 最终标题数 < 15
 */
export function detectDiversityVsTypeCoverageConflict(
  headlines: string[],
  typeCoverageReport: TypeCoverageReport,
  averageSimilarity: number
): Conflict | null {
  // 检查是否存在冲突
  const hasTypeCoverageFail = !typeCoverageReport.isSatisfied
  const hasDiversityIssue = averageSimilarity > 0.15  // 接近20%限制
  const hasInsufficientHeadlines = headlines.length < 15

  // 只有当多样性确实是问题时，才报告冲突
  // 如果多样性很低（<15%），数量不足不是多样性造成的，不应报冲突
  if (hasTypeCoverageFail && hasDiversityIssue && hasInsufficientHeadlines) {
    return {
      type: 'diversity_vs_type_coverage',
      severity: 'critical',
      message: `Cannot satisfy both type coverage (${typeCoverageReport.missing.length} missing) and diversity (avg similarity: ${(averageSimilarity * 100).toFixed(1)}%). Only ${headlines.length}/15 headlines generated.`,
      affectedElements: typeCoverageReport.missing,
      suggestedAction: 'Relax diversity requirement from 20% to 25% or reduce type coverage requirement'
    }
  }

  return null
}

/**
 * 检测多样性 vs 焦点覆盖冲突
 *
 * 问题：每条描述都需要CTA，但CTA会导致相似度高
 * 症状：
 * - 无法覆盖所有4种焦点
 * - 多样性过滤移除了很多描述
 * - 最终描述数 < 4
 */
export function detectDiversityVsFocusCoverageConflict(
  descriptions: string[],
  focusCoverageReport: FocusCoverageReport,
  averageSimilarity: number
): Conflict | null {
  // 检查是否存在冲突
  const hasFocusCoverageFail = !focusCoverageReport.isSatisfied
  const hasCTAMissing = focusCoverageReport.ctaMissing.length > 0
  const hasDiversityIssue = averageSimilarity > 0.15
  const hasInsufficientDescriptions = descriptions.length < 4

  if ((hasFocusCoverageFail || hasCTAMissing) && (hasDiversityIssue || hasInsufficientDescriptions)) {
    const issues: string[] = []
    if (focusCoverageReport.missing.length > 0) {
      issues.push(`missing focus: ${focusCoverageReport.missing.join(', ')}`)
    }
    if (focusCoverageReport.ctaMissing.length > 0) {
      issues.push(`${focusCoverageReport.ctaMissing.length} descriptions missing CTA`)
    }

    return {
      type: 'diversity_vs_focus_coverage',
      severity: 'critical',
      message: `Cannot satisfy both focus coverage (${issues.join('; ')}) and diversity (avg similarity: ${(averageSimilarity * 100).toFixed(1)}%). Only ${descriptions.length}/4 descriptions generated.`,
      affectedElements: focusCoverageReport.missing,
      suggestedAction: 'Use more diverse CTA expressions or relax diversity requirement'
    }
  }

  return null
}

/**
 * 检测CTA vs 多样性冲突
 *
 * 问题：所有描述都有CTA会导致相似度高
 * 症状：
 * - 所有描述都以相似的CTA结尾
 * - 多样性过滤移除了很多描述
 */
export function detectCTAVsDiversityConflict(
  descriptions: string[],
  ctaPresence: Record<number, boolean>,
  averageSimilarity: number
): Conflict | null {
  // 检查是否所有描述都有CTA
  const allHaveCTA = Object.values(ctaPresence).every(has => has)
  const hasDiversityIssue = averageSimilarity > 0.18  // 接近20%限制

  if (allHaveCTA && hasDiversityIssue && descriptions.length < 4) {
    return {
      type: 'cta_vs_diversity',
      severity: 'warning',
      message: `All descriptions have CTA, but average similarity is ${(averageSimilarity * 100).toFixed(1)}% (limit: 20%). This may cause diversity filter to remove descriptions.`,
      affectedElements: Object.entries(ctaPresence)
        .filter(([_, has]) => has)
        .map(([idx]) => `Description ${parseInt(idx) + 1}`),
      suggestedAction: 'Use more diverse CTA expressions or vary CTA placement'
    }
  }

  return null
}

/**
 * 检测关键词数量 vs 搜索量冲突
 *
 * 问题：无法找到足够的高搜索量关键词
 * 症状：
 * - 关键词数 < 20
 * - 平均搜索量 < 500
 */
export function detectKeywordQuantityVsVolumeConflict(
  keywords: Array<{ keyword: string; searchVolume?: number }>,
  averageSearchVolume: number
): Conflict | null {
  const keywordCount = keywords.length
  const hasInsufficientKeywords = keywordCount < 20
  const hasLowSearchVolume = averageSearchVolume < 500

  if (hasInsufficientKeywords && hasLowSearchVolume) {
    return {
      type: 'keyword_quantity_vs_volume',
      severity: 'warning',
      message: `Insufficient keywords (${keywordCount}/20) with low average search volume (${averageSearchVolume.toFixed(0)}/month). May indicate limited market opportunity.`,
      affectedElements: keywords.map(kw => kw.keyword),
      suggestedAction: 'Lower search volume requirement or expand keyword research'
    }
  }

  return null
}

/**
 * 检测创意数不足冲突
 *
 * 问题：多样性过滤导致创意数不足
 * 症状：
 * - 标题数 < 3
 * - 描述数 < 2
 */
export function detectInsufficientCreativesConflict(
  headlines: string[],
  descriptions: string[]
): Conflict | null {
  const headlineIssue = headlines.length < 3
  const descriptionIssue = descriptions.length < 2

  if (headlineIssue || descriptionIssue) {
    const issues: string[] = []
    if (headlineIssue) {
      issues.push(`only ${headlines.length}/3 headlines`)
    }
    if (descriptionIssue) {
      issues.push(`only ${descriptions.length}/2 descriptions`)
    }

    return {
      type: 'insufficient_creatives',
      severity: 'critical',
      message: `Insufficient creatives after filtering: ${issues.join(', ')}. Diversity filter may be too strict.`,
      affectedElements: issues,
      suggestedAction: 'Relax diversity requirement or increase initial generation count'
    }
  }

  return null
}

/**
 * 检测关键词数不足冲突
 *
 * 问题：关键词过滤导致关键词数不足
 * 症状：
 * - 关键词数 < 15
 */
export function detectInsufficientKeywordsConflict(
  keywords: Array<{ keyword: string; searchVolume?: number }>
): Conflict | null {
  const keywordCount = keywords.length

  if (keywordCount < 15) {
    return {
      type: 'insufficient_keywords',
      severity: 'warning',
      message: `Insufficient keywords: ${keywordCount}/20. Keyword filters may be too strict.`,
      affectedElements: keywords.map(kw => kw.keyword),
      suggestedAction: 'Lower search volume requirement or relax keyword validation rules'
    }
  }

  return null
}

/**
 * 检测所有约束冲突
 */
export function detectAllConflicts(
  creatives: GeneratedAdCreativeData,
  typeCoverageReport?: TypeCoverageReport,
  focusCoverageReport?: FocusCoverageReport,
  priorityDistributionReport?: PriorityDistributionReport,
  averageHeadlineSimilarity?: number,
  averageDescriptionSimilarity?: number
): ConflictReport {
  const conflicts: Conflict[] = []

  // 计算平均相似度
  const avgHeadlineSim = averageHeadlineSimilarity ?? 0.15
  const avgDescriptionSim = averageDescriptionSimilarity ?? 0.15

  // 检测各种冲突
  if (typeCoverageReport) {
    const conflict = detectDiversityVsTypeCoverageConflict(
      creatives.headlines,
      typeCoverageReport,
      avgHeadlineSim
    )
    if (conflict) conflicts.push(conflict)
  }

  if (focusCoverageReport) {
    const conflict = detectDiversityVsFocusCoverageConflict(
      creatives.descriptions,
      focusCoverageReport,
      avgDescriptionSim
    )
    if (conflict) conflicts.push(conflict)

    // 检测CTA vs 多样性冲突
    const ctaPresence: Record<number, boolean> = {}
    for (let i = 0; i < creatives.descriptions.length; i++) {
      ctaPresence[i] = focusCoverageReport.ctaValidation[i] ?? false
    }
    const ctaConflict = detectCTAVsDiversityConflict(
      creatives.descriptions,
      ctaPresence,
      avgDescriptionSim
    )
    if (ctaConflict) conflicts.push(ctaConflict)
  }

  if (priorityDistributionReport) {
    // 使用 keywordsWithVolume 如果存在，否则使用默认值
    const keywordsData = creatives.keywordsWithVolume || creatives.keywords.map(k => ({ keyword: k, searchVolume: 0 }))
    const avgVolume = keywordsData.reduce((sum, kw) => sum + (kw.searchVolume ?? 0), 0) / keywordsData.length
    const conflict = detectKeywordQuantityVsVolumeConflict(
      keywordsData.map(kw => ({ keyword: kw.keyword, searchVolume: kw.searchVolume })),
      avgVolume
    )
    if (conflict) conflicts.push(conflict)
  }

  // 检测创意数不足
  const insufficientCreatives = detectInsufficientCreativesConflict(
    creatives.headlines,
    creatives.descriptions
  )
  if (insufficientCreatives) conflicts.push(insufficientCreatives)

  // 检测关键词数不足
  const keywordsForCheck = creatives.keywordsWithVolume || creatives.keywords.map(k => ({ keyword: k, searchVolume: 0 }))
  const insufficientKeywords = detectInsufficientKeywordsConflict(
    keywordsForCheck.map(kw => ({ keyword: kw.keyword, searchVolume: kw.searchVolume }))
  )
  if (insufficientKeywords) conflicts.push(insufficientKeywords)

  // 确定最高严重程度
  let maxSeverity: ConflictSeverity = 'info'
  for (const conflict of conflicts) {
    if (conflict.severity === 'critical') {
      maxSeverity = 'critical'
      break
    }
    if (conflict.severity === 'warning') {
      maxSeverity = 'warning'
      // 继续检查是否有critical
    }
  }

  // 生成建议
  const recommendations: string[] = []
  for (const conflict of conflicts) {
    recommendations.push(`[${conflict.severity.toUpperCase()}] ${conflict.message}`)
    recommendations.push(`  → ${conflict.suggestedAction}`)
  }

  // 生成解决策略
  let resolutionStrategy: ResolutionStrategy | undefined
  if (conflicts.length > 0) {
    resolutionStrategy = generateResolutionStrategy(conflicts)
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
    severity: maxSeverity,
    recommendations,
    resolutionStrategy
  }
}

/**
 * 生成解决策略
 */
export function generateResolutionStrategy(conflicts: Conflict[]): ResolutionStrategy {
  const strategy: ResolutionStrategy = {
    actions: [],
    fallbacks: [],
    priority: 'preserve_diversity'
  }

  // 分析冲突类型
  const hasDiversityConflict = conflicts.some(c =>
    c.type === 'diversity_vs_type_coverage' || c.type === 'diversity_vs_focus_coverage'
  )
  const hasQuantityConflict = conflicts.some(c =>
    c.type === 'insufficient_creatives' || c.type === 'insufficient_keywords'
  )

  if (hasDiversityConflict && hasQuantityConflict) {
    // 优先保留多样性，放宽类型覆盖
    strategy.priority = 'preserve_diversity'
    strategy.actions.push({
      action: 'relax_type_coverage',
      constraint: 'type_coverage',
      from: 5,
      to: 3,
      reason: 'Reduce type coverage requirement to preserve diversity'
    })
    strategy.fallbacks.push({
      constraint: 'diversity',
      from: 0.2,
      to: 0.25,
      reason: 'Relax diversity threshold if type coverage still fails',
      severity: 'moderate'
    })
  } else if (hasQuantityConflict) {
    // 优先保留数量
    strategy.priority = 'preserve_quantity'
    strategy.fallbacks.push({
      constraint: 'diversity',
      from: 0.2,
      to: 0.25,
      reason: 'Relax diversity to ensure minimum creative count',
      severity: 'moderate'
    })
    strategy.fallbacks.push({
      constraint: 'search_volume',
      from: 500,
      to: 100,
      reason: 'Lower search volume requirement for keywords',
      severity: 'moderate'
    })
  }

  return strategy
}

/**
 * 生成冲突报告的摘要
 */
export function generateConflictReportSummary(report: ConflictReport): string {
  const lines: string[] = []

  lines.push('=== Constraint Conflict Report ===')
  lines.push('')

  if (!report.hasConflicts) {
    lines.push('✅ No conflicts detected')
    return lines.join('\n')
  }

  lines.push(`❌ ${report.conflicts.length} conflict(s) detected`)
  lines.push(`Severity: ${report.severity.toUpperCase()}`)
  lines.push('')

  lines.push('Conflicts:')
  for (let i = 0; i < report.conflicts.length; i++) {
    const conflict = report.conflicts[i]
    const icon = conflict.severity === 'critical' ? '🔴' : conflict.severity === 'warning' ? '🟡' : '🔵'
    lines.push(`${i + 1}. ${icon} ${conflict.type}`)
    lines.push(`   Message: ${conflict.message}`)
    lines.push(`   Action: ${conflict.suggestedAction}`)
  }

  if (report.resolutionStrategy) {
    lines.push('')
    lines.push('Resolution Strategy:')
    lines.push(`Priority: ${report.resolutionStrategy.priority}`)

    if (report.resolutionStrategy.actions.length > 0) {
      lines.push('Actions:')
      for (const action of report.resolutionStrategy.actions) {
        lines.push(`  - ${action.action}: ${action.from} → ${action.to}`)
        lines.push(`    Reason: ${action.reason}`)
      }
    }

    if (report.resolutionStrategy.fallbacks.length > 0) {
      lines.push('Fallbacks:')
      for (const fallback of report.resolutionStrategy.fallbacks) {
        lines.push(`  - ${fallback.constraint}: ${fallback.from} → ${fallback.to}`)
        lines.push(`    Reason: ${fallback.reason}`)
      }
    }
  }

  return lines.join('\n')
}
