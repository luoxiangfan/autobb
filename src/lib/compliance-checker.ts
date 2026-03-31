import { findGoogleAdsProhibitedSymbols } from './google-ads-ad-text'

/**
 * Google Ads 合规性检查规则引擎
 *
 * 实现20+条Google Ads政策规则，检测违规内容
 * 规则参考：https://support.google.com/adspolicy/answer/6008942
 */

export type ComplianceSeverity = 'high' | 'medium' | 'low'

export interface ComplianceIssue {
  ruleId: string
  ruleName: string
  severity: ComplianceSeverity
  field: 'headline' | 'description' | 'url' | 'general'
  fieldIndex?: number // 针对特定的headline或description索引
  message: string
  suggestion?: string
  violatingText?: string
}

export interface ComplianceCheckResult {
  isCompliant: boolean
  totalIssues: number
  highSeverityCount: number
  mediumSeverityCount: number
  lowSeverityCount: number
  issues: ComplianceIssue[]
}

export interface CreativeContent {
  headlines: string[]
  descriptions: string[]
  finalUrl?: string
  brandName?: string
}

/**
 * 禁用词汇库
 */
const PROHIBITED_WORDS = {
  // 夸大宣传词汇
  exaggeration: [
    '最好', '第一', '最优', '顶级', '极致', '完美', '无敌', '绝对',
    'best', 'number one', '#1', 'top', 'ultimate', 'perfect', 'unbeatable',
    '最强', '最大', '最快', '最便宜', '史上最', '全球第一'
  ],

  // 绝对化词汇
  absolute: [
    '100%', '百分百', '绝不', '必定', '一定', '保证', '确保',
    'guaranteed', 'always', 'never', 'absolutely', 'definitely',
    '永不', '永久', '终身', '无限'
  ],

  // 医疗健康声明
  medical: [
    '治疗', '治愈', '疗效', '药效', '病症', '疾病', '医学',
    'cure', 'treat', 'disease', 'medical', 'therapy', 'diagnosis',
    '处方', '临床', '症状', '诊断', '健康保证'
  ],

  // 金融承诺
  financial: [
    '保本', '稳赚', '无风险', '必赢', '回报保证',
    'risk-free', 'guaranteed return', 'no risk', 'profit guaranteed',
    '零风险', '快速致富', '暴富'
  ],

  // 误导性词汇
  misleading: [
    '免费', '白送', '不要钱', '零元', '限时', '即将结束',
    'free', 'giveaway', 'last chance', 'limited time', 'act now',
    '马上抢', '错过不再', '仅此一次'
  ]
}

/**
 * 检查是否包含禁用词汇
 */
function checkProhibitedWords(text: string): { category: string; words: string[] }[] {
  const violations: { category: string; words: string[] }[] = []
  const lowerText = text.toLowerCase()

  for (const [category, words] of Object.entries(PROHIBITED_WORDS)) {
    const foundWords = words.filter(word =>
      lowerText.includes(word.toLowerCase())
    )

    if (foundWords.length > 0) {
      violations.push({ category, words: foundWords })
    }
  }

  return violations
}

/**
 * 规则1-5: 禁用词汇检查
 */
function rule_ProhibitedWords(content: CreativeContent): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []

  // 检查headlines
  content.headlines.forEach((headline, index) => {
    const violations = checkProhibitedWords(headline)

    violations.forEach(({ category, words }) => {
      const severityMap: Record<string, ComplianceSeverity> = {
        medical: 'high',
        financial: 'high',
        absolute: 'medium',
        exaggeration: 'medium',
        misleading: 'low'
      }

      const categoryNames: Record<string, string> = {
        exaggeration: '夸大宣传',
        absolute: '绝对化表述',
        medical: '医疗健康声明',
        financial: '金融承诺',
        misleading: '误导性词汇'
      }

      issues.push({
        ruleId: `R${category.toUpperCase()}_HEADLINE`,
        ruleName: `禁止${categoryNames[category]}`,
        severity: severityMap[category],
        field: 'headline',
        fieldIndex: index,
        message: `标题${index + 1}包含违规词汇：${words.join('、')}`,
        suggestion: `请移除或替换这些词汇，使用更客观的描述`,
        violatingText: headline
      })
    })
  })

  // 检查descriptions
  content.descriptions.forEach((desc, index) => {
    const violations = checkProhibitedWords(desc)

    violations.forEach(({ category, words }) => {
      const severityMap: Record<string, ComplianceSeverity> = {
        medical: 'high',
        financial: 'high',
        absolute: 'medium',
        exaggeration: 'medium',
        misleading: 'low'
      }

      const categoryNames: Record<string, string> = {
        exaggeration: '夸大宣传',
        absolute: '绝对化表述',
        medical: '医疗健康声明',
        financial: '金融承诺',
        misleading: '误导性词汇'
      }

      issues.push({
        ruleId: `R${category.toUpperCase()}_DESCRIPTION`,
        ruleName: `禁止${categoryNames[category]}`,
        severity: severityMap[category],
        field: 'description',
        fieldIndex: index,
        message: `描述${index + 1}包含违规词汇：${words.join('、')}`,
        suggestion: `请移除或替换这些词汇，使用更客观的描述`,
        violatingText: desc
      })
    })
  })

  return issues
}

/**
 * 规则6: 过度大写检查
 */
function rule_ExcessiveCapitalization(content: CreativeContent): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []

  const checkText = (text: string, field: 'headline' | 'description', index: number) => {
    // 统计大写字母比例
    const upperCount = (text.match(/[A-Z]/g) || []).length
    const letterCount = (text.match(/[A-Za-z]/g) || []).length

    if (letterCount > 0 && upperCount / letterCount > 0.5) {
      issues.push({
        ruleId: 'R_EXCESSIVE_CAPS',
        ruleName: '过度大写',
        severity: 'low',
        field,
        fieldIndex: index,
        message: `${field === 'headline' ? '标题' : '描述'}${index + 1}大写字母过多（${Math.round(upperCount / letterCount * 100)}%）`,
        suggestion: '请使用正常大小写格式，仅首字母或专有名词大写',
        violatingText: text
      })
    }
  }

  content.headlines.forEach((headline, index) => checkText(headline, 'headline', index))
  content.descriptions.forEach((desc, index) => checkText(desc, 'description', index))

  return issues
}

/**
 * 规则7: 过度标点符号检查
 */
function rule_ExcessivePunctuation(content: CreativeContent): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []

  const checkText = (text: string, field: 'headline' | 'description', index: number) => {
    // 检查重复标点（如：!!!、???、...）
    const repeatedPunctuation = text.match(/[!?。，,.]{2,}/g)
    if (repeatedPunctuation) {
      issues.push({
        ruleId: 'R_REPEATED_PUNCTUATION',
        ruleName: '重复标点符号',
        severity: 'low',
        field,
        fieldIndex: index,
        message: `${field === 'headline' ? '标题' : '描述'}${index + 1}包含重复标点：${repeatedPunctuation.join('、')}`,
        suggestion: '请移除重复的标点符号',
        violatingText: text
      })
    }

    // 检查感叹号过多
    const exclamationCount = (text.match(/!/g) || []).length
    if (exclamationCount > 1) {
      issues.push({
        ruleId: 'R_EXCESSIVE_EXCLAMATION',
        ruleName: '过多感叹号',
        severity: 'low',
        field,
        fieldIndex: index,
        message: `${field === 'headline' ? '标题' : '描述'}${index + 1}包含${exclamationCount}个感叹号`,
        suggestion: '建议最多使用1个感叹号',
        violatingText: text
      })
    }
  }

  content.headlines.forEach((headline, index) => checkText(headline, 'headline', index))
  content.descriptions.forEach((desc, index) => checkText(desc, 'description', index))

  return issues
}

/**
 * 规则8: 特殊符号检查
 */
function rule_ProhibitedSymbols(content: CreativeContent): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []

  const checkText = (text: string, field: 'headline' | 'description', index: number) => {
    const foundSymbols = findGoogleAdsProhibitedSymbols(text)

    if (foundSymbols.length > 0) {
      issues.push({
        ruleId: 'R_PROHIBITED_SYMBOLS',
        ruleName: '禁止特殊符号',
        severity: 'medium',
        field,
        fieldIndex: index,
        message: `${field === 'headline' ? '标题' : '描述'}${index + 1}包含禁止符号：${foundSymbols.join('、')}`,
        suggestion: '请移除特殊符号，使用文字描述',
        violatingText: text
      })
    }
  }

  content.headlines.forEach((headline, index) => checkText(headline, 'headline', index))
  content.descriptions.forEach((desc, index) => checkText(desc, 'description', index))

  return issues
}

/**
 * 规则9: 字符长度检查
 */
function rule_CharacterLength(content: CreativeContent): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []

  // Headline最多30字符
  content.headlines.forEach((headline, index) => {
    if (headline.length > 30) {
      issues.push({
        ruleId: 'R_HEADLINE_LENGTH',
        ruleName: '标题长度超限',
        severity: 'high',
        field: 'headline',
        fieldIndex: index,
        message: `标题${index + 1}长度为${headline.length}字符，超过30字符限制`,
        suggestion: `请缩短至30字符以内`,
        violatingText: headline
      })
    }
  })

  // Description最多90字符
  content.descriptions.forEach((desc, index) => {
    if (desc.length > 90) {
      issues.push({
        ruleId: 'R_DESCRIPTION_LENGTH',
        ruleName: '描述长度超限',
        severity: 'high',
        field: 'description',
        fieldIndex: index,
        message: `描述${index + 1}长度为${desc.length}字符，超过90字符限制`,
        suggestion: `请缩短至90字符以内`,
        violatingText: desc
      })
    }
  })

  return issues
}

/**
 * 规则10: 重复内容检查
 */
function rule_DuplicateContent(content: CreativeContent): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []

  // 检查headline重复
  const headlineSet = new Set<string>()
  content.headlines.forEach((headline, index) => {
    if (headlineSet.has(headline.toLowerCase())) {
      issues.push({
        ruleId: 'R_DUPLICATE_HEADLINE',
        ruleName: '重复标题',
        severity: 'medium',
        field: 'headline',
        fieldIndex: index,
        message: `标题${index + 1}与其他标题重复`,
        suggestion: '请提供不同的标题内容',
        violatingText: headline
      })
    }
    headlineSet.add(headline.toLowerCase())
  })

  // 检查description重复
  const descSet = new Set<string>()
  content.descriptions.forEach((desc, index) => {
    if (descSet.has(desc.toLowerCase())) {
      issues.push({
        ruleId: 'R_DUPLICATE_DESCRIPTION',
        ruleName: '重复描述',
        severity: 'medium',
        field: 'description',
        fieldIndex: index,
        message: `描述${index + 1}与其他描述重复`,
        suggestion: '请提供不同的描述内容',
        violatingText: desc
      })
    }
    descSet.add(desc.toLowerCase())
  })

  return issues
}

/**
 * 规则11: URL检查
 */
function rule_URLValidation(content: CreativeContent): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []

  if (content.finalUrl) {
    // 检查URL格式
    try {
      const url = new URL(content.finalUrl)

      // 检查是否使用HTTPS
      if (url.protocol !== 'https:') {
        issues.push({
          ruleId: 'R_URL_HTTPS',
          ruleName: 'URL需使用HTTPS',
          severity: 'high',
          field: 'url',
          message: `着陆页URL未使用HTTPS协议`,
          suggestion: '请使用HTTPS协议以确保安全性',
          violatingText: content.finalUrl
        })
      }
    } catch (error) {
      issues.push({
        ruleId: 'R_URL_INVALID',
        ruleName: '无效URL',
        severity: 'high',
        field: 'url',
        message: `着陆页URL格式无效`,
        suggestion: '请提供有效的URL地址',
        violatingText: content.finalUrl
      })
    }
  }

  return issues
}

/**
 * 规则12: 品牌一致性检查
 */
function rule_BrandConsistency(content: CreativeContent): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []

  if (!content.brandName) {
    return issues
  }

  const brandName = content.brandName.toLowerCase()
  let brandMentionCount = 0

  // 统计品牌名称出现次数
  content.headlines.forEach((headline) => {
    if (headline.toLowerCase().includes(brandName)) {
      brandMentionCount++
    }
  })

  content.descriptions.forEach((desc) => {
    if (desc.toLowerCase().includes(brandName)) {
      brandMentionCount++
    }
  })

  // 至少应该出现1次品牌名
  if (brandMentionCount === 0) {
    issues.push({
      ruleId: 'R_BRAND_MISSING',
      ruleName: '缺少品牌名称',
      severity: 'low',
      field: 'general',
      message: `广告内容中未提及品牌名称"${content.brandName}"`,
      suggestion: '建议在至少一个标题或描述中包含品牌名称'
    })
  }

  return issues
}

/**
 * 规则13: 空白内容检查
 */
function rule_EmptyContent(content: CreativeContent): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []

  content.headlines.forEach((headline, index) => {
    if (!headline.trim()) {
      issues.push({
        ruleId: 'R_EMPTY_HEADLINE',
        ruleName: '空标题',
        severity: 'high',
        field: 'headline',
        fieldIndex: index,
        message: `标题${index + 1}为空`,
        suggestion: '请提供有效的标题内容'
      })
    }
  })

  content.descriptions.forEach((desc, index) => {
    if (!desc.trim()) {
      issues.push({
        ruleId: 'R_EMPTY_DESCRIPTION',
        ruleName: '空描述',
        severity: 'high',
        field: 'description',
        fieldIndex: index,
        message: `描述${index + 1}为空`,
        suggestion: '请提供有效的描述内容'
      })
    }
  })

  return issues
}

/**
 * 规则14-20: 更多合规规则（可扩展）
 */
function rule_AdditionalRules(content: CreativeContent): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []

  // 规则14: 检查是否包含点击诱导词汇
  const clickbaitWords = ['点击这里', '立即点击', 'click here', 'click now', '马上点击']

  content.headlines.forEach((headline, index) => {
    const lowerHeadline = headline.toLowerCase()
    const foundWords = clickbaitWords.filter(word => lowerHeadline.includes(word.toLowerCase()))

    if (foundWords.length > 0) {
      issues.push({
        ruleId: 'R_CLICKBAIT',
        ruleName: '点击诱导',
        severity: 'medium',
        field: 'headline',
        fieldIndex: index,
        message: `标题${index + 1}包含点击诱导词汇：${foundWords.join('、')}`,
        suggestion: '请使用更自然的引导语',
        violatingText: headline
      })
    }
  })

  // 规则15: 检查数字格式
  content.headlines.forEach((headline, index) => {
    // 检查是否有不规范的折扣表述
    const invalidDiscount = headline.match(/[0-9]+折|打[0-9]+折/)
    if (invalidDiscount) {
      issues.push({
        ruleId: 'R_DISCOUNT_FORMAT',
        ruleName: '折扣格式不规范',
        severity: 'low',
        field: 'headline',
        fieldIndex: index,
        message: `标题${index + 1}的折扣表述可能不符合规范`,
        suggestion: '请使用明确的价格或百分比折扣',
        violatingText: headline
      })
    }
  })

  return issues
}

/**
 * 执行所有合规性检查
 */
export function checkCompliance(content: CreativeContent): ComplianceCheckResult {
  const allIssues: ComplianceIssue[] = []

  // 执行所有规则检查
  const rules = [
    rule_ProhibitedWords,
    rule_ExcessiveCapitalization,
    rule_ExcessivePunctuation,
    rule_ProhibitedSymbols,
    rule_CharacterLength,
    rule_DuplicateContent,
    rule_URLValidation,
    rule_BrandConsistency,
    rule_EmptyContent,
    rule_AdditionalRules
  ]

  rules.forEach(rule => {
    const issues = rule(content)
    allIssues.push(...issues)
  })

  // 统计各严重程度数量
  const highSeverityCount = allIssues.filter(i => i.severity === 'high').length
  const mediumSeverityCount = allIssues.filter(i => i.severity === 'medium').length
  const lowSeverityCount = allIssues.filter(i => i.severity === 'low').length

  return {
    isCompliant: highSeverityCount === 0,
    totalIssues: allIssues.length,
    highSeverityCount,
    mediumSeverityCount,
    lowSeverityCount,
    issues: allIssues
  }
}

/**
 * 获取修复建议
 */
export function getAutoFixSuggestions(issue: ComplianceIssue, originalText: string): string | null {
  switch (issue.ruleId) {
    case 'R_EXCESSIVE_CAPS':
      // 自动修正大写：仅首字母大写
      return originalText.charAt(0).toUpperCase() + originalText.slice(1).toLowerCase()

    case 'R_REPEATED_PUNCTUATION':
      // 移除重复标点
      return originalText.replace(/[!?。，,.]{2,}/g, (match) => match[0])

    case 'R_EXCESSIVE_EXCLAMATION':
      // 保留最多1个感叹号
      let count = 0
      return originalText.replace(/!/g, () => {
        count++
        return count === 1 ? '!' : ''
      })

    default:
      return null
  }
}
