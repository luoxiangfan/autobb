/**
 * 语言特定约束配置
 *
 * 根据不同语言调整约束条件
 * 考虑语言特性：复合词长度、表达冗长度等
 */

export interface LanguageConstraints {
  language: string
  languageCode: string
  headlineLength: number
  descriptionLength: number
  calloutLength: number
  sitelinkTextLength: number
  sitelinkDescLength: number
  keywordMaxWords: number
  keywordMinSearchVolume: number
  description: string
}

/**
 * 语言约束配置表
 *
 * 基准：英文
 * - 标题：≤30字符
 * - 描述：≤90字符
 * - 关键词：1-4个单词
 * - 最小搜索量：500/月
 */
export const LANGUAGE_CONSTRAINTS: Record<string, LanguageConstraints> = {
  en: {
    language: 'English',
    languageCode: 'en',
    headlineLength: 30,
    descriptionLength: 90,
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35,
    keywordMaxWords: 4,
    keywordMinSearchVolume: 500,
    description: 'English - baseline constraints'
  },

  de: {
    language: 'German',
    languageCode: 'de',
    headlineLength: 35,  // +5 (复合词较长)
    descriptionLength: 100,  // +10
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35,
    keywordMaxWords: 3,  // -1 (复合词通常较长)
    keywordMinSearchVolume: 400,  // -100
    description: 'German - longer compound words, adjusted for complexity'
  },

  it: {
    language: 'Italian',
    languageCode: 'it',
    headlineLength: 32,  // +2 (表达较冗长)
    descriptionLength: 95,  // +5
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35,
    keywordMaxWords: 4,  // 保持不变
    keywordMinSearchVolume: 300,  // -200 (小语言市场)
    description: 'Italian - more verbose expressions, smaller market'
  },

  es: {
    language: 'Spanish',
    languageCode: 'es',
    headlineLength: 32,  // +2
    descriptionLength: 95,  // +5
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35,
    keywordMaxWords: 4,
    keywordMinSearchVolume: 350,  // -150
    description: 'Spanish - similar to Italian, moderate market'
  },

  fr: {
    language: 'French',
    languageCode: 'fr',
    headlineLength: 32,  // +2
    descriptionLength: 95,  // +5
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35,
    keywordMaxWords: 4,
    keywordMinSearchVolume: 400,  // -100
    description: 'French - verbose expressions, moderate market'
  },

  pt: {
    language: 'Portuguese',
    languageCode: 'pt',
    headlineLength: 32,  // +2
    descriptionLength: 95,  // +5
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35,
    keywordMaxWords: 4,
    keywordMinSearchVolume: 300,  // -200
    description: 'Portuguese - verbose, smaller market'
  },

  ja: {
    language: 'Japanese',
    languageCode: 'ja',
    headlineLength: 30,  // 保持不变 (字符更紧凑)
    descriptionLength: 90,  // 保持不变
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35,
    keywordMaxWords: 2,  // -2 (字符更紧凑，通常用2个词)
    keywordMinSearchVolume: 250,  // -250
    description: 'Japanese - compact characters, fewer words needed'
  },

  ko: {
    language: 'Korean',
    languageCode: 'ko',
    headlineLength: 30,  // 保持不变
    descriptionLength: 90,  // 保持不变
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35,
    keywordMaxWords: 2,  // -2
    keywordMinSearchVolume: 250,  // -250
    description: 'Korean - compact characters, fewer words needed'
  },

  zh: {
    language: 'Chinese',
    languageCode: 'zh',
    headlineLength: 30,  // 保持不变
    descriptionLength: 90,  // 保持不变
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35,
    keywordMaxWords: 3,  // -1 (字符紧凑，但可能需要3个词)
    keywordMinSearchVolume: 300,  // -200
    description: 'Chinese - compact characters, moderate market'
  },

  ru: {
    language: 'Russian',
    languageCode: 'ru',
    headlineLength: 33,  // +3 (西里尔字母较长)
    descriptionLength: 95,  // +5
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35,
    keywordMaxWords: 3,  // -1
    keywordMinSearchVolume: 300,  // -200
    description: 'Russian - Cyrillic characters, smaller market'
  },

  ar: {
    language: 'Arabic',
    languageCode: 'ar',
    headlineLength: 32,  // +2 (阿拉伯字母较长)
    descriptionLength: 95,  // +5
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35,
    keywordMaxWords: 3,  // -1
    keywordMinSearchVolume: 250,  // -250
    description: 'Arabic - right-to-left, smaller market'
  },

  sv: {
    language: 'Swedish',
    languageCode: 'sv',
    headlineLength: 32,  // +2
    descriptionLength: 95,  // +5
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35,
    keywordMaxWords: 3,  // -1
    keywordMinSearchVolume: 300,  // -200
    description: 'Swedish - compound words, smaller market'
  },

  'de-ch': {
    language: 'Swiss German',
    languageCode: 'de-ch',
    headlineLength: 35,  // +5
    descriptionLength: 100,  // +10
    calloutLength: 25,
    sitelinkTextLength: 25,
    sitelinkDescLength: 35,
    keywordMaxWords: 3,  // -1
    keywordMinSearchVolume: 350,  // -150
    description: 'Swiss German - similar to German, smaller market'
  }
}

/**
 * 获取语言约束
 */
export function getLanguageConstraints(language: string): LanguageConstraints {
  const normalized = normalizeLanguageCode(language)
  return LANGUAGE_CONSTRAINTS[normalized] || LANGUAGE_CONSTRAINTS['en']
}

/**
 * 规范化语言代码
 */
export function normalizeLanguageCode(language: string): string {
  const lower = language.toLowerCase().trim()

  // 处理完整语言名称
  const nameMap: Record<string, string> = {
    english: 'en',
    german: 'de',
    italian: 'it',
    spanish: 'es',
    french: 'fr',
    portuguese: 'pt',
    japanese: 'ja',
    korean: 'ko',
    chinese: 'zh',
    russian: 'ru',
    arabic: 'ar',
    swedish: 'sv',
    'swiss german': 'de-ch'
  }

  if (nameMap[lower]) {
    return nameMap[lower]
  }

  // 处理语言代码
  if (lower.length === 2 || lower.length === 5) {
    return lower
  }

  // 默认返回英文
  return 'en'
}

/**
 * 检查语言是否支持
 */
export function isSupportedLanguage(language: string): boolean {
  const lower = language.toLowerCase().trim()

  // 检查完整语言名称
  const nameMap: Record<string, string> = {
    english: 'en',
    german: 'de',
    italian: 'it',
    spanish: 'es',
    french: 'fr',
    portuguese: 'pt',
    japanese: 'ja',
    korean: 'ko',
    chinese: 'zh',
    russian: 'ru',
    arabic: 'ar',
    swedish: 'sv',
    'swiss german': 'de-ch'
  }

  if (nameMap[lower]) {
    return true
  }

  // 检查语言代码
  if ((lower.length === 2 || lower.length === 5) && lower in LANGUAGE_CONSTRAINTS) {
    return true
  }

  return false
}

/**
 * 获取所有支持的语言
 */
export function getSupportedLanguages(): LanguageConstraints[] {
  return Object.values(LANGUAGE_CONSTRAINTS)
}

/**
 * 验证标题长度（按语言）
 */
export function validateHeadlineLength(headline: string, language: string): boolean {
  const constraints = getLanguageConstraints(language)
  return headline.length <= constraints.headlineLength
}

/**
 * 验证描述长度（按语言）
 */
export function validateDescriptionLength(description: string, language: string): boolean {
  const constraints = getLanguageConstraints(language)
  return description.length <= constraints.descriptionLength
}

/**
 * 验证关键词单词数（按语言）
 */
export function validateKeywordWordCount(keyword: string, language: string): boolean {
  const constraints = getLanguageConstraints(language)
  const wordCount = keyword.split(/\s+/).filter(w => w.length > 0).length
  return wordCount >= 1 && wordCount <= constraints.keywordMaxWords
}

/**
 * 验证关键词搜索量（按语言）
 */
export function validateKeywordSearchVolume(searchVolume: number, language: string): boolean {
  const constraints = getLanguageConstraints(language)
  return searchVolume >= constraints.keywordMinSearchVolume
}

/**
 * 获取语言约束摘要
 */
export function getLanguageConstraintsSummary(language: string): string {
  const constraints = getLanguageConstraints(language)
  const lines: string[] = []

  lines.push(`=== Language Constraints: ${constraints.language} (${constraints.languageCode}) ===`)
  lines.push('')
  lines.push(constraints.description)
  lines.push('')

  lines.push('Constraints:')
  lines.push(`  Headline Length: ≤${constraints.headlineLength} characters`)
  lines.push(`  Description Length: ≤${constraints.descriptionLength} characters`)
  lines.push(`  Callout Length: ≤${constraints.calloutLength} characters`)
  lines.push(`  Sitelink Text: ≤${constraints.sitelinkTextLength} characters`)
  lines.push(`  Sitelink Description: ≤${constraints.sitelinkDescLength} characters`)
  lines.push(`  Keyword Max Words: ${constraints.keywordMaxWords}`)
  lines.push(`  Keyword Min Search Volume: ${constraints.keywordMinSearchVolume}/month`)

  return lines.join('\n')
}

/**
 * 比较两种语言的约束差异
 */
export function compareLanguageConstraints(lang1: string, lang2: string): string {
  const constraints1 = getLanguageConstraints(lang1)
  const constraints2 = getLanguageConstraints(lang2)

  const lines: string[] = []

  lines.push(`=== Language Constraints Comparison ===`)
  lines.push(`${constraints1.language} vs ${constraints2.language}`)
  lines.push('')

  lines.push('Headline Length:')
  lines.push(`  ${constraints1.language}: ${constraints1.headlineLength}`)
  lines.push(`  ${constraints2.language}: ${constraints2.headlineLength}`)
  lines.push(`  Difference: ${constraints2.headlineLength - constraints1.headlineLength > 0 ? '+' : ''}${constraints2.headlineLength - constraints1.headlineLength}`)
  lines.push('')

  lines.push('Description Length:')
  lines.push(`  ${constraints1.language}: ${constraints1.descriptionLength}`)
  lines.push(`  ${constraints2.language}: ${constraints2.descriptionLength}`)
  lines.push(`  Difference: ${constraints2.descriptionLength - constraints1.descriptionLength > 0 ? '+' : ''}${constraints2.descriptionLength - constraints1.descriptionLength}`)
  lines.push('')

  lines.push('Keyword Max Words:')
  lines.push(`  ${constraints1.language}: ${constraints1.keywordMaxWords}`)
  lines.push(`  ${constraints2.language}: ${constraints2.keywordMaxWords}`)
  lines.push(`  Difference: ${constraints2.keywordMaxWords - constraints1.keywordMaxWords > 0 ? '+' : ''}${constraints2.keywordMaxWords - constraints1.keywordMaxWords}`)
  lines.push('')

  lines.push('Keyword Min Search Volume:')
  lines.push(`  ${constraints1.language}: ${constraints1.keywordMinSearchVolume}`)
  lines.push(`  ${constraints2.language}: ${constraints2.keywordMinSearchVolume}`)
  lines.push(`  Difference: ${constraints2.keywordMinSearchVolume - constraints1.keywordMinSearchVolume > 0 ? '+' : ''}${constraints2.keywordMinSearchVolume - constraints1.keywordMinSearchVolume}`)

  return lines.join('\n')
}

/**
 * 获取语言特定的建议
 */
export function getLanguageSpecificAdvice(language: string): string[] {
  const constraints = getLanguageConstraints(language)
  const advice: string[] = []

  const normalized = normalizeLanguageCode(language)

  switch (normalized) {
    case 'de':
    case 'de-ch':
      advice.push('German uses compound words - consider allowing longer keywords')
      advice.push('Adjust headline length to 35+ characters for better expression')
      break

    case 'it':
    case 'es':
    case 'fr':
    case 'pt':
      advice.push('Romance languages tend to be more verbose - use longer character limits')
      advice.push('Consider lower search volume thresholds for smaller markets')
      break

    case 'ja':
    case 'ko':
      advice.push('CJK languages are more compact - use fewer words per keyword')
      advice.push('Character limits can be tighter due to character density')
      break

    case 'zh':
      advice.push('Chinese is very compact - 2-3 words usually sufficient for keywords')
      advice.push('Consider market size when setting search volume thresholds')
      break

    case 'ru':
    case 'ar':
      advice.push('Cyrillic/Arabic scripts may require slightly longer character limits')
      advice.push('Smaller market - adjust search volume expectations')
      break

    case 'sv':
      advice.push('Swedish has compound words - similar to German considerations')
      advice.push('Smaller market - lower search volume thresholds recommended')
      break

    default:
      advice.push('Use standard English constraints as baseline')
  }

  return advice
}
