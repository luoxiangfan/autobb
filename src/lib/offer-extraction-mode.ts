/**
 * Offer 提取模式：快速 / 均衡 / 标准
 */

export type OfferExtractionMode = 'fast' | 'balanced' | 'original'

export const OFFER_EXTRACTION_MODES: OfferExtractionMode[] = ['fast', 'balanced', 'original']

/** 未指定或无效时的默认提取模式 */
export const OFFER_EXTRACTION_MODE_DEFAULT: OfferExtractionMode = 'original'

export const OFFER_EXTRACTION_MODE_LABELS: Record<OfferExtractionMode, string> = {
  fast: '快速',
  balanced: '均衡',
  original: '标准',
}

export const OFFER_EXTRACTION_MODE_DESCRIPTIONS: Record<OfferExtractionMode, string> = {
  fast: '优先速度，适合常规单品建站；竞品深度与部分评论补抓会延后',
  balanced: '速度与质量折中，保留竞品 ASIN 与有限竞品详情',
  original: '完整抓取与分析，耗时最长，创意与竞品对比信息最全（默认）',
}

export interface OfferExtractionModeProfile {
  /** 是否阻塞等待预热完成（原模式） */
  warmupBlocking: boolean
  /** Amazon 是否优先 canonical /dp/ URL */
  preferCanonicalAmazonUrlFirst: boolean
  /** Amazon 单品 fast 抓取（更短超时、更少重试） */
  amazonFastScrape: boolean
  amazonWaitMs: number
  amazonMaxNoJsRetries: number
  amazonMaxProxyRetries: number
  /** 提取阶段跳过 HTML 内竞品 ASIN 解析 */
  skipAmazonCompetitorExtraction: boolean
  /** 独立站 axios 超时 */
  lightScrapeTimeoutMs: number
  /** 基础字段齐全时跳过 Playwright（仅快速模式） */
  skipPlaywrightWhenMinimalBaseline: boolean
  /** 使用旧版「丰富度」Playwright 回退判断（更完整） */
  useLegacyIndependentPlaywrightFallback: boolean
  /** 店铺深度抓取商品数 */
  deepScrapeTopN: number
  deepScrapeConcurrency: number
  /** AI：允许 Playwright 评论/竞品二次抓取总开关 */
  aiPlaywrightDeepScrapeEnabled: boolean
  /** AI：无 relatedAsins 时 Playwright 抓竞品列表 */
  aiPlaywrightCompetitorDeepScrape: boolean
  /** AI：批量打开竞品详情页 */
  aiCompetitorDetailScrape: boolean
  /** AI：竞品详情最多抓取个数 */
  aiCompetitorDetailLimit: number
  minTopReviewsToSkipReviewDeepScrape: number
  minReviewHighlightsToSkipReviewDeepScrape: number
  minStructuredReviewsToSkipReviewDeepScrape: number
  reviewDeepScrapeLimit: number
}

const MODE_PROFILES: Record<OfferExtractionMode, OfferExtractionModeProfile> = {
  fast: {
    warmupBlocking: false,
    preferCanonicalAmazonUrlFirst: true,
    amazonFastScrape: true,
    amazonWaitMs: 20_000,
    amazonMaxNoJsRetries: 1,
    amazonMaxProxyRetries: 1,
    skipAmazonCompetitorExtraction: true,
    lightScrapeTimeoutMs: 15_000,
    skipPlaywrightWhenMinimalBaseline: true,
    useLegacyIndependentPlaywrightFallback: false,
    deepScrapeTopN: 3,
    deepScrapeConcurrency: 3,
    aiPlaywrightDeepScrapeEnabled: true,
    aiPlaywrightCompetitorDeepScrape: false,
    aiCompetitorDetailScrape: false,
    aiCompetitorDetailLimit: 0,
    minTopReviewsToSkipReviewDeepScrape: 3,
    minReviewHighlightsToSkipReviewDeepScrape: 2,
    minStructuredReviewsToSkipReviewDeepScrape: 3,
    reviewDeepScrapeLimit: 15,
  },
  balanced: {
    warmupBlocking: false,
    preferCanonicalAmazonUrlFirst: true,
    amazonFastScrape: true,
    amazonWaitMs: 25_000,
    amazonMaxNoJsRetries: 1,
    amazonMaxProxyRetries: 1,
    skipAmazonCompetitorExtraction: false,
    lightScrapeTimeoutMs: 20_000,
    skipPlaywrightWhenMinimalBaseline: false,
    useLegacyIndependentPlaywrightFallback: true,
    deepScrapeTopN: 4,
    deepScrapeConcurrency: 3,
    aiPlaywrightDeepScrapeEnabled: true,
    aiPlaywrightCompetitorDeepScrape: false,
    aiCompetitorDetailScrape: true,
    aiCompetitorDetailLimit: 3,
    minTopReviewsToSkipReviewDeepScrape: 5,
    minReviewHighlightsToSkipReviewDeepScrape: 3,
    minStructuredReviewsToSkipReviewDeepScrape: 5,
    reviewDeepScrapeLimit: 20,
  },
  original: {
    warmupBlocking: true,
    preferCanonicalAmazonUrlFirst: false,
    amazonFastScrape: false,
    amazonWaitMs: 30_000,
    amazonMaxNoJsRetries: 2,
    amazonMaxProxyRetries: 2,
    skipAmazonCompetitorExtraction: false,
    lightScrapeTimeoutMs: 30_000,
    skipPlaywrightWhenMinimalBaseline: false,
    useLegacyIndependentPlaywrightFallback: true,
    deepScrapeTopN: 5,
    deepScrapeConcurrency: 3,
    aiPlaywrightDeepScrapeEnabled: true,
    aiPlaywrightCompetitorDeepScrape: true,
    aiCompetitorDetailScrape: true,
    aiCompetitorDetailLimit: 5,
    minTopReviewsToSkipReviewDeepScrape: 3,
    minReviewHighlightsToSkipReviewDeepScrape: 2,
    minStructuredReviewsToSkipReviewDeepScrape: 3,
    reviewDeepScrapeLimit: 30,
  },
}

const MODE_ALIASES: Record<string, OfferExtractionMode> = {
  fast: 'fast',
  quick: 'fast',
  快速: 'fast',
  balanced: 'balanced',
  balance: 'balanced',
  均衡: 'balanced',
  original: 'original',
  full: 'original',
  legacy: 'original',
  原模式: 'original',
  标准: 'original',
  完整提取: 'original',
  完整: 'original',
  原始: 'original',
}

export function getDefaultOfferExtractionMode(): OfferExtractionMode {
  const raw = (process.env.OFFER_EXTRACTION_MODE_DEFAULT || OFFER_EXTRACTION_MODE_DEFAULT)
    .trim()
    .toLowerCase()
  return (
    MODE_ALIASES[raw] ||
    MODE_ALIASES[process.env.OFFER_EXTRACTION_MODE_DEFAULT || ''] ||
    OFFER_EXTRACTION_MODE_DEFAULT
  )
}

export function normalizeOfferExtractionMode(value: unknown): OfferExtractionMode {
  if (typeof value !== 'string') {
    return getDefaultOfferExtractionMode()
  }
  const key = value.trim().toLowerCase()
  return MODE_ALIASES[key] || getDefaultOfferExtractionMode()
}

/** 展示用标签（未知值回退为默认模式） */
export function getOfferExtractionModeLabel(mode: unknown): string {
  return OFFER_EXTRACTION_MODE_LABELS[normalizeOfferExtractionMode(mode)]
}

/** 将用户输入解析为已知模式；未知值返回 null */
export function resolveExtractionModeInput(raw: unknown): OfferExtractionMode | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const key = raw.trim().toLowerCase()
  return MODE_ALIASES[key] ?? null
}

export type ExtractionModeFromBodyResult =
  | { provided: false }
  | { provided: true; mode: OfferExtractionMode }
  | { provided: true; invalid: true }

/** 从 API 请求体解析提取模式；非法值返回 invalid */
export function getExtractionModeFromRequestBody(body: unknown): ExtractionModeFromBodyResult {
  if (!body || typeof body !== 'object') return { provided: false }
  const record = body as Record<string, unknown>
  const raw = record.extraction_mode ?? record.extractionMode
  if (raw == null || raw === '') return { provided: false }
  const mode = resolveExtractionModeInput(String(raw))
  if (!mode) return { provided: true, invalid: true }
  return { provided: true, mode }
}

/** 从 API 请求体解析提取模式（省略时 undefined；非法值视为未提供，请用 getExtractionModeFromRequestBody） */
export function parseExtractionModeFromRequestBody(body: unknown): OfferExtractionMode | undefined {
  const parsed = getExtractionModeFromRequestBody(body)
  if ('mode' in parsed && parsed.mode) return parsed.mode
  return undefined
}

export function getOfferExtractionModeProfile(
  mode?: OfferExtractionMode | string | null
): OfferExtractionModeProfile {
  const normalized =
    typeof mode === 'string'
      ? normalizeOfferExtractionMode(mode)
      : mode || getDefaultOfferExtractionMode()
  return MODE_PROFILES[normalized]
}
