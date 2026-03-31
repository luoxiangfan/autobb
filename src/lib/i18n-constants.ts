/**
 * i18n 国际化常量文件
 * 统一管理所有状态标签和配置参数
 * 格式规范：
 * - 状态标签：使用纯中文（如"等待抓取"）
 * - 配置参数：使用"中文(英文)"格式（仅在settings页面显示，如"最大化点击次数(Maximize Clicks)"）
 */

// ==================== 状态映射（纯中文）====================

/**
 * Offer 抓取状态
 */
export const SCRAPE_STATUS = {
  pending: '等待抓取',
  in_progress: '抓取中',
  completed: '已完成',
  failed: '失败',
} as const

/**
 * 广告系列状态 (Google Ads API)
 */
export const CAMPAIGN_STATUS = {
  ENABLED: '启用',
  PAUSED: '暂停',
  REMOVED: '已移除',
  UNKNOWN: '未知',
} as const

/**
 * 广告系列创建状态
 */
export const CREATION_STATUS = {
  draft: '草稿',
  pending: '同步中',
  synced: '已同步',
  failed: '同步失败',
} as const

/**
 * 广告强度评级 (Google Ads Ad Strength)
 */
export const AD_STRENGTH = {
  POOR: '差',
  AVERAGE: '平均',
  GOOD: '良好',
  EXCELLENT: '优秀',
  UNSPECIFIED: '未评估',
} as const

/**
 * A/B 测试状态
 */
export const AB_TEST_STATUS = {
  draft: '草稿',
  running: '运行中',
  completed: '已完成',
  cancelled: '已取消',
} as const

/**
 * 优化任务状态
 */
export const OPTIMIZATION_STATUS = {
  pending: '待执行',
  in_progress: '执行中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
} as const

/**
 * 优化类型
 */
export const OPTIMIZATION_TYPE = {
  keyword: '关键词优化',
  budget: '预算调整',
  creative: '创意优化',
  bidding: '出价策略',
} as const

/**
 * 风险等级
 */
export const RISK_SEVERITY = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
} as const

/**
 * 用户角色
 */
export const USER_ROLE = {
  admin: '管理员',
  user: '普通用户',
} as const

/**
 * 套餐类型
 */
export const PACKAGE_TYPE = {
  annual: '年卡',
  lifetime: '长期会员',
  private: '私有化部署',
  trial: '试用',
} as const

// ==================== 国家和语言映射（配置参数，保留英文）====================

/**
 * 国家代码映射 - Settings页面使用
 */
export const COUNTRIES = {
  US: '美国(US)',
  UK: '英国(UK)',
  CA: '加拿大(CA)',
  AU: '澳大利亚(AU)',
  DE: '德国(DE)',
  FR: '法国(FR)',
  ES: '西班牙(ES)',
  IT: '意大利(IT)',
  JP: '日本(JP)',
  CN: '中国(CN)',
} as const

/**
 * 语言映射 - Settings页面使用
 */
export const LANGUAGES = {
  en: '英语(en)',
  zh: '中文(zh)',
  de: '德语(de)',
  fr: '法语(fr)',
  es: '西班牙语(es)',
  it: '意大利语(it)',
  ja: '日语(ja)',
} as const

// ==================== Google Ads 配置参数（保留英文）====================

/**
 * 广告系列目标 - Settings页面使用
 */
export const CAMPAIGN_OBJECTIVE = {
  WEBSITE_TRAFFIC: '网站流量(Website traffic)',
  SALES: '销售转化(Sales)',
  LEADS: '潜在客户(Leads)',
  BRAND_AWARENESS: '品牌知名度(Brand awareness)',
} as const

/**
 * 转化目标 - Settings页面使用
 */
export const CONVERSION_GOALS = {
  PAGE_VIEWS: '页面浏览(Page views)',
  ADD_TO_CART: '加入购物车(Add to cart)',
  PURCHASE: '购买(Purchase)',
  SUBMIT_LEAD_FORM: '提交表单(Submit lead form)',
} as const

/**
 * 广告系列类型 - Settings页面使用
 */
export const CAMPAIGN_TYPE = {
  SEARCH: '搜索广告(Search)',
  DISPLAY: '展示广告(Display)',
  VIDEO: '视频广告(Video)',
  SHOPPING: '购物广告(Shopping)',
  PERFORMANCE_MAX: '效果最大化(Performance Max)',
} as const

/**
 * 出价策略 - Settings页面使用
 */
export const BIDDING_STRATEGY = {
  MAXIMIZE_CLICKS: '最大化点击次数(Maximize Clicks)',
  MAXIMIZE_CONVERSIONS: '最大化转化次数(Maximize Conversions)',
  TARGET_CPA: '目标每次转化费用(Target CPA)',
  TARGET_ROAS: '目标广告支出回报率(Target ROAS)',
  MANUAL_CPC: '手动每次点击费用(Manual CPC)',
} as const

/**
 * 预算类型 - Settings页面使用
 */
export const BUDGET_TYPE = {
  DAILY: '每日预算(DAILY)',
  TOTAL: '总预算(TOTAL)',
} as const

/**
 * 性能指标 - Settings页面使用（保持英文缩写+中文全称）
 */
export const METRICS = {
  impressions: '展示次数(Impressions)',
  clicks: '点击次数(Clicks)',
  ctr: '点击率(CTR)',
  cpc: '每次点击费用(CPC)',
  conversions: '转化次数(Conversions)',
  conversionRate: '转化率(CVR)',
  cost: '花费(Cost)',
  roas: '广告支出回报率(ROAS)',
  cpa: '每次转化费用(CPA)',
} as const

// ==================== 辅助函数 ====================

/**
 * 获取状态标签（带类型安全）
 */
export function getScrapeStatusLabel(status: keyof typeof SCRAPE_STATUS): string {
  return SCRAPE_STATUS[status] || status
}

export function getCampaignStatusLabel(status: keyof typeof CAMPAIGN_STATUS): string {
  return CAMPAIGN_STATUS[status] || status
}

export function getCreationStatusLabel(status: keyof typeof CREATION_STATUS): string {
  return CREATION_STATUS[status] || status
}

export function getAdStrengthLabel(strength: keyof typeof AD_STRENGTH): string {
  return AD_STRENGTH[strength] || strength
}

export function getCountryLabel(code: string): string {
  return COUNTRIES[code as keyof typeof COUNTRIES] || code
}

export function getLanguageLabel(code: string): string {
  return LANGUAGES[code as keyof typeof LANGUAGES] || code
}

export function getMetricLabel(metric: keyof typeof METRICS): string {
  return METRICS[metric] || metric
}

/**
 * 从"中文(英文)"格式中提取英文部分
 */
export function extractEnglish(label: string): string {
  const match = label.match(/\(([^)]+)\)/)
  return match ? match[1] : label
}

/**
 * 从"中文(英文)"格式中提取中文部分
 */
export function extractChinese(label: string): string {
  const match = label.match(/^([^(]+)/)
  return match ? match[1] : label
}

// ==================== 类型导出 ====================

export type ScrapeStatus = keyof typeof SCRAPE_STATUS
export type CampaignStatus = keyof typeof CAMPAIGN_STATUS
export type CreationStatus = keyof typeof CREATION_STATUS
export type AdStrength = keyof typeof AD_STRENGTH
export type CountryCode = keyof typeof COUNTRIES
export type LanguageCode = keyof typeof LANGUAGES
export type MetricKey = keyof typeof METRICS
