/**
 * Semantic / low-intent query detection.
 */

// 语义查询词列表（需要过滤的关键词类型）

/**
 * 语义查询词模式（不区分大小写）
 * 这些词通常表示用户在进行信息查询，而非购买意图
 */
const SEMANTIC_QUERY_PATTERNS = [
  // 语义查询类（meaning, definition, what is...）
  'significato',
  'meaning',
  'definition',
  'what is',
  'cosa significa',
  'translate',
  'translation',
  'traduzione',

  // 媒体/娱乐类（TV series, shows...）
  'serie',
  'series',
  'tv',
  'television',
  'show',
  'episode',
  'stagione',
  'stagioni',
  'netflix',
  'streaming',

  // 历史/百科类
  'history',
  'storia',
  'wikipedia',
  'wiki',

  // 地点/地名类
  'palace',
  'hotel',
  'spa',
  'resort',
  'restaurant',
  'location',
  'where to',
  'near me',

  // 教育/教程类
  'how to',
  'tutorial',
  'guide',
  'manual',
  'instructions',

  // 价格比较类（保留price/cost用于产品搜索，但过滤compare/review）
  'compare',
  'comparison',
  'versus',
  'vs ',
  'review',
  'reviews',
  'rating',
  'ratings',
  'test',
  'testing', // test/testing=测试/评测，低转化意图

  // 低转化意图词
  'free',
  'cheap',
  'cheapest',
  'discount',
  'coupon',
  'code',
  'job',
  'jobs',
  'career',
  'salary',
  'employment',
  'hiring',

  // 下载/软件类
  'download',
  'software',
  'app',
  'apk',
  'pdf',
  'ebook',
  'digital',

  // 二手/维修类
  'used',
  'refurbished',
  'repair',
  'fix',
  'broken',
  'replacement',
  'parts',
  'spare parts',
  'manual',
  'instructions',

  // 素材/尺寸查询类（低购买意图，且容易污染广告文案）
  'gif',
  'meme',
  'emoji',
  'sticker',
  'drawing',
  'image',
  'images',
  'logo',
  'png',
  'jpg',
  'jpeg',
  'svg',
  'icon',
  'clipart',
  'wallpaper',
  'size chart',
  'size guide',
  'sizing',

  // DIY/自制类
  'diy',
  'homemade',
  'handmade',
  'build your own',
  'make your own',

  // 竞品平台
  // 主流电商平台
  'ebay',
  'amazon',
  'walmart',
  'target',
  'bestbuy',
  'best buy',
  'costco',
  'sams club',
  'sams',
  'kroger',
  'walgreens',
  // 国际电商平台
  'alibaba',
  'aliexpress',
  'wish',
  'temu',
  'shein',
  'craigslist',
  'mercari',
  'poshmark',
  'etsy',
  // 品牌官网/直销平台
  'official site',
  'official website',
  'direct',
  'manufacturer',
]

const LOW_INTENT_SUPPORT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bany\s+good\b/i, label: '评价疑问' },
  { pattern: /\bbest\s+sellers?\s+rank\b/i, label: '平台排名噪音' },
  { pattern: /\bsee\s+top\b/i, label: '平台排名噪音' },
  { pattern: /\bworth\s+it\b/i, label: '评价疑问' },
  { pattern: /\bhow\s+long\b/i, label: '支持查询' },
  { pattern: /\bcustomer\s+support\b/i, label: '支持查询' },
  { pattern: /\bphone\s+number\b/i, label: '支持查询' },
  { pattern: /\bassembly\b/i, label: '安装售后' },
  { pattern: /\bsetup\b/i, label: '安装售后' },
  { pattern: /\binstallation\b/i, label: '安装售后' },
  { pattern: /\btroubleshoot(?:ing)?\b/i, label: '支持查询' },
  { pattern: /\bfiberglass\b/i, label: '问题担忧' },
  { pattern: /\blegit\b/i, label: '可信度疑问' },
  { pattern: /\bproblem(?:s)?\b/i, label: '问题查询' },
  { pattern: /\bloading\b/i, label: '问题查询' },
  { pattern: /\bwebsite\b/i, label: '品牌导航' },
]

// 语义查询词检测

/**
 * 检测是否为语义查询词
 *
 * @param keyword - 关键词
 * @returns 是否为语义查询词
 */
export function isSemanticQuery(keyword: string): boolean {
  if (!keyword) return false

  const normalized = keyword.toLowerCase()

  // 检查是否匹配任一语义查询模式
  return SEMANTIC_QUERY_PATTERNS.some((pattern) => {
    // 完整词匹配或边界匹配
    const regex = new RegExp(`\\b${pattern}\\b`, 'i')
    return regex.test(normalized)
  })
}

/**
 * 检查关键词中是否包含需要过滤的模式
 *
 * @param keyword - 关键词
 * @returns 匹配的过滤模式（如果没有匹配返回null）
 */
export function getMatchedFilterPattern(keyword: string): string | null {
  if (!keyword) return null

  const normalized = keyword.toLowerCase()

  for (const pattern of SEMANTIC_QUERY_PATTERNS) {
    const regex = new RegExp(`\\b${pattern}\\b`, 'i')
    if (regex.test(normalized)) {
      return pattern
    }
  }

  return null
}

export function getLowIntentSupportReason(keyword: string): string | null {
  if (!keyword) return null

  for (const rule of LOW_INTENT_SUPPORT_PATTERNS) {
    if (rule.pattern.test(keyword)) {
      return `低意图支持查询词: "${keyword}" (${rule.label})`
    }
  }

  return null
}

export function filterLowIntentKeywords(keywords: string[]): string[] {
  if (!keywords || keywords.length === 0) return []

  return keywords.filter((kw) => {
    const lowerKw = kw.toLowerCase()

    // 跳过空字符串
    if (!lowerKw.trim()) return false

    // 检查是否匹配低意图模式
    for (const pattern of SEMANTIC_QUERY_PATTERNS) {
      if (lowerKw.includes(pattern.toLowerCase())) {
        return false
      }
    }

    return true
  })
}
