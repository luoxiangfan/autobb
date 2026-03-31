/**
 * Launch Score 问题和建议的中英文翻译映射
 *
 * 用途：将AI生成的英文问题和建议翻译为中文，在前端显示
 */

/**
 * 主要问题 (Critical Issues) 翻译映射
 */
export const ISSUE_TRANSLATIONS: Record<string, string> = {
  // === 投放可行性问题 (Launch Viability) ===
  "Critical data missing: Break-even CPC is not calculated, making profit viability unknown.":
    "关键数据缺失：未计算盈亏平衡CPC，无法评估盈利能力",

  "Critical data missing: Break-even CPC is not calculated":
    "关键数据缺失：未计算盈亏平衡CPC",

  "Brand Search Volume is listed as 0, which is highly unlikely for an established brand and prevents accurate market potential assessment.":
    "品牌搜索量显示为0，对于成熟品牌来说极不合理，无法准确评估市场潜力",

  "Brand Search Volume is listed as 0":
    "品牌搜索量为0",

  "Brand search volume is extremely low (0)":
    "品牌搜索量极低（0）",

  "Brand has very low search volume":
    "品牌搜索量很低",

  "Low brand awareness in the market":
    "市场品牌认知度低",

  "Profit margin appears tight":
    "利润空间紧张",

  "High competition level":
    "竞争程度高",

  "Product price not specified":
    "产品价格未指定",

  "Commission rate not specified":
    "佣金比例未指定",

  // === 广告质量问题 (Ad Quality) ===
  "Ad Strength is below GOOD level":
    "广告强度低于良好水平",

  "Headline diversity is low":
    "标题多样性低",

  "Headlines lack variety":
    "标题缺乏多样性",

  "Description quality could be improved":
    "描述质量需要改进",

  "Insufficient number of headlines (minimum 10 required)":
    "标题数量不足（最少需要10个）",

  "Insufficient number of descriptions (minimum 4 required)":
    "描述数量不足（最少需要4个）",

  "Weak call-to-action in descriptions":
    "描述中的行动号召较弱",

  // === 关键词策略问题 (Keyword Strategy) ===
  "Match type distribution is not specified, preventing a full strategy evaluation.":
    "未指定匹配类型分布，无法全面评估关键词策略",

  "Match type distribution is not specified":
    "未指定匹配类型分布",

  "Keyword match type distribution not specified":
    "关键词匹配类型分布未指定",

  "Keyword search volume data is missing ('暂无关键词搜索量数据'), which is a critical flaw.":
    "关键词搜索量数据缺失，这是一个严重缺陷",

  "No negative keywords provided (Critical Issue!)":
    "未提供否定关键词（严重问题！）",

  "Insufficient negative keywords":
    "否定关键词不足",

  "Negative keywords count is 0":
    "否定关键词数量为0",

  "Low keyword count":
    "关键词数量过少",

  "Only using broad match keywords":
    "仅使用广泛匹配关键词",

  "Keyword relevance to product is low":
    "关键词与产品相关性低",

  // === 基础配置问题 (Basic Config) ===
  "Daily budget might be too low for competitive keywords":
    "日预算可能不足以应对竞争激烈的关键词",

  "Budget is too low":
    "预算过低",

  "Budget may not be sufficient":
    "预算可能不足",

  "Final URL not properly configured":
    "最终网址配置不当",

  "Landing page URL missing":
    "着陆页网址缺失",

  "Country/language mismatch detected":
    "检测到国家/语言不匹配",

  "Max CPC is set too low":
    "最高CPC设置过低",

  // === 综合问题 ===
  "Missing critical data points":
    "缺失关键数据点",

  "Incomplete campaign configuration":
    "广告系列配置不完整",

  "Sending paid traffic to an Amazon page is suboptimal as it limits tracking (e.g., remarketing pixels), optimization, and brand experience control.":
    "将付费流量发送到Amazon页面不是最优选择，因为这会限制追踪（如再营销像素）、优化和品牌体验控制",
}

/**
 * 改进建议 (Improvement Suggestions) 翻译映射
 */
export const SUGGESTION_TRANSLATIONS: Record<string, string> = {
  // === 投放可行性建议 ===
  "Must calculate Profit per Sale and Break-even CPC before launch to ensure the Max CPC of $0.17 is viable.":
    "发布前必须计算每单利润和盈亏平衡CPC，以确保最高CPC $0.17是可行的",

  "Must calculate profit per sale before launch":
    "发布前必须计算每单利润",

  "Calculate break-even CPC before launching":
    "启动前计算盈亏平衡CPC",

  "Verify brand search volume data":
    "验证品牌搜索量数据",

  "Consider building brand awareness through other channels first":
    "考虑先通过其他渠道建立品牌知名度",

  "Increase product price or commission rate":
    "提高产品价格或佣金比例",

  "Focus on long-tail keywords with lower competition":
    "专注于竞争较低的长尾关键词",

  "Start with lower bids to test market response":
    "从较低出价开始测试市场反应",

  // === 广告质量建议 ===
  "Add more unique headline variations":
    "添加更多独特的标题变体",

  "Improve headline diversity to at least 80%":
    "将标题多样性提高到至少80%",

  "Create at least 10 unique headlines":
    "创建至少10个独特的标题",

  "Add strong call-to-action phrases":
    "添加强有力的行动号召语句",

  "Include more selling points in descriptions":
    "在描述中包含更多卖点",

  "Optimize ad copy for higher Ad Strength rating":
    "优化广告文案以获得更高的广告强度评级",

  "Add at least 4 descriptions with clear CTAs":
    "添加至少4个带有明确CTA的描述",

  "Use dynamic keyword insertion where appropriate":
    "在适当的地方使用动态关键词插入",

  // === 关键词策略建议 ===
  "Add negative keywords like 'free', 'download', 'repair', 'DIY', 'used', 'refurbished'":
    "添加否定关键词，如'免费'、'下载'、'维修'、'DIY'、'二手'、'翻新'",

  "Add comprehensive negative keywords list (target 20+ terms)":
    "添加全面的否定关键词列表（目标20+个词）",

  "Include negative keywords":
    "包含否定关键词",

  "Balance match types: use exact, phrase, and broad match":
    "平衡匹配类型：使用精确、词组和广泛匹配",

  "Add more exact match keywords for brand terms":
    "为品牌词添加更多精确匹配关键词",

  "Diversify match type distribution":
    "多样化匹配类型分布",

  "Increase keyword count to at least 30":
    "将关键词数量增加到至少30个",

  "Focus on high-intent keywords":
    "专注于高意图关键词",

  "Remove irrelevant or low-performing keywords":
    "删除不相关或表现不佳的关键词",

  // === 基础配置建议 ===
  "Consider increasing daily budget to $20 for better performance":
    "考虑将日预算增加到$20以获得更好的性能",

  "Increase budget to at least $20/day":
    "将预算增加到至少$20/天",

  "Raise daily budget for competitive markets":
    "为竞争市场提高日预算",

  "Ensure final URL is properly configured":
    "确保最终网址配置正确",

  "Add tracking parameters to final URL":
    "在最终网址中添加追踪参数",

  "Verify country and language settings match target audience":
    "验证国家和语言设置与目标受众匹配",

  "Increase Max CPC to at least break-even level":
    "将最高CPC提高到至少盈亏平衡水平",

  "Test higher CPC bids to improve ad position":
    "测试更高的CPC出价以改善广告位置",

  // === 综合建议 ===
  "Review and complete all required data fields":
    "审查并完成所有必填数据字段",

  "Conduct thorough market research before launch":
    "启动前进行全面的市场研究",

  "Set up conversion tracking":
    "设置转化追踪",

  "Create A/B testing plan":
    "创建A/B测试计划",

  "Monitor performance daily in the first week":
    "第一周每天监控性能",

  "Optimize based on performance data":
    "根据性能数据优化",
}

/**
 * 翻译问题文本
 * @param issue 英文问题文本
 * @returns 中文翻译，如果没有找到映射则返回原文
 */
export function translateIssue(issue: string): string {
  // 精确匹配
  if (ISSUE_TRANSLATIONS[issue]) {
    return ISSUE_TRANSLATIONS[issue]
  }

  // 模糊匹配（处理部分匹配的情况）
  for (const [englishText, chineseText] of Object.entries(ISSUE_TRANSLATIONS)) {
    if (issue.includes(englishText) || englishText.includes(issue)) {
      return chineseText
    }
  }

  // 如果找不到翻译，返回原文
  return issue
}

/**
 * 翻译建议文本
 * @param suggestion 英文建议文本
 * @returns 中文翻译，如果没有找到映射则返回原文
 */
export function translateSuggestion(suggestion: string): string {
  // 精确匹配
  if (SUGGESTION_TRANSLATIONS[suggestion]) {
    return SUGGESTION_TRANSLATIONS[suggestion]
  }

  // 模糊匹配
  for (const [englishText, chineseText] of Object.entries(SUGGESTION_TRANSLATIONS)) {
    if (suggestion.includes(englishText) || englishText.includes(suggestion)) {
      return chineseText
    }
  }

  // 如果找不到翻译，返回原文
  return suggestion
}

/**
 * 批量翻译问题列表
 * @param issues 英文问题列表
 * @returns 中文翻译列表
 */
export function translateIssues(issues: string[]): string[] {
  return issues.map(translateIssue)
}

/**
 * 批量翻译建议列表
 * @param suggestions 英文建议列表
 * @returns 中文翻译列表
 */
export function translateSuggestions(suggestions: string[]): string[] {
  return suggestions.map(translateSuggestion)
}

/**
 * 检查文本是否已经是中文
 * @param text 待检查的文本
 * @returns 是否是中文
 */
export function isChinese(text: string): boolean {
  // 检测文本中中文字符的比例
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g)
  if (!chineseChars) return false

  // 如果中文字符占比超过30%，认为是中文文本
  return chineseChars.length / text.length > 0.3
}

/**
 * 智能翻译（自动检测语言）
 * @param text 待翻译文本
 * @param type 文本类型（'issue' | 'suggestion'）
 * @returns 翻译后的文本
 */
export function smartTranslate(text: string, type: 'issue' | 'suggestion'): string {
  // 如果已经是中文，直接返回
  if (isChinese(text)) {
    return text
  }

  // 否则进行翻译
  return type === 'issue' ? translateIssue(text) : translateSuggestion(text)
}
