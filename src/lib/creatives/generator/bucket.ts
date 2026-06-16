import {
  getBucketInfo,
  type OfferKeywordPool,
  type PoolKeywordData,
} from '../../keywords/offer-pool' // 🔥 AI语义分类
// 🎯 新增：导入否定关键词生成函数
// 🎯 新增：导入token追踪函数
// 🎯 v3.0: 导入数据库prompt加载函数
// 🎯 购买意图评分

// 🔥 优化：Google Ads关键词标准化去重

// 🔥 2025-12-28: 导入关键词质量过滤函数 🔥 2026-01-02: 补充导入纯品牌词函数 🔥 2026-01-05: 改为 shouldUseExactMatch 策略函数 🔥 2026-03-13: 补充导入品牌变体和语义查询过滤函数
// 🔥 2026-03-13: 导入纯品牌词判断函数

import { normalizeKeywordPoolBucketQuery } from '../server'
import type { BucketType, NormalizedCreativeBucket } from './types'
import { decodeUriComponentSafe, safeParseJson } from './utils'

export function normalizeCreativeBucketType(bucket?: string | null): NormalizedCreativeBucket {
  return normalizeKeywordPoolBucketQuery(bucket)
}

export function resolveCreativeBucketPoolKeywords(
  pool: OfferKeywordPool,
  bucket?: string | null,
  fallbackBucket: Exclude<NormalizedCreativeBucket, null> = 'A'
): PoolKeywordData[] {
  const normalizedBucket = normalizeCreativeBucketType(bucket) ?? fallbackBucket
  return getBucketInfo(pool, normalizedBucket).keywords
}

export function getStoreProductNameCandidate(product: any): string {
  const candidates = [
    product?.productData?.productName,
    product?.productData?.name,
    product?.productName,
    product?.name,
    product?.title,
  ]

  for (const candidate of candidates) {
    const normalized = String(candidate || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (normalized.length >= 3) {
      return normalized
    }
  }

  return ''
}

export function collectStoreProductEvidenceTexts(product: any): string[] {
  const output: string[] = []
  const seen = new Set<string>()

  const push = (value: unknown) => {
    const normalized = String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (normalized.length < 3) return
    const key = normalized.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    output.push(normalized)
  }

  const appendRecord = (value: unknown, limit = 6) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    for (const [key, raw] of Object.entries(value).slice(0, limit)) {
      if (typeof raw !== 'string' && typeof raw !== 'number') continue
      push(`${key} ${raw}`)
    }
  }

  const appendVariantList = (value: unknown, limit = 6) => {
    if (!Array.isArray(value)) return
    for (const item of value.slice(0, limit)) {
      if (!item || typeof item !== 'object') continue
      push((item as any).name)
      push((item as any).title)
      push((item as any).label)
      push((item as any).model)
      push((item as any).sku)
      push((item as any).value)
      push((item as any).option)
      push((item as any).variant)
    }
  }

  push(getStoreProductNameCandidate(product))
  push(product?.productData?.model)
  push(product?.model)
  push(product?.productData?.sku)
  push(product?.sku)
  push(product?.url)
  push(product?.link)
  push(product?.href)

  for (const value of [
    product?.productData?.aboutThisItem,
    product?.productData?.features,
    product?.aboutThisItem,
    product?.features,
  ]) {
    if (!Array.isArray(value)) continue
    value.slice(0, 5).forEach((item) => push(item))
  }

  appendRecord(product?.productData?.specifications)
  appendRecord(product?.specifications)
  appendRecord(product?.productData?.attributes)
  appendRecord(product?.attributes)
  appendVariantList(product?.productData?.variants)
  appendVariantList(product?.variants)
  appendVariantList(product?.options)

  return output
}

export const STORE_PRODUCT_LINK_SEGMENT_STOPWORDS = new Set([
  'products',
  'product',
  'collections',
  'collection',
  'shop',
  'store',
  'item',
  'items',
  'dp',
  'gp',
  'p',
  'sku',
])

export function normalizeStoreProductLinkSegment(value: string): string {
  return decodeUriComponentSafe(String(value || ''))
    .replace(/\.[a-z0-9]{2,5}$/i, ' ')
    .replace(/[-_+]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function scoreStoreProductNameCandidate(value: string): number {
  const tokens = value.split(/\s+/).filter(Boolean)
  const tokenScore = Math.min(8, tokens.length)
  const modelBonus = /\d/.test(value) ? 4 : 0
  const phraseBonus = value.includes(' ') ? 1 : 0
  return tokenScore + modelBonus + phraseBonus
}

export function extractStoreProductNameCandidatesFromLink(rawLink: string): string[] {
  const normalizedLink = String(rawLink || '').trim()
  if (!normalizedLink) return []

  const candidates: string[] = []
  const seen = new Set<string>()
  const pushCandidate = (value: unknown) => {
    const normalized = normalizeStoreProductLinkSegment(String(value || ''))
    if (normalized.length < 3) return
    const compact = normalized.toLowerCase()
    if (STORE_PRODUCT_LINK_SEGMENT_STOPWORDS.has(compact)) return
    if (seen.has(compact)) return
    seen.add(compact)
    candidates.push(normalized)
  }

  const tryUrls = [normalizedLink]
  if (!/^https?:\/\//i.test(normalizedLink)) {
    tryUrls.push(`https://${normalizedLink}`)
  }
  for (const candidateUrl of tryUrls) {
    try {
      const parsed = new URL(candidateUrl)
      const pathSegments = parsed.pathname
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean)
      for (const segment of pathSegments.slice(-4)) {
        pushCandidate(segment)
      }
      for (const key of ['model', 'sku', 'product', 'item', 'title', 'name']) {
        pushCandidate(parsed.searchParams.get(key))
      }
      break
    } catch {
      continue
    }
  }

  if (candidates.length === 0) {
    const fallback = normalizedLink
      .replace(/^https?:\/\/[^/]+/i, '')
      .split(/[/?#&=]/)
      .map((part) => part.trim())
      .filter(Boolean)
    for (const part of fallback.slice(-6)) {
      pushCandidate(part)
    }
  }

  return candidates.sort(
    (a, b) => scoreStoreProductNameCandidate(b) - scoreStoreProductNameCandidate(a)
  )
}

export function buildStoreProductCandidatesFromLinks(rawStoreProductLinks: unknown): any[] {
  const parsed = safeParseJson(rawStoreProductLinks, rawStoreProductLinks)
  const rawItems = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  const candidates: any[] = []

  for (const rawItem of rawItems) {
    if (typeof rawItem === 'string') {
      const link = rawItem.trim()
      if (!link) continue
      const names = extractStoreProductNameCandidatesFromLink(link)
      candidates.push({
        name: names[0] || link,
        title: names[1],
        model: names.find((item) => /\d/.test(item)),
        link,
        url: link,
      })
      continue
    }

    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as any
    const linkCandidate =
      (typeof item.url === 'string' && item.url.trim()) ||
      (typeof item.link === 'string' && item.link.trim()) ||
      (typeof item.href === 'string' && item.href.trim()) ||
      (typeof item.productUrl === 'string' && item.productUrl.trim()) ||
      (typeof item.productLink === 'string' && item.productLink.trim()) ||
      ''
    const names = extractStoreProductNameCandidatesFromLink(linkCandidate)
    const explicitName = getStoreProductNameCandidate(item)
    const primaryName = explicitName || names[0] || ''
    if (!primaryName && !linkCandidate) continue
    candidates.push({
      ...item,
      name: primaryName || item.name || item.title,
      title: item.title || names[1],
      model: item.model || names.find((value) => /\d/.test(value)),
      link: item.link || linkCandidate,
      url: item.url || linkCandidate,
    })
  }

  return candidates
}

export function dedupeStoreProductNames(productNames: string[], limit = 3): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const productName of productNames) {
    const normalized = String(productName || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (normalized.length < 3) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(normalized)
    if (deduped.length >= limit) break
  }

  return deduped
}

export function getThemeByBucket(bucket: BucketType, linkType: 'product' | 'store'): string {
  const normalizedBucket = normalizeKeywordPoolBucketQuery(bucket)
  if (!normalizedBucket) {
    return ''
  }
  if (linkType === 'store') {
    const themes: Record<'A' | 'B' | 'D', string> = {
      A: '品牌意图导向 - 广告语和关键词必须同时关联品牌与真实商品集合',
      B: '热门商品型号/产品族意图导向 - 聚焦店铺热门商品型号/产品族，关键词统一完全匹配',
      D: '商品需求意图导向 - 聚焦品牌下商品需求、功能、场景和产品线覆盖',
    }
    return themes[normalizedBucket]
  } else {
    const themes: Record<'A' | 'B' | 'D', string> = {
      A: '品牌意图导向 - 广告语和关键词必须同时关联品牌与当前商品',
      B: '商品型号/产品族意图导向 - 聚焦当前商品型号/产品族，关键词统一完全匹配',
      D: '商品需求意图导向 - 聚焦品牌下商品需求、功能、场景和产品线覆盖',
    }
    return themes[normalizedBucket]
  }
}

/**
 * Helper functions to build dynamic guidance sections
 */
