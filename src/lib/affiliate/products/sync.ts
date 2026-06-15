import type { AffiliatePlatform, AffiliateProductSyncProgress, SyncMode } from './types'
import type { AffiliateProductSyncCheckpoint } from './sync-runs'
import type { NormalizedAffiliateProduct } from './types'
import {
  DEFAULT_PB_STREAM_WINDOW_PAGES,
  DEFAULT_YP_STREAM_WINDOW_PAGES,
  MAX_PB_STREAM_WINDOW_PAGES,
  MAX_YP_STREAM_WINDOW_PAGES,
} from './constants'
import {
  normalizeCountries,
  normalizeCountryCode,
  normalizeYeahPromosMarketplace,
  parseInteger,
  parseIntegerInRange,
  resolvePartnerboostFullSyncCountrySequence,
} from './parsing'
import { getAffiliateProductById } from './actions'
import {
  fetchPartnerboostPromotableProducts,
  fetchPartnerboostPromotableProductsWithMeta,
  fetchYeahPromosPromotableProducts,
  fetchYeahPromosPromotableProductsWithMeta,
} from './platform-fetch'
import {
  dedupeNormalizedProducts,
  fetchPartnerboostDeltaProducts,
  fetchYeahPromosDeltaProducts,
  upsertAffiliateProducts,
} from './upsert'

export async function syncPartnerboostPlatformByWindow(params: {
  userId: number
  startPage?: number
  startScope?: string
  pageWindowSize?: number
  progressEvery?: number
  onProgress?: (progress: AffiliateProductSyncProgress) => Promise<void> | void
  onCheckpoint?: (checkpoint: AffiliateProductSyncCheckpoint) => Promise<void> | void
}): Promise<{
  totalFetched: number
  createdCount: number
  updatedCount: number
  hasMore: boolean
  nextCursorPage: number
  nextCursorScope: string | null
}> {
  const pageWindowSize = parseIntegerInRange(
    params.pageWindowSize ?? DEFAULT_PB_STREAM_WINDOW_PAGES,
    DEFAULT_PB_STREAM_WINDOW_PAGES,
    1,
    MAX_PB_STREAM_WINDOW_PAGES
  )

  const countrySequence = resolvePartnerboostFullSyncCountrySequence()
  const normalizedStartScope = normalizeCountryCode(String(params.startScope || ''))
  let scopeIndex = normalizedStartScope ? countrySequence.indexOf(normalizedStartScope) : 0
  if (scopeIndex < 0) {
    scopeIndex = 0
  }

  let cursorPage = Math.max(1, parseInteger(params.startPage, 1))
  let cursorScope: string | null = countrySequence[scopeIndex] || null
  let totalFetched = 0
  let createdCount = 0
  let updatedCount = 0
  const failedCount = 0
  let processedBatches = 0
  const seenMidAllowedCountries = new Map<string, Set<string>>()

  const emitProgress = async (nextFetched: number): Promise<void> => {
    if (!params.onProgress) return
    try {
      await params.onProgress({
        totalFetched: Math.max(0, nextFetched),
        processedCount: createdCount + updatedCount + failedCount,
        createdCount,
        updatedCount,
        failedCount,
      })
    } catch (error: any) {
      console.warn(
        '[affiliate-products] PB stream onProgress callback failed:',
        error?.message || error
      )
    }
  }

  const emitCheckpoint = async (): Promise<void> => {
    if (!params.onCheckpoint) return
    try {
      await params.onCheckpoint({
        cursorPage,
        cursorScope,
        processedBatches,
        totalFetched,
        createdCount,
        updatedCount,
        failedCount,
      })
    } catch (error: any) {
      console.warn(
        '[affiliate-products] PB stream onCheckpoint callback failed:',
        error?.message || error
      )
    }
  }

  await emitProgress(0)
  await emitCheckpoint()

  if (scopeIndex >= countrySequence.length) {
    cursorPage = 0
    cursorScope = null
    await emitProgress(totalFetched)
    await emitCheckpoint()
    return {
      totalFetched,
      createdCount,
      updatedCount,
      hasMore: false,
      nextCursorPage: 0,
      nextCursorScope: null,
    }
  }

  const currentCountry = countrySequence[scopeIndex]
  cursorScope = currentCountry
  const windowStartPage = cursorPage
  const fetchResult = await fetchPartnerboostPromotableProductsWithMeta({
    userId: params.userId,
    startPage: windowStartPage,
    countryCodeOverride: currentCountry,
    linkCountryCodeOverride: currentCountry,
    maxPages: pageWindowSize,
    suppressMaxPagesWarning: true,
    onFetchProgress: async (fetchedCount) => {
      await emitProgress(totalFetched + Math.max(0, fetchedCount))
      await emitCheckpoint()
    },
  })

  const scopedWindowItems: NormalizedAffiliateProduct[] = []
  for (const item of fetchResult.items) {
    const mid = String(item.mid || '').trim()
    if (!mid) continue

    const allowedCountries = normalizeCountries(item.allowedCountries)
    const existingCountries = seenMidAllowedCountries.get(mid) || new Set<string>()
    for (const country of allowedCountries) {
      existingCountries.add(country)
    }
    seenMidAllowedCountries.set(mid, existingCountries)

    scopedWindowItems.push({
      ...item,
      allowedCountries: Array.from(existingCountries),
    })
  }

  const upserted = await upsertAffiliateProducts(params.userId, 'partnerboost', scopedWindowItems, {
    progressEvery: params.progressEvery,
  })
  totalFetched += upserted.totalFetched
  createdCount += upserted.createdCount
  updatedCount += upserted.updatedCount
  if (fetchResult.fetchedPages > 0) {
    processedBatches += 1
  }

  const nextPage =
    fetchResult.nextPage > windowStartPage
      ? fetchResult.nextPage
      : windowStartPage + Math.max(1, fetchResult.fetchedPages)
  const scopeHasMore = fetchResult.hasMore && fetchResult.fetchedPages > 0

  let hasMore = false
  if (scopeHasMore) {
    cursorPage = nextPage
    cursorScope = currentCountry
    hasMore = true
  } else {
    scopeIndex += 1
    if (scopeIndex < countrySequence.length) {
      cursorPage = 1
      cursorScope = countrySequence[scopeIndex]
      hasMore = true
    } else {
      cursorPage = 0
      cursorScope = null
      hasMore = false
    }
  }

  await emitProgress(totalFetched)
  await emitCheckpoint()

  return {
    totalFetched,
    createdCount,
    updatedCount,
    hasMore,
    nextCursorPage: cursorPage,
    nextCursorScope: cursorScope,
  }
}

export async function syncYeahPromosPlatformByWindow(params: {
  userId: number
  startPage?: number
  startScope?: string
  fetchedItemsBeforeWindow?: number
  pageWindowSize?: number
  progressEvery?: number
  onProgress?: (progress: AffiliateProductSyncProgress) => Promise<void> | void
  onCheckpoint?: (checkpoint: AffiliateProductSyncCheckpoint) => Promise<void> | void
}): Promise<{
  totalFetched: number
  createdCount: number
  updatedCount: number
  hasMore: boolean
  nextCursorPage: number
  nextCursorScope: string | null
}> {
  const pageWindowSize = parseIntegerInRange(
    params.pageWindowSize ?? DEFAULT_YP_STREAM_WINDOW_PAGES,
    DEFAULT_YP_STREAM_WINDOW_PAGES,
    1,
    MAX_YP_STREAM_WINDOW_PAGES
  )

  let cursorPage = Math.max(1, parseInteger(params.startPage, 1))
  let cursorScope = normalizeYeahPromosMarketplace(params.startScope || '')
  let totalFetched = 0
  let createdCount = 0
  let updatedCount = 0
  const failedCount = 0
  let processedBatches = 0

  const emitProgress = async (nextFetched: number): Promise<void> => {
    if (!params.onProgress) return
    try {
      await params.onProgress({
        totalFetched: Math.max(0, nextFetched),
        processedCount: createdCount + updatedCount + failedCount,
        createdCount,
        updatedCount,
        failedCount,
      })
    } catch (error: any) {
      console.warn(
        '[affiliate-products] YP stream onProgress callback failed:',
        error?.message || error
      )
    }
  }

  const emitCheckpoint = async (): Promise<void> => {
    if (!params.onCheckpoint) return
    try {
      await params.onCheckpoint({
        cursorPage,
        cursorScope,
        processedBatches,
        totalFetched,
        createdCount,
        updatedCount,
        failedCount,
      })
    } catch (error: any) {
      console.warn(
        '[affiliate-products] YP stream onCheckpoint callback failed:',
        error?.message || error
      )
    }
  }

  await emitProgress(0)
  await emitCheckpoint()

  const fetchResult = await fetchYeahPromosPromotableProductsWithMeta({
    userId: params.userId,
    startPage: cursorPage,
    startScope: cursorScope || undefined,
    fetchedItemsBeforeWindow: params.fetchedItemsBeforeWindow,
    maxPages: pageWindowSize,
    suppressMaxPagesWarning: true,
    onFetchProgress: async (fetchedCount) => {
      await emitProgress(totalFetched + Math.max(0, fetchedCount))
      await emitCheckpoint()
    },
  })

  const dedupedWindowItems = dedupeNormalizedProducts(fetchResult.items)

  const upserted = await upsertAffiliateProducts(params.userId, 'yeahpromos', dedupedWindowItems, {
    progressEvery: params.progressEvery,
  })
  totalFetched += upserted.totalFetched
  createdCount += upserted.createdCount
  updatedCount += upserted.updatedCount
  if (fetchResult.fetchedPages > 0) {
    processedBatches += 1
  }

  const hasMore = fetchResult.hasMore
  cursorPage = hasMore ? Math.max(1, fetchResult.nextPage) : 0
  cursorScope = hasMore ? fetchResult.nextScope || null : null

  await emitProgress(totalFetched)
  await emitCheckpoint()

  return {
    totalFetched,
    createdCount,
    updatedCount,
    hasMore,
    nextCursorPage: cursorPage,
    nextCursorScope: cursorScope,
  }
}

export async function syncAffiliateProducts(params: {
  userId: number
  platform: AffiliatePlatform
  mode: SyncMode
  productId?: number
  resumeFromPage?: number
  resumeFromScope?: string
  fetchedItemsBeforeWindow?: number
  pageWindowSize?: number
  progressEvery?: number
  onProgress?: (progress: AffiliateProductSyncProgress) => Promise<void> | void
  onCheckpoint?: (checkpoint: AffiliateProductSyncCheckpoint) => Promise<void> | void
}): Promise<{
  totalFetched: number
  createdCount: number
  updatedCount: number
  hasMore?: boolean
  nextCursorPage?: number
  nextCursorScope?: string | null
}> {
  let normalizedItems: NormalizedAffiliateProduct[] = []
  const emitFetchProgress = async (fetchedCount: number): Promise<void> => {
    if (!params.onProgress) return
    try {
      await params.onProgress({
        totalFetched: Math.max(0, fetchedCount),
        processedCount: 0,
        createdCount: 0,
        updatedCount: 0,
        failedCount: 0,
      })
    } catch (error: any) {
      console.warn(
        '[affiliate-products] fetch stage progress callback failed:',
        error?.message || error
      )
    }
  }

  if (params.mode === 'delta') {
    normalizedItems =
      params.platform === 'partnerboost'
        ? await fetchPartnerboostDeltaProducts({
            userId: params.userId,
            onFetchProgress: emitFetchProgress,
          })
        : await fetchYeahPromosDeltaProducts({
            userId: params.userId,
            onFetchProgress: emitFetchProgress,
          })
  } else if (params.mode === 'single') {
    if (!params.productId) {
      throw new Error('缺少商品ID')
    }

    const existing = await getAffiliateProductById(params.userId, params.productId)
    if (!existing) {
      throw new Error('商品不存在')
    }
    if (existing.platform !== params.platform) {
      throw new Error('商品平台与同步请求不匹配')
    }

    if (params.platform === 'partnerboost') {
      if (!existing.asin) {
        throw new Error('该PB商品缺少ASIN，无法执行单商品同步')
      }
      const fetched = await fetchPartnerboostPromotableProducts({
        userId: params.userId,
        asins: [existing.asin],
        maxPages: 1,
        onFetchProgress: emitFetchProgress,
      })
      normalizedItems = fetched.filter((item) => item.mid === existing.mid)
    } else {
      const fetched = await fetchYeahPromosPromotableProducts({
        userId: params.userId,
        onFetchProgress: emitFetchProgress,
      })
      normalizedItems = fetched.filter((item) => item.mid === existing.mid)
    }

    if (normalizedItems.length === 0) {
      throw new Error('联盟平台未返回该商品，可能已失去推广资格')
    }
  } else {
    if (params.platform === 'partnerboost') {
      const result = await syncPartnerboostPlatformByWindow({
        userId: params.userId,
        startPage: params.resumeFromPage,
        startScope: params.resumeFromScope,
        pageWindowSize: params.pageWindowSize,
        progressEvery: params.progressEvery,
        onProgress: params.onProgress,
        onCheckpoint: params.onCheckpoint,
      })
      return result
    }

    return await syncYeahPromosPlatformByWindow({
      userId: params.userId,
      startPage: params.resumeFromPage,
      startScope: params.resumeFromScope,
      fetchedItemsBeforeWindow: params.fetchedItemsBeforeWindow,
      pageWindowSize: params.pageWindowSize,
      progressEvery: params.progressEvery,
      onProgress: params.onProgress,
      onCheckpoint: params.onCheckpoint,
    })
  }

  const upserted = await upsertAffiliateProducts(params.userId, params.platform, normalizedItems, {
    progressEvery: params.progressEvery,
    onProgress: params.onProgress,
  })
  return {
    ...upserted,
    hasMore: false,
    nextCursorPage: 0,
    nextCursorScope: null,
  }
}
