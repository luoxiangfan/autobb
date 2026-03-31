import { GOOGLE_ADS_PROHIBITED_SYMBOLS } from './google-ads-ad-text'

/**
 * 约束优先级管理器
 *
 * 管理约束的优先级，支持动态调整和松弛
 * 当无法满足所有约束时，按优先级进行松弛
 */

export type ConstraintPriority = 'P0' | 'P1' | 'P2'

export interface Constraint {
  name: string
  priority: ConstraintPriority
  hardLimit: boolean  // P0=true, P1/P2=false
  currentValue: any
  defaultValue: any
  minValue?: any
  maxValue?: any
  description: string
}

export interface ConstraintRelaxation {
  constraint: string
  originalValue: any
  relaxedValue: any
  reason: string
  severity: 'minor' | 'moderate' | 'major'
  timestamp: Date
}

export interface ConstraintState {
  constraints: Record<string, Constraint>
  relaxations: ConstraintRelaxation[]
  isRelaxed: boolean
}

/**
 * 约束优先级定义
 */
const CONSTRAINT_DEFINITIONS: Record<string, Constraint> = {
  // P0：必须满足（硬限制）
  headline_length: {
    name: 'headline_length',
    priority: 'P0',
    hardLimit: true,
    currentValue: 30,
    defaultValue: 30,
    maxValue: 30,
    description: 'Maximum headline length in characters'
  },
  description_length: {
    name: 'description_length',
    priority: 'P0',
    hardLimit: true,
    currentValue: 90,
    defaultValue: 90,
    maxValue: 90,
    description: 'Maximum description length in characters'
  },
  forbidden_symbols: {
    name: 'forbidden_symbols',
    priority: 'P0',
    hardLimit: true,
    currentValue: GOOGLE_ADS_PROHIBITED_SYMBOLS,
    defaultValue: GOOGLE_ADS_PROHIBITED_SYMBOLS,
    description: 'Forbidden symbols in creatives'
  },
  forbidden_words: {
    name: 'forbidden_words',
    priority: 'P0',
    hardLimit: true,
    currentValue: ['100%', 'best', 'guarantee', 'miracle'],
    defaultValue: ['100%', 'best', 'guarantee', 'miracle'],
    description: 'Forbidden words in creatives'
  },
  keyword_count: {
    name: 'keyword_count',
    priority: 'P0',
    hardLimit: true,
    currentValue: [20, 30],
    defaultValue: [20, 30],
    minValue: [15, 25],
    maxValue: [25, 35],
    description: 'Keyword count range [min, max]'
  },
  language_purity: {
    name: 'language_purity',
    priority: 'P0',
    hardLimit: true,
    currentValue: true,
    defaultValue: true,
    description: 'Enforce single language (no mixing)'
  },
  headline_count: {
    name: 'headline_count',
    priority: 'P0',
    hardLimit: true,
    currentValue: 15,
    defaultValue: 15,
    minValue: 3,
    maxValue: 15,
    description: 'Number of headlines required'
  },
  description_count: {
    name: 'description_count',
    priority: 'P0',
    hardLimit: true,
    currentValue: 4,
    defaultValue: 4,
    minValue: 2,
    maxValue: 4,
    description: 'Number of descriptions required'
  },

  // P1：尽量满足（软限制）
  diversity: {
    name: 'diversity',
    priority: 'P1',
    hardLimit: false,
    currentValue: 0.2,
    defaultValue: 0.2,
    minValue: 0.15,
    maxValue: 0.3,
    description: 'Maximum allowed similarity between creatives (0-1)'
  },
  type_coverage: {
    name: 'type_coverage',
    priority: 'P1',
    hardLimit: false,
    currentValue: 5,
    defaultValue: 5,
    minValue: 3,
    maxValue: 5,
    description: 'Number of headline types to cover'
  },
  focus_coverage: {
    name: 'focus_coverage',
    priority: 'P1',
    hardLimit: false,
    currentValue: 4,
    defaultValue: 4,
    minValue: 2,
    maxValue: 4,
    description: 'Number of description focus types to cover'
  },
  search_volume: {
    name: 'search_volume',
    priority: 'P1',
    hardLimit: false,
    currentValue: 500,
    defaultValue: 500,
    minValue: 100,
    maxValue: 1000,
    description: 'Minimum search volume for keywords'
  },
  cta_presence: {
    name: 'cta_presence',
    priority: 'P1',
    hardLimit: false,
    currentValue: true,
    defaultValue: true,
    description: 'Every description must have CTA'
  },

  // P2：可选（最低优先级）
  length_distribution: {
    name: 'length_distribution',
    priority: 'P2',
    hardLimit: false,
    currentValue: { short: 5, medium: 5, long: 5 },
    defaultValue: { short: 5, medium: 5, long: 5 },
    description: 'Headline length distribution'
  },
  priority_distribution: {
    name: 'priority_distribution',
    priority: 'P2',
    hardLimit: false,
    currentValue: { Brand: [8, 10], Core: [6, 8], Intent: [3, 5], LongTail: [3, 7] },
    defaultValue: { Brand: [8, 10], Core: [6, 8], Intent: [3, 5], LongTail: [3, 7] },
    description: 'Keyword priority distribution'
  },
  social_proof: {
    name: 'social_proof',
    priority: 'P2',
    hardLimit: false,
    currentValue: true,
    defaultValue: true,
    description: 'At least one description should have social proof'
  }
}

/**
 * 约束管理器类
 */
export class ConstraintManager {
  private state: ConstraintState

  constructor() {
    this.state = {
      constraints: JSON.parse(JSON.stringify(CONSTRAINT_DEFINITIONS)),
      relaxations: [],
      isRelaxed: false
    }
  }

  /**
   * 获取约束的优先级
   */
  getConstraintPriority(constraintName: string): ConstraintPriority | null {
    const constraint = this.state.constraints[constraintName]
    return constraint ? constraint.priority : null
  }

  /**
   * 获取所有活跃的约束
   */
  getActiveConstraints(): Constraint[] {
    return Object.values(this.state.constraints)
  }

  /**
   * 获取特定优先级的约束
   */
  getConstraintsByPriority(priority: ConstraintPriority): Constraint[] {
    return Object.values(this.state.constraints).filter(c => c.priority === priority)
  }

  /**
   * 获取约束的当前值
   */
  getConstraintValue(constraintName: string): any {
    const constraint = this.state.constraints[constraintName]
    return constraint ? constraint.currentValue : null
  }

  /**
   * 设置约束的值
   */
  setConstraintValue(constraintName: string, value: any): boolean {
    const constraint = this.state.constraints[constraintName]
    if (!constraint) return false

    // 检查值是否在允许范围内
    if (constraint.minValue !== undefined && value < constraint.minValue) {
      console.warn(`Value ${value} is below minimum ${constraint.minValue}`)
      return false
    }
    if (constraint.maxValue !== undefined && value > constraint.maxValue) {
      console.warn(`Value ${value} is above maximum ${constraint.maxValue}`)
      return false
    }

    constraint.currentValue = value
    return true
  }

  /**
   * 松弛约束
   */
  relaxConstraint(constraintName: string, reason: string): ConstraintRelaxation | null {
    const constraint = this.state.constraints[constraintName]
    if (!constraint) return null

    // P0约束不能松弛
    if (constraint.priority === 'P0') {
      console.warn(`Cannot relax P0 constraint: ${constraintName}`)
      return null
    }

    const originalValue = constraint.currentValue
    let relaxedValue = originalValue

    // 根据约束类型进行松弛
    switch (constraintName) {
      case 'diversity':
        // 从0.2放宽到0.25
        relaxedValue = 0.25
        break
      case 'type_coverage':
        // 从5种类型放宽到3种
        relaxedValue = 3
        break
      case 'focus_coverage':
        // 从4种焦点放宽到2种
        relaxedValue = 2
        break
      case 'search_volume':
        // 从500放宽到100
        relaxedValue = 100
        break
      case 'cta_presence':
        // 从必须有CTA放宽到可选
        relaxedValue = false
        break
      case 'length_distribution':
        // 放宽长度分布要求
        relaxedValue = null
        break
      case 'priority_distribution':
        // 放宽优先级分布要求
        relaxedValue = null
        break
      case 'social_proof':
        // 放宽社会证明要求
        relaxedValue = false
        break
    }

    // 更新约束值
    constraint.currentValue = relaxedValue
    this.state.isRelaxed = true

    // 记录松弛操作
    const relaxation: ConstraintRelaxation = {
      constraint: constraintName,
      originalValue,
      relaxedValue,
      reason,
      severity: this.calculateRelaxationSeverity(constraintName, originalValue, relaxedValue),
      timestamp: new Date()
    }

    this.state.relaxations.push(relaxation)
    return relaxation
  }

  /**
   * 计算松弛的严重程度
   */
  private calculateRelaxationSeverity(
    constraintName: string,
    originalValue: any,
    relaxedValue: any
  ): 'minor' | 'moderate' | 'major' {
    // 多样性松弛：0.2→0.25 = 25%变化 = moderate
    if (constraintName === 'diversity') {
      return 'moderate'
    }

    // 搜索量松弛：500→100 = 80%变化 = major
    if (constraintName === 'search_volume') {
      return 'major'
    }

    // 类型覆盖松弛：5→3 = 40%变化 = moderate
    if (constraintName === 'type_coverage') {
      return 'moderate'
    }

    // 焦点覆盖松弛：4→2 = 50%变化 = moderate
    if (constraintName === 'focus_coverage') {
      return 'moderate'
    }

    // 其他松弛：minor
    return 'minor'
  }

  /**
   * 重置所有约束到默认值
   */
  resetConstraints(): void {
    for (const [name, constraint] of Object.entries(this.state.constraints)) {
      constraint.currentValue = constraint.defaultValue
    }
    this.state.relaxations = []
    this.state.isRelaxed = false
  }

  /**
   * 获取所有松弛操作
   */
  getRelaxations(): ConstraintRelaxation[] {
    return this.state.relaxations
  }

  /**
   * 检查是否有任何约束被松弛
   */
  isAnyConstraintRelaxed(): boolean {
    return this.state.isRelaxed
  }

  /**
   * 获取约束状态摘要
   */
  getConstraintStateSummary(): string {
    const lines: string[] = []

    lines.push('=== Constraint State Summary ===')
    lines.push('')

    // P0约束
    lines.push('P0 Constraints (Hard Limits):')
    for (const constraint of this.getConstraintsByPriority('P0')) {
      lines.push(`  ✅ ${constraint.name}: ${JSON.stringify(constraint.currentValue)}`)
    }

    lines.push('')

    // P1约束
    lines.push('P1 Constraints (Soft Limits):')
    for (const constraint of this.getConstraintsByPriority('P1')) {
      const isRelaxed = this.state.relaxations.some(r => r.constraint === constraint.name)
      const icon = isRelaxed ? '⚠️' : '✅'
      lines.push(`  ${icon} ${constraint.name}: ${JSON.stringify(constraint.currentValue)}`)
    }

    lines.push('')

    // P2约束
    lines.push('P2 Constraints (Optional):')
    for (const constraint of this.getConstraintsByPriority('P2')) {
      const isRelaxed = this.state.relaxations.some(r => r.constraint === constraint.name)
      const icon = isRelaxed ? '⚠️' : '✅'
      lines.push(`  ${icon} ${constraint.name}: ${JSON.stringify(constraint.currentValue)}`)
    }

    if (this.state.relaxations.length > 0) {
      lines.push('')
      lines.push('Relaxations Applied:')
      for (const relaxation of this.state.relaxations) {
        lines.push(`  [${relaxation.severity.toUpperCase()}] ${relaxation.constraint}`)
        lines.push(`    ${relaxation.originalValue} → ${relaxation.relaxedValue}`)
        lines.push(`    Reason: ${relaxation.reason}`)
      }
    }

    return lines.join('\n')
  }

  /**
   * 导出约束状态为JSON
   */
  exportState(): ConstraintState {
    return JSON.parse(JSON.stringify(this.state))
  }

  /**
   * 从JSON导入约束状态
   */
  importState(state: ConstraintState): void {
    this.state = JSON.parse(JSON.stringify(state))
  }
}

/**
 * 创建全局约束管理器实例
 */
let globalConstraintManager: ConstraintManager | null = null

export function getConstraintManager(): ConstraintManager {
  if (!globalConstraintManager) {
    globalConstraintManager = new ConstraintManager()
  }
  return globalConstraintManager
}

export function resetConstraintManager(): void {
  globalConstraintManager = null
}
