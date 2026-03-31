/**
 * 关键词系统常量统一管理
 * 遵循KISS原则：单一职责，避免重复，清晰命名
 */

/**
 * 销售平台和智能家居生态系统白名单（不应被当作竞品过滤）
 *
 * 包含两类：
 * 1. 销售平台：表示销售渠道的购买词（如 "argus 3 pro amazon"）
 * 2. 智能家居平台：表示兼容性/集成特性的功能词（如 "eufycam homekit"）
 * 3. 大型科技公司平台：表示兼容性或集成特性（如 "works with google", "apple certified"）
 *
 * 这些词不是竞品，而是产品特性或销售渠道，应该保留
 */
export const PLATFORMS = [
  // 销售平台
  'amazon', 'ebay', 'walmart', 'target', 'bestbuy', 'homedepot', 'lowes',
  'aliexpress', 'alibaba', 'etsy', 'newegg', 'costco', 'samsclub',
  // 智能家居生态系统平台（功能特性，非竞品）
  'alexa', 'google home', 'google assistant', 'homekit', 'apple homekit',
  'smartthings', 'ifttt', 'home assistant',
  // 大型科技公司（通常表示兼容性/集成）
  'google', 'apple', 'microsoft', 'amazon'
] as const

/**
 * 已知竞品品牌列表（用于竞品词过滤）
 *
 * 注意事项：
 * - 销售平台（如amazon）已从此列表移除 → 移至PLATFORMS白名单
 * - 智能家居平台（如homekit、alexa）已从此列表移除 → 移至PLATFORMS白名单
 * - 只保留真正的竞品品牌（提供类似产品的其他厂商）
 */
export const BRAND_PATTERNS = [
  // 安防/摄像头竞品品牌
  'ring', 'arlo', 'nest', 'wyze', 'blink', 'eufy', 'lorex', 'swann', 'hikvision', 'dahua',
  'adt', 'simplisafe', 'vivint', 'frontpoint', 'abode', 'cove', 'scout',
  // 电商平台相关
  'shopify', 'woocommerce', 'bigcommerce', 'magento',
  // 通用科技品牌（可能有竞品）
  'samsung', 'philips', 'hue', 'lutron', 'ecobee', 'tplink', 'kasa', 'nanoleaf', 'meross',
  // 其他智能家居品牌
  'xiaomi', 'mijia', 'tuya', 'smart life'
] as const

/**
 * 默认配置常量
 */
export const DEFAULTS = {
  /** 默认最小搜索量阈值 */
  minSearchVolume: 500,  // 🔥 2025-12-17: 从100提高到500，只保留高价值关键词

  /** 默认最大关键词数量 */
  maxKeywords: 5000,

  /** 智能过滤的最小期望关键词数 */
  minKeywordsTarget: 15,

  /** 智能过滤的最大尝试次数 */
  maxFilterAttempts: 4,

  /** Redis缓存TTL（天） */
  cacheTtlDays: 7
} as const

/**
 * 智能过滤阈值级别
 * 用于自适应调整搜索量门槛，保留更多有价值的关键词
 */
export const THRESHOLD_LEVELS = [500, 100, 10, 1] as const

/**
 * 关键词意图分类（用于桶分类）
 */
export const INTENT_BUCKETS = {
  BRAND: 'A',      // 品牌相关
  SCENARIO: 'B',   // 使用场景
  FEATURE: 'C'     // 功能特性
} as const

/**
 * 匹配类型
 */
export const MATCH_TYPES = {
  EXACT: 'exact',
  PHRASE: 'phrase',
  BROAD: 'broad'
} as const

/**
 * 关键词来源类型
 */
export const SOURCES = {
  SCRAPED: 'SCRAPED',
  EXPANDED: 'EXPANDED',
  AI_GENERATED: 'AI_GENERATED',
  SEED: 'SEED',
  TRENDS: 'TRENDS',      // 🔥 2025-12-24: Google Trends 来源
  POPULAR: 'POPULAR'     // 🔥 2025-12-24: 热门品类词来源
} as const

// ============================================
// 🔥 2025-12-24: Google Trends 相关常量（避免硬编码）
// ============================================

/**
 * Google Trends 品类关键词映射
 * 用于从种子词生成相关查询变体
 */
export const TRENDS_CATEGORY_KEYWORDS: Record<string, string[]> = {
  'robot vacuum': [
    'robot vacuum', 'robot vacuum cleaner', 'robo vacuum',
    'vacuum robot', 'automatic vacuum', 'smart vacuum',
    'floor cleaning robot', 'home cleaning robot', 'pet hair vacuum'
  ],
  'doorbell': [
    'video doorbell', 'smart doorbell', 'doorbell camera',
    'wireless doorbell', 'front door camera', 'entry camera'
  ],
  'security camera': [
    'security camera', 'outdoor camera', 'indoor camera',
    'wireless camera', 'ip camera', 'cctv camera', 'home security'
  ],
  'speaker': [
    'smart speaker', 'voice assistant', 'bluetooth speaker',
    'wireless speaker', 'portable speaker', 'home audio'
  ],
  'smart home': [
    'smart home', 'home automation', 'iot device', 'smart device'
  ]
}

/**
 * 关键词修饰词列表（用于生成变体）
 */
export const KEYWORD_MODIFIERS = {
  /** 购买意图修饰词 */
  buy: ['buy', 'purchase', 'shop', 'get', 'order'],
  /** 评价修饰词 */
  review: ['review', 'reviews', 'rating', 'testimonial'],
  /** 型号修饰词 */
  model: ['pro', 'plus', 'max', 'ultra', 'lite', 'air', 's'],
  /** 时间修饰词 */
  time: ['2024', '2025', 'new', 'latest', 'best'],
  /** 特性修饰词 */
  feature: ['wireless', 'smart', 'automatic', 'intelligent']
}

/**
 * 已知的扫地机器人竞品列表（用于生成比较词）
 */
export const VACUUM_COMPETITORS = ['roomba', 'neato', 'iRobot', 'dyson', 'shark'] as const

/**
 * 品类通配词映射
 * 用于补充热门品类词
 */
export const CATEGORY_WILDCARDS: Record<string, string[]> = {
  'vacuum': [
    `${'{brand}'} vacuum`,
    `${'{brand}'} robot vacuum`,
    `${'{brand}'} floor cleaner`,
    'robot vacuum cleaner',
    'automatic vacuum',
    'smart vacuum',
    'cordless vacuum',
    'pet hair vacuum'
  ],
  'cleaner': [
    `${'{brand}'} floor cleaner`,
    `${'{brand}'} mop`,
    'hard floor cleaner',
    'tile floor cleaner',
    'wood floor cleaner'
  ],
  'robot': [
    `${'{brand}'} robot`,
    'home robot',
    'cleaning robot',
    'autonomous robot'
  ],
  'security': [
    `${'{brand}'} security`,
    'home security camera',
    'outdoor security camera',
    'wireless security camera'
  ],
  'camera': [
    `${'{brand}'} camera`,
    `${'{brand}'} outdoor camera`,
    'security camera',
    'indoor camera'
  ],
  'doorbell': [
    `${'{brand}'} doorbell`,
    'video doorbell',
    'smart doorbell',
    'wireless doorbell'
  ]
}

/**
 * 热门搜索词映射
 * 按品类提供热门搜索建议
 */
export const POPULAR_SEARCH_TERMS: Record<string, string[]> = {
  'vacuum': [
    'robot vacuum',
    'cordless vacuum',
    'stick vacuum',
    'upright vacuum',
    'canister vacuum',
    'handheld vacuum',
    'pet hair vacuum',
    'robot mop',
    'vacuum and mop combo'
  ],
  'cleaner': [
    'floor cleaner',
    'steam mop',
    'cordless mop',
    'robot mop',
    'hard floor cleaner'
  ],
  'security': [
    'home security',
    'security camera',
    'doorbell camera',
    'outdoor camera',
    'wireless camera',
    'cctv system'
  ],
  'camera': [
    'security camera',
    'outdoor camera',
    'indoor camera',
    'wireless camera',
    '4k camera'
  ]
}

/**
 * Google Trends 配置
 */
export const TRENDS_CONFIG = {
  /** 种子词数量限制（避免过多变体） */
  maxSeedKeywords: 10,
  /** 每个种子词生成的最大变体数 */
  maxVariationsPerSeed: 15,
  /** 最大热门品类词数量 */
  maxPopularTerms: 10,
  /** 后备查询最大数量 */
  maxFallbackQueries: 20
} as const

// ============================================
// 🔥 2025-12-25: 品类同义词词库（用于品类白名单过滤）
// ============================================

/**
 * 品类同义词词库
 * 用于品类白名单过滤，支持单品关键词聚焦
 *
 * 优化目标：对于单品链接Offer，只保留包含该产品品类词的关键词
 * 例如：Eufy Argus 3 Pro（安防摄像头）只保留包含 camera/security/outdoor 等品类词的关键词
 *       排除同品牌其他品类词（如 doorbell、vacuum、breast pump）
 */
export const CATEGORY_SYNONYMS: Record<string, string[]> = {
  // ==================== 摄像头类 ====================
  'camera': ['cam', 'video', 'surveillance', 'monitoring', 'vision', 'webcam', 'recorder', 'cctv'],
  'security': ['safety', 'protection', 'guard', 'alarm', 'secure', 'watch'],
  'outdoor': ['weather', 'waterproof', 'exterior', 'outside', 'resistant'],
  'indoor': ['interior', 'inside', 'room', 'home'],
  'doorbell': ['door', 'bell', 'chime', 'ring', 'entry', 'entrance'],

  // ==================== 吸尘器类 ====================
  'vacuum': ['cleaner', 'cleaning', 'sweeper', 'mop', 'robot', 'hoover'],
  'robot': ['robotic', 'automatic', 'auto', 'smart'],
  'floor': ['ground', 'carpet', 'hardwood', 'tile'],

  // ==================== 智能家居类 ====================
  'smart home': ['iot', 'smart', 'connected', 'automation', 'intelligent'],
  'lock': ['keyless', 'deadbolt', 'entry', 'door lock', 'secure'],
  'light': ['lighting', 'lamp', 'bulb', 'led', 'brightness'],
  'switch': ['dimmer', 'control', 'button', 'toggle'],
  'sensor': ['detector', 'detection', 'monitor', 'sense'],

  // ==================== 音频设备类 ====================
  'speaker': ['audio', 'sound', 'music', 'bluetooth', 'wireless'],
  'headphones': ['earphones', 'earbuds', 'headset', 'ear', 'buds'],
  'microphone': ['mic', 'recording', 'voice', 'audio input'],

  // ==================== 智能可穿戴类 ====================
  'watch': ['smartwatch', 'wearable', 'fitness', 'tracker'],
  'band': ['bracelet', 'wristband', 'strap', 'fitness band'],
  'ring': ['smart ring', 'wearable ring', 'finger'],

  // ==================== 母婴类 ====================
  'breast pump': ['pump', 'breastfeeding', 'nursing', 'lactation', 'expressing'],
  'baby monitor': ['baby cam', 'nursery', 'infant', 'child'],
  'thermometer': ['temperature', 'fever', 'digital'],

  // ==================== 厨房电器类 ====================
  'coffee': ['espresso', 'brew', 'maker', 'grinder', 'café'],
  'kettle': ['boiler', 'water heater', 'pot'],
  'blender': ['mixer', 'juicer', 'smoothie', 'processor'],

  // ==================== 个人护理类 ====================
  'toothbrush': ['dental', 'oral', 'teeth', 'brush'],
  'shaver': ['razor', 'trimmer', 'grooming', 'beard'],
  'hair dryer': ['blow dryer', 'styling', 'hair'],

  // ==================== 健康设备类 ====================
  'scale': ['weighing', 'weight', 'body', 'fat', 'bmi'],
  'blood pressure': ['bp', 'monitor', 'sphygmomanometer', 'heart'],
  'oximeter': ['oxygen', 'pulse', 'spo2', 'saturation'],

  // ==================== 通用修饰词 ====================
  'wireless': ['wifi', 'bluetooth', 'cordless', 'cable-free'],
  'portable': ['handheld', 'mobile', 'travel', 'compact'],
  'rechargeable': ['battery', 'charging', 'powered', 'cordless'],
  'waterproof': ['water resistant', 'splash proof', 'ip67', 'ip68'],
} as const

/**
 * 类型导出（用于TypeScript）
 */
export type Platform = typeof PLATFORMS[number]
export type BrandPattern = typeof BRAND_PATTERNS[number]
export type ThresholdLevel = typeof THRESHOLD_LEVELS[number]
export type IntentBucket = typeof INTENT_BUCKETS[keyof typeof INTENT_BUCKETS]
export type MatchType = typeof MATCH_TYPES[keyof typeof MATCH_TYPES]
export type Source = typeof SOURCES[keyof typeof SOURCES]
export type CategorySynonym = keyof typeof CATEGORY_SYNONYMS
