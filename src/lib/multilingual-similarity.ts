/**
 * 多语言相似度计算优化
 *
 * 支持中文、英文、日文、韩文等多种语言的相似度计算
 * 使用语言检测和特定的分词算法
 */

/**
 * 语言类型
 */
export enum Language {
  ENGLISH = 'en',
  CHINESE = 'zh',
  JAPANESE = 'ja',
  KOREAN = 'ko',
  SPANISH = 'es',
  FRENCH = 'fr',
  GERMAN = 'de',
  PORTUGUESE = 'pt',
  RUSSIAN = 'ru',
  ARABIC = 'ar',
  UNKNOWN = 'unknown'
}

/**
 * 检测文本的主要语言
 */
export function detectLanguage(text: string): Language {
  if (!text) return Language.UNKNOWN

  // 中文字符范围: \u4E00-\u9FFF
  const chineseRegex = /[\u4E00-\u9FFF]/g
  const chineseMatches = text.match(chineseRegex)
  const chineseRatio = chineseMatches ? chineseMatches.length / text.length : 0

  // 日文字符范围: \u3040-\u309F (平假名), \u30A0-\u30FF (片假名)
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF]/g
  const japaneseMatches = text.match(japaneseRegex)
  const japaneseRatio = japaneseMatches ? japaneseMatches.length / text.length : 0

  // 韩文字符范围: \uAC00-\uD7AF
  const koreanRegex = /[\uAC00-\uD7AF]/g
  const koreanMatches = text.match(koreanRegex)
  const koreanRatio = koreanMatches ? koreanMatches.length / text.length : 0

  // 阿拉伯字符范围: \u0600-\u06FF
  const arabicRegex = /[\u0600-\u06FF]/g
  const arabicMatches = text.match(arabicRegex)
  const arabicRatio = arabicMatches ? arabicMatches.length / text.length : 0

  // 俄文字符范围: \u0400-\u04FF
  const russianRegex = /[\u0400-\u04FF]/g
  const russianMatches = text.match(russianRegex)
  const russianRatio = russianMatches ? russianMatches.length / text.length : 0

  // 确定主要语言
  if (chineseRatio > 0.3) return Language.CHINESE
  if (japaneseRatio > 0.3) return Language.JAPANESE
  if (koreanRatio > 0.3) return Language.KOREAN
  if (arabicRatio > 0.3) return Language.ARABIC
  if (russianRatio > 0.3) return Language.RUSSIAN

  return Language.ENGLISH
}

/**
 * 中文分词（简单实现）
 * 使用常见的中文词汇库进行分词
 */
function tokenizeChinese(text: string): string[] {
  const tokens: string[] = []
  let i = 0

  while (i < text.length) {
    const char = text[i]

    // 检查是否是中文字符
    if (/[\u4E00-\u9FFF]/.test(char)) {
      // 尝试匹配常见的多字词汇
      let matched = false

      // 尝试 3 字词
      if (i + 3 <= text.length) {
        const threeChar = text.substring(i, i + 3)
        if (isCommonChineseWord(threeChar)) {
          tokens.push(threeChar)
          i += 3
          matched = true
        }
      }

      // 尝试 2 字词
      if (!matched && i + 2 <= text.length) {
        const twoChar = text.substring(i, i + 2)
        if (isCommonChineseWord(twoChar)) {
          tokens.push(twoChar)
          i += 2
          matched = true
        }
      }

      // 单字
      if (!matched) {
        tokens.push(char)
        i += 1
      }
    } else if (/[a-zA-Z]/.test(char)) {
      // 英文单词
      let word = ''
      while (i < text.length && /[a-zA-Z]/.test(text[i])) {
        word += text[i]
        i++
      }
      if (word) tokens.push(word.toLowerCase())
    } else if (/[0-9]/.test(char)) {
      // 数字
      let number = ''
      while (i < text.length && /[0-9]/.test(text[i])) {
        number += text[i]
        i++
      }
      if (number) tokens.push(number)
    } else {
      i++
    }
  }

  return tokens
}

/**
 * 检查是否是常见的中文词汇
 */
function isCommonChineseWord(word: string): boolean {
  const commonWords = new Set([
    '的', '一', '是', '在', '不', '了', '有', '和', '人', '这',
    '中', '大', '为', '上', '个', '国', '我', '以', '要', '他',
    '时', '来', '用', '们', '生', '到', '作', '地', '于', '出',
    '就', '分', '对', '成', '会', '可', '主', '发', '年', '动',
    '同', '工', '也', '能', '下', '过', '民', '前', '面', '书',
    '理', '化', '区', '别', '她', '方', '子', '世', '多', '第',
    '写', '样', '学', '只', '本', '日', '然', '四', '代', '美',
    '其', '后', '定', '行', '万', '正', '学', '现', '早', '而',
    '家', '资', '把', '做', '好', '看', '起', '事', '自', '己',
    '通', '过', '产', '小', '制', '年', '都', '来', '分', '生',
    '最', '高', '长', '合', '读', '结', '令', '响', '声', '笑',
    '花', '落', '水', '火', '风', '雨', '云', '天', '地', '山',
    '石', '树', '木', '草', '叶', '根', '茎', '花', '果', '种',
    '食', '肉', '鱼', '鸟', '兽', '虫', '蛇', '龙', '凤', '麒',
    '麟', '龟', '鹤', '鹿', '马', '牛', '羊', '猪', '狗', '猫',
    '鼠', '兔', '猴', '鸡', '狐', '狼', '熊', '虎', '豹', '狮',
    '象', '驼', '鹰', '鹞', '鹊', '鸦', '鸽', '鸡', '鸭', '鹅',
    '天', '地', '人', '和', '合', '同', '共', '一', '二', '三',
    '四', '五', '六', '七', '八', '九', '十', '百', '千', '万',
    '亿', '兆', '京', '垓', '秭', '穰', '沟', '涧', '正', '载',
    '极', '恒', '河', '沙', '阿', '僧', '祇', '那', '由', '他',
    '婆', '罗', '门', '刹', '那', '弹', '指', '瞬', '间', '须',
    '臾', '逡', '巡', '莫', '逆', '念', '刹', '那', '一', '瞬',
    '间', '须', '臾', '逡', '巡', '莫', '逆', '念', '刹', '那'
  ])

  return commonWords.has(word)
}

/**
 * 日文分词
 */
function tokenizeJapanese(text: string): string[] {
  const tokens: string[] = []

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    // 平假名、片假名、汉字都作为单个 token
    if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(char)) {
      tokens.push(char)
    } else if (/[a-zA-Z]/.test(char)) {
      // 英文单词
      let word = ''
      while (i < text.length && /[a-zA-Z]/.test(text[i])) {
        word += text[i]
        i++
      }
      if (word) tokens.push(word.toLowerCase())
      i-- // 回退一个字符
    } else if (/[0-9]/.test(char)) {
      // 数字
      let number = ''
      while (i < text.length && /[0-9]/.test(text[i])) {
        number += text[i]
        i++
      }
      if (number) tokens.push(number)
      i-- // 回退一个字符
    }
  }

  return tokens
}

/**
 * 韩文分词
 */
function tokenizeKorean(text: string): string[] {
  const tokens: string[] = []

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    // 韩文字符作为单个 token
    if (/[\uAC00-\uD7AF]/.test(char)) {
      tokens.push(char)
    } else if (/[a-zA-Z]/.test(char)) {
      // 英文单词
      let word = ''
      while (i < text.length && /[a-zA-Z]/.test(text[i])) {
        word += text[i]
        i++
      }
      if (word) tokens.push(word.toLowerCase())
      i-- // 回退一个字符
    } else if (/[0-9]/.test(char)) {
      // 数字
      let number = ''
      while (i < text.length && /[0-9]/.test(text[i])) {
        number += text[i]
        i++
      }
      if (number) tokens.push(number)
      i-- // 回退一个字符
    }
  }

  return tokens
}

/**
 * 英文分词
 */
function tokenizeEnglish(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 0)
}

/**
 * 通用分词函数
 */
export function tokenize(text: string, language?: Language): string[] {
  if (!text) return []

  const lang = language || detectLanguage(text)

  switch (lang) {
    case Language.CHINESE:
      return tokenizeChinese(text)
    case Language.JAPANESE:
      return tokenizeJapanese(text)
    case Language.KOREAN:
      return tokenizeKorean(text)
    case Language.ENGLISH:
    default:
      return tokenizeEnglish(text)
  }
}

/**
 * 多语言相似度计算
 * 支持混合语言文本
 */
export function calculateMultilingualSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0

  // 检测语言
  const lang1 = detectLanguage(text1)
  const lang2 = detectLanguage(text2)

  // 分词
  const tokens1 = tokenize(text1, lang1)
  const tokens2 = tokenize(text2, lang2)

  if (tokens1.length === 0 && tokens2.length === 0) return 1
  if (tokens1.length === 0 || tokens2.length === 0) return 0

  // 计算 Jaccard 相似度
  const set1 = new Set(tokens1)
  const set2 = new Set(tokens2)

  const intersection = new Set([...set1].filter(token => set2.has(token)))
  const union = new Set([...set1, ...set2])

  return union.size > 0 ? intersection.size / union.size : 0
}

/**
 * 获取语言信息
 */
export function getLanguageInfo(text: string): {
  language: Language
  languageName: string
  confidence: number
  tokens: string[]
  tokenCount: number
} {
  const language = detectLanguage(text)
  const tokens = tokenize(text, language)

  const languageNames: Record<Language, string> = {
    [Language.ENGLISH]: 'English',
    [Language.CHINESE]: 'Chinese',
    [Language.JAPANESE]: 'Japanese',
    [Language.KOREAN]: 'Korean',
    [Language.SPANISH]: 'Spanish',
    [Language.FRENCH]: 'French',
    [Language.GERMAN]: 'German',
    [Language.PORTUGUESE]: 'Portuguese',
    [Language.RUSSIAN]: 'Russian',
    [Language.ARABIC]: 'Arabic',
    [Language.UNKNOWN]: 'Unknown'
  }

  // 计算置信度（基于特定语言字符的比例）
  let confidence = 0.5 // 默认置信度

  if (language === Language.CHINESE) {
    const chineseRegex = /[\u4E00-\u9FFF]/g
    const matches = text.match(chineseRegex)
    confidence = matches ? matches.length / text.length : 0
  } else if (language === Language.JAPANESE) {
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g
    const matches = text.match(japaneseRegex)
    confidence = matches ? matches.length / text.length : 0
  } else if (language === Language.KOREAN) {
    const koreanRegex = /[\uAC00-\uD7AF]/g
    const matches = text.match(koreanRegex)
    confidence = matches ? matches.length / text.length : 0
  } else if (language === Language.ENGLISH) {
    const englishRegex = /[a-zA-Z]/g
    const matches = text.match(englishRegex)
    confidence = matches ? matches.length / text.length : 0
  }

  return {
    language,
    languageName: languageNames[language],
    confidence: Math.min(1, confidence),
    tokens,
    tokenCount: tokens.length
  }
}

/**
 * 比较两个文本的语言
 */
export function compareLanguages(text1: string, text2: string): {
  text1Language: Language
  text2Language: Language
  isSameLanguage: boolean
  isMultilingual: boolean
} {
  const lang1 = detectLanguage(text1)
  const lang2 = detectLanguage(text2)

  return {
    text1Language: lang1,
    text2Language: lang2,
    isSameLanguage: lang1 === lang2,
    isMultilingual: lang1 !== lang2 && lang1 !== Language.UNKNOWN && lang2 !== Language.UNKNOWN
  }
}
