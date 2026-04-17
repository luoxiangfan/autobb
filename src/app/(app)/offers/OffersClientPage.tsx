'use client'

/**
 * Offer列表页 - P1-2优化版 + P2-2导出功能 + 分页 + 批量删除
 * 使用shadcn/ui Table组件 + 筛选器 + CSV导出
 *
 * 优化：使用usePagination Hook统一分页逻辑
 */

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { safeJsonParse } from '@/lib/api-error-handler'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import dynamic from 'next/dynamic'
import { SortableTableHead } from '@/components/SortableTableHead'
import { usePagination } from '@/hooks/usePagination'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { ResponsivePagination } from '@/components/ui/responsive-pagination'
import { getScrapeStatusLabel } from '@/lib/i18n-constants'
import { showError, showInfo, showSuccess } from '@/lib/toast-utils'
import type { OfferListItem, UnlinkTarget } from './types'

// 使用类型别名保持兼容性
type Offer = OfferListItem

interface OfferExportData {
  id: number
  offerName: string
  brand: string
  targetCountry: string
  targetLanguage: string
  url: string
  affiliateLink: string | null
  scrapeStatus: string
  isActive: boolean
  createdAt: string
}

interface OffersClientPageProps {
  offersIncrementalPollEnabled?: boolean
  offersServerPagingEnabled?: boolean
}

const OFFERS_POLL_INTERVAL_MS = 30_000
const OFFERS_FULL_SYNC_EVERY_POLLS = 10
const OFFERS_INCREMENTAL_POLL_MAX_IDS = 200
const OFFERS_SERVER_SUPPORTED_SORTS = new Set([
  'offerName',
  'brand',
  'targetCountry',
  'targetLanguage',
  'scrapeStatus',
])

const CreateOfferModalV2 = dynamic(() => import('@/components/CreateOfferModalV2'), { ssr: false })
const DeleteOfferConfirmDialog = dynamic(() => import('@/components/DeleteOfferConfirmDialog'), { ssr: false })
const ClickFarmTaskModal = dynamic(() => import('@/components/ClickFarmTaskModal'), { ssr: false })
const UrlSwapTaskModal = dynamic(() => import('@/components/UrlSwapTaskModal'), { ssr: false })
const OffersActionDialogs = dynamic(() => import('./OffersActionDialogs'), { ssr: false })
const NoOffersStateDynamic = dynamic(
  () => import('@/components/ui/empty-state').then((mod) => mod.NoOffersState),
  { ssr: false }
)
const NoResultsStateDynamic = dynamic(
  () => import('@/components/ui/empty-state').then((mod) => mod.NoResultsState),
  { ssr: false }
)
const ResponsiveActionCell = dynamic(
  () => import('@/components/ui/table-action-buttons').then((mod) => mod.ResponsiveActionCell),
  { ssr: false }
)

export default function OffersClientPage({
  offersIncrementalPollEnabled = false,
  offersServerPagingEnabled = false,
}: OffersClientPageProps) {
  const router = useRouter()
  const [offers, setOffers] = useState<Offer[]>([])
  const [filteredOffers, setFilteredOffers] = useState<Offer[]>([])
  const [serverTotal, setServerTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [manualCompatMode, setManualCompatMode] = useState(false)
  const offersRef = useRef<Offer[]>([])
  const selectedOfferIdsRef = useRef<Set<number>>(new Set())
  const visibleOfferIdsRef = useRef<number[]>([])
  const compatFallbackSignalRef = useRef<string>('')
  const pollRoundRef = useRef(0)
  const forceFullSyncRef = useRef(false)
  const pollingRef = useRef(false)
  const offersFetchAbortRef = useRef<AbortController | null>(null)
  const offersFetchSeqRef = useRef(0)

  useEffect(() => {
    offersRef.current = offers
  }, [offers])

  // P2-4: 移动端检测 - 已移除，统一使用表格视图
  // const isMobile = useIsMobile()

  // P1-2: 筛选器状态
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [countryFilter, setCountryFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [needsCompletionFilter, setNeedsCompletionFilter] = useState<string>('all') // 'all' | 'true' | 'false'

  // P2-5: 排序状态
  const [sortBy, setSortBy] = useState<string>('')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const filterKeyRef = useRef<string>('')

  // 多选和批量删除状态
  const [selectedOfferIds, setSelectedOfferIds] = useState<Set<number>>(new Set())
  const [isBatchDeleteDialogOpen, setIsBatchDeleteDialogOpen] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [batchDeleteError, setBatchDeleteError] = useState<string | null>(null)
  const [isBatchCreativeDialogOpen, setIsBatchCreativeDialogOpen] = useState(false)
  const [batchCreatingCreatives, setBatchCreatingCreatives] = useState(false)
  const [isBatchRebuildDialogOpen, setIsBatchRebuildDialogOpen] = useState(false)
  const [batchRebuilding, setBatchRebuilding] = useState(false)
  const MAX_BATCH_CREATIVE_OFFERS = 50
  const MAX_BATCH_REBUILD_OFFERS = 50

  // 分页状态 - 使用统一的usePagination Hook
  const {
    currentPage,
    pageSize,
    setPage,
    setPageSize,
    offset,
    pageSizeOptions,
  } = usePagination({ initialPageSize: 50 })

  const hasUnsupportedServerSort = sortBy !== '' && !OFFERS_SERVER_SUPPORTED_SORTS.has(sortBy)
  const isServerPagingMode = offersServerPagingEnabled && !manualCompatMode && !hasUnsupportedServerSort
  const totalItems = isServerPagingMode ? serverTotal : filteredOffers.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const serverLimit = isServerPagingMode ? pageSize : 0
  const serverOffset = isServerPagingMode ? offset : 0
  const serverSearchQuery = isServerPagingMode ? debouncedSearchQuery.trim() : ''
  const serverCountry = isServerPagingMode && countryFilter !== 'all' ? countryFilter : ''
  const serverScrapeStatus = isServerPagingMode && statusFilter !== 'all' ? statusFilter : ''
  const serverNeedsCompletion = isServerPagingMode && needsCompletionFilter !== 'all' ? needsCompletionFilter : ''
  const serverSortBy = isServerPagingMode && sortBy && OFFERS_SERVER_SUPPORTED_SORTS.has(sortBy)
    ? sortBy
    : ''
  const serverSortOrder = isServerPagingMode ? sortOrder : 'desc'

  useEffect(() => {
    if (!isServerPagingMode) {
      setDebouncedSearchQuery(searchQuery)
      return
    }

    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 300)

    return () => {
      window.clearTimeout(timer)
    }
  }, [isServerPagingMode, searchQuery])

  // 计算分页后的数据
  const paginatedOffers = useMemo(() => {
    if (isServerPagingMode) {
      return offers
    }
    return filteredOffers.slice(offset, offset + pageSize)
  }, [isServerPagingMode, offers, filteredOffers, offset, pageSize])

  useEffect(() => {
    selectedOfferIdsRef.current = selectedOfferIds
  }, [selectedOfferIds])

  useEffect(() => {
    visibleOfferIdsRef.current = paginatedOffers.map((offer) => offer.id)
  }, [paginatedOffers])

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [offerToDelete, setOfferToDelete] = useState<Offer | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [removeGoogleAdsCampaignsOnDelete, setRemoveGoogleAdsCampaignsOnDelete] = useState(false)

  // 补点击任务Modal
  const [isClickFarmModalOpen, setIsClickFarmModalOpen] = useState(false)
  const [selectedOfferForClickFarm, setSelectedOfferForClickFarm] = useState<Offer | null>(null)
  const [editTaskIdForClickFarm, setEditTaskIdForClickFarm] = useState<string | number | undefined>(undefined)
  const [clickFarmLoading, setClickFarmLoading] = useState(false)

  // 换链接任务Modal
  const [isUrlSwapModalOpen, setIsUrlSwapModalOpen] = useState(false)
  const [selectedOfferForUrlSwap, setSelectedOfferForUrlSwap] = useState<Offer | null>(null)
  const [editTaskIdForUrlSwap, setEditTaskIdForUrlSwap] = useState<string | undefined>(undefined)
  const [urlSwapLoading, setUrlSwapLoading] = useState(false)

  // 删除确认对话框状态（支持关联账号详情）
  const [isDeleteConfirmDialogOpen, setIsDeleteConfirmDialogOpen] = useState(false)
  const [deleteLinkedAccounts, setDeleteLinkedAccounts] = useState<any[]>([])
  const [deleteAccountCount, setDeleteAccountCount] = useState(0)
  const [deleteCampaignCount, setDeleteCampaignCount] = useState(0)

  // P1-11: 解除关联状态
  const [isUnlinkDialogOpen, setIsUnlinkDialogOpen] = useState(false)
  const [offerToUnlink, setOfferToUnlink] = useState<UnlinkTarget | null>(null)
  const [unlinking, setUnlinking] = useState(false)
  const [removeGoogleAdsCampaignsOnUnlink, setRemoveGoogleAdsCampaignsOnUnlink] = useState(false)

  // 拉黑投放状态
  const [blacklisting, setBlacklisting] = useState(false)
  const [isBlacklistDialogOpen, setIsBlacklistDialogOpen] = useState(false)
  const [offerToBlacklist, setOfferToBlacklist] = useState<Offer | null>(null)

  /**
   * 处理401未授权错误 - 跳转到登录页
   */
  const handleUnauthorized = useCallback(() => {
    document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search)
    router.push(`/login?redirect=${redirectUrl}`)
  }, [router])

  const buildOffersListUrl = useCallback((options?: {
    ids?: number[]
    noCache?: boolean
    forceCompatFullList?: boolean
  }) => {
    if (options?.ids && options.ids.length > 0) {
      return `/api/offers?ids=${options.ids.join(',')}`
    }

    const params = new URLSearchParams()
    if (options?.noCache) {
      params.set('noCache', 'true')
    }

    const useServerPagingForRequest = isServerPagingMode && !options?.forceCompatFullList
    if (useServerPagingForRequest) {
      params.set('limit', String(serverLimit))
      params.set('offset', String(serverOffset))

      if (serverSearchQuery) params.set('search', serverSearchQuery)
      if (serverCountry) params.set('targetCountry', serverCountry)
      if (serverScrapeStatus) params.set('scrapeStatus', serverScrapeStatus)
      if (serverNeedsCompletion) params.set('needsCompletion', serverNeedsCompletion)

      if (serverSortBy) {
        params.set('sortBy', serverSortBy)
        params.set('sortOrder', serverSortOrder)
      }
    }

    return `/api/offers?${params.toString()}`
  }, [
    isServerPagingMode,
    serverLimit,
    serverOffset,
    serverSearchQuery,
    serverCountry,
    serverScrapeStatus,
    serverNeedsCompletion,
    serverSortBy,
    serverSortOrder,
  ])

  const fetchOffers = useCallback(async (options?: { forceCompatFullList?: boolean; noCache?: boolean }) => {
    const requestSeq = offersFetchSeqRef.current + 1
    offersFetchSeqRef.current = requestSeq
    offersFetchAbortRef.current?.abort()
    const abortController = new AbortController()
    offersFetchAbortRef.current = abortController

    try {
      const requestUrl = buildOffersListUrl({
        noCache: options?.noCache,
        forceCompatFullList: options?.forceCompatFullList,
      })
      const response = await fetch(requestUrl, {
        credentials: 'include',
        cache: 'no-store', // 禁用 Next.js 自动缓存，确保获取最新数据
        signal: abortController.signal,
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        throw new Error('获取Offer列表失败')
      }

      const data = await response.json()
      const compatibilityCode = typeof data?.compatibility?.code === 'string'
        ? data.compatibility.code
        : ''

      if (
        compatibilityCode === 'PARTIAL_UNSUPPORTED_SORT'
        && isServerPagingMode
        && !options?.forceCompatFullList
        && !manualCompatMode
      ) {
        const signalKey = String(data?.compatibility?.requestedSortBy || '')
        if (compatFallbackSignalRef.current !== signalKey) {
          compatFallbackSignalRef.current = signalKey
          showInfo('当前排序字段暂不支持服务端模式，已自动切换到兼容全量模式。')
        }
        setManualCompatMode(true)
        setPage(1)
        return
      }

      const nextOffers = Array.isArray(data.offers) ? (data.offers as Offer[]) : []
      const nextTotal = Number.isFinite(Number(data.total)) ? Number(data.total) : nextOffers.length

      if (requestSeq !== offersFetchSeqRef.current) {
        return
      }

      setOffers(nextOffers)
      setFilteredOffers(nextOffers)
      setServerTotal(nextTotal)
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return
      }
      setError(err.message || '获取Offer列表失败')
    } finally {
      if (requestSeq === offersFetchSeqRef.current) {
        setLoading(false)
      }
      if (offersFetchAbortRef.current === abortController) {
        offersFetchAbortRef.current = null
      }
    }
  }, [buildOffersListUrl, handleUnauthorized, isServerPagingMode, manualCompatMode, setPage])

  const applyLocalOfferDeletion = useCallback((ids: number[]) => {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return
    const idSet = new Set(uniqueIds)

    setOffers((prev) => prev.filter((offer) => !idSet.has(offer.id)))
    setSelectedOfferIds((prev) => {
      const next = new Set(prev)
      uniqueIds.forEach((id) => next.delete(id))
      return next
    })

    if (isServerPagingMode) {
      setServerTotal((prev) => Math.max(0, prev - uniqueIds.length))
    }
  }, [isServerPagingMode])

  const applyLocalOfferUnlink = useCallback((offerId: number, accountId: number) => {
    setOffers((prev) => prev.map((offer) => {
      if (offer.id !== offerId) return offer
      const nextLinkedAccounts = Array.isArray(offer.linkedAccounts)
        ? offer.linkedAccounts.filter((account) => Number(account.accountId) !== Number(accountId))
        : []
      return {
        ...offer,
        linkedAccounts: nextLinkedAccounts,
      }
    }))
  }, [])

  const applyLocalOfferBlacklist = useCallback((offerId: number, nextIsBlacklisted: boolean) => {
    setOffers((prev) => prev.map((offer) => (
      offer.id === offerId
        ? {
            ...offer,
            isBlacklisted: nextIsBlacklisted,
          }
        : offer
    )))
  }, [])

  useEffect(() => {
    fetchOffers()
  }, [fetchOffers])

  useEffect(() => {
    if (!offersIncrementalPollEnabled) return

    const markForceFullSync = () => {
      forceFullSyncRef.current = true
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        markForceFullSync()
      }
    }

    window.addEventListener('focus', markForceFullSync)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', markForceFullSync)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [offersIncrementalPollEnabled])

  useEffect(() => {
    const buildIncrementalPollIds = (): number[] => {
      const inProgressIds = offersRef.current
        .filter((offer) => offer.scrapeStatus === 'in_progress')
        .map((offer) => offer.id)
      const selectedIds = Array.from(selectedOfferIdsRef.current)
      const visibleIds = visibleOfferIdsRef.current

      const merged = [...inProgressIds, ...selectedIds, ...visibleIds]
      const deduped: number[] = []
      const seen = new Set<number>()

      for (const id of merged) {
        const normalizedId = Number(id)
        if (!Number.isFinite(normalizedId) || seen.has(normalizedId)) continue
        deduped.push(normalizedId)
        seen.add(normalizedId)
        if (deduped.length >= OFFERS_INCREMENTAL_POLL_MAX_IDS) break
      }

      return deduped
    }

    const shouldRefreshFullOffers = (nextOffers: Offer[]): boolean => {
      if (nextOffers.some((offer) => offer.scrapeStatus === 'in_progress')) {
        return true
      }

      const currentOffers = offersRef.current
      if (currentOffers.length !== nextOffers.length) {
        return true
      }

      const currentById = new Map(currentOffers.map((offer) => [offer.id, offer]))
      for (const nextOffer of nextOffers) {
        const currentOffer = currentById.get(nextOffer.id)
        if (!currentOffer) return true

        const currentLinked = currentOffer.linkedAccounts || []
        const nextLinked = nextOffer.linkedAccounts || []
        if (currentLinked.length !== nextLinked.length) return true

        const currentCustomerIds = currentLinked.map((a) => a.customerId).join(',')
        const nextCustomerIds = nextLinked.map((a) => a.customerId).join(',')
        if (currentCustomerIds !== nextCustomerIds) return true
      }

      return false
    }

    const applyIncrementalOfferUpdates = (updatedOffers: Array<Partial<Offer> & { id: number }>) => {
      if (updatedOffers.length === 0) return

      const updatesById = new Map<number, Partial<Offer> & { id: number }>()
      updatedOffers.forEach((updatedOffer) => {
        const id = Number(updatedOffer.id)
        if (!Number.isFinite(id)) return
        updatesById.set(id, updatedOffer)
      })
      if (updatesById.size === 0) return

      const currentOffers = offersRef.current
      if (currentOffers.length === 0) return

      let hasChanges = false
      const nextOffers = currentOffers.map((offer) => {
        const patch = updatesById.get(offer.id)
        if (!patch) return offer

        const nextOffer: Offer = {
          ...offer,
          brand: typeof patch.brand === 'string' ? patch.brand : offer.brand,
          targetCountry: typeof patch.targetCountry === 'string' ? patch.targetCountry : offer.targetCountry,
          affiliateLink: patch.affiliateLink === undefined ? offer.affiliateLink : patch.affiliateLink,
          scrapeStatus: patch.scrapeStatus ?? offer.scrapeStatus,
          scrapeError: patch.scrapeError === undefined ? offer.scrapeError : patch.scrapeError,
        }

        const changed = (
          nextOffer.brand !== offer.brand
          || nextOffer.targetCountry !== offer.targetCountry
          || nextOffer.affiliateLink !== offer.affiliateLink
          || nextOffer.scrapeStatus !== offer.scrapeStatus
          || nextOffer.scrapeError !== offer.scrapeError
        )

        if (changed) {
          hasChanges = true
          return nextOffer
        }
        return offer
      })

      if (!hasChanges) return

      setOffers(nextOffers)
      setFilteredOffers(nextOffers)
    }

    const runPollRequest = async (url: string) => {
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
      })

      if (response.status === 401) {
        handleUnauthorized()
        return null
      }

      const result = await safeJsonParse<any>(response)
      if (!result.success) return null
      return result.data
    }

    const pollInterval = setInterval(async () => {
      const isIncrementalMode = offersIncrementalPollEnabled

      if (isIncrementalMode && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      if (pollingRef.current) return
      pollingRef.current = true

      try {
        const listUrl = buildOffersListUrl({ noCache: true })

        if (!isIncrementalMode) {
          const data = await runPollRequest(listUrl)
          if (!data) return

          const nextOffers = Array.isArray(data.offers) ? (data.offers as Offer[]) : []
          const nextTotal = Number.isFinite(Number(data.total)) ? Number(data.total) : nextOffers.length
          setServerTotal(nextTotal)
          if (shouldRefreshFullOffers(nextOffers)) {
            console.log('[Polling] Updating offers list...')
            setOffers(nextOffers)
            setFilteredOffers(nextOffers)
          }
          return
        }

        pollRoundRef.current += 1
        const incrementalIds = buildIncrementalPollIds()
        const forceFullSync = forceFullSyncRef.current
        const shouldRunFullSync = (
          forceFullSync
          || incrementalIds.length === 0
          || pollRoundRef.current % OFFERS_FULL_SYNC_EVERY_POLLS === 0
        )

        const pollUrl = shouldRunFullSync
          ? listUrl
          : buildOffersListUrl({ ids: incrementalIds })
        const data = await runPollRequest(pollUrl)
        if (!data) return

        if (shouldRunFullSync) {
          const nextOffers = Array.isArray(data.offers) ? (data.offers as Offer[]) : []
          const nextTotal = Number.isFinite(Number(data.total)) ? Number(data.total) : nextOffers.length
          forceFullSyncRef.current = false
          setServerTotal(nextTotal)
          if (shouldRefreshFullOffers(nextOffers)) {
            console.log('[Polling] Updating offers list...')
            setOffers(nextOffers)
            setFilteredOffers(nextOffers)
          }
          return
        }

        const incrementalOffers = Array.isArray(data.offers)
          ? (data.offers as Array<Partial<Offer> & { id: number }>)
          : []
        applyIncrementalOfferUpdates(incrementalOffers)
      } catch (error) {
        // 轮询错误静默处理，不影响用户体验
        console.error('[Polling] Error fetching offers:', error)
      } finally {
        pollingRef.current = false
      }
    }, OFFERS_POLL_INTERVAL_MS)

    return () => clearInterval(pollInterval)
  }, [offersIncrementalPollEnabled, buildOffersListUrl, handleUnauthorized])

  // P1-2 + P2-5: 应用筛选器和排序
  useEffect(() => {
    if (isServerPagingMode) {
      setFilteredOffers(offers)

      const filterKey = JSON.stringify({
        searchQuery: debouncedSearchQuery,
        countryFilter,
        statusFilter,
        needsCompletionFilter,
        sortBy,
        sortOrder,
      })
      const filtersChanged = filterKeyRef.current !== filterKey
      filterKeyRef.current = filterKey

      const nextPage = filtersChanged ? 1 : currentPage
      setPage(nextPage > totalPages ? totalPages : nextPage)
      return
    }

    let filtered = offers

    // 搜索筛选
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (normalizedQuery) {
      filtered = filtered.filter(
        (offer) =>
          String(offer.id).includes(normalizedQuery) ||
          offer.brand.toLowerCase().includes(normalizedQuery) ||
          offer.offerName?.toLowerCase().includes(normalizedQuery) ||
          offer.url.toLowerCase().includes(normalizedQuery) ||
          offer.finalUrl?.toLowerCase().includes(normalizedQuery)
      )
    }

    // 国家筛选
    if (countryFilter !== 'all') {
      filtered = filtered.filter((offer) => offer.targetCountry === countryFilter)
    }

    // 状态筛选
    if (statusFilter !== 'all') {
      filtered = filtered.filter((offer) => offer.scrapeStatus === statusFilter)
    }

    // 按需要完善状态筛选
    if (needsCompletionFilter !== 'all') {
      const needsCompletion = needsCompletionFilter === 'true'
      filtered = filtered.filter((offer) => (offer.needsCompletion ?? false) === needsCompletion)
    }

    // P2-5: 排序
    if (sortBy) {
      filtered = [...filtered].sort((a, b) => {
        // 特殊处理：关联账号数量排序
        if (sortBy === 'linkedAccounts') {
          const aCount = a.linkedAccounts?.length || 0
          const bCount = b.linkedAccounts?.length || 0
          return sortOrder === 'asc' ? aCount - bCount : bCount - aCount
        }

        const aVal = a[sortBy as keyof Offer]
        const bVal = b[sortBy as keyof Offer]

        if (aVal === null || aVal === undefined) return 1
        if (bVal === null || bVal === undefined) return -1

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortOrder === 'asc'
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal)
        }

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortOrder === 'asc' ? aVal - bVal : bVal - aVal
        }

        return 0
      })
    }

    setFilteredOffers(filtered)

    const filterKey = JSON.stringify({ searchQuery, countryFilter, statusFilter, sortBy, sortOrder, needsCompletionFilter })
    const filtersChanged = filterKeyRef.current !== filterKey
    filterKeyRef.current = filterKey

    const localTotalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const nextPage = filtersChanged ? 1 : currentPage
    setPage(nextPage > localTotalPages ? localTotalPages : nextPage)
  }, [
    isServerPagingMode,
    offers,
    searchQuery,
    debouncedSearchQuery,
    countryFilter,
    statusFilter,
    needsCompletionFilter,
    sortBy,
    sortOrder,
    pageSize,
    currentPage,
    setPage,
    totalPages,
  ])

  // P2-5: 排序处理函数
  const handleSort = (field: string) => {
    if (sortBy === field) {
      // 同一列：切换排序方向或取消排序
      if (sortOrder === 'desc') {
        setSortOrder('asc')
      } else {
        setSortBy('')
        setSortOrder('desc')
      }
    } else {
      // 新列：默认降序
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  const handleDeleteOffer = async (
    autoUnlink: boolean = false,
    removeGoogleAdsCampaigns: boolean = false
  ) => {
    if (!offerToDelete) return

    try {
      setDeleting(true)
      setDeleteError(null)

      // 构建URL，添加autoUnlink参数
      const url = new URL(`/api/offers/${offerToDelete.id}`, window.location.origin)
      if (autoUnlink) {
        url.searchParams.set('autoUnlink', 'true')
      }
      if (removeGoogleAdsCampaigns) {
        url.searchParams.set('removeGoogleAdsCampaigns', 'true')
      }

      const response = await fetch(url.toString(), {
        method: 'DELETE',
        credentials: 'include',
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      const data = await response.json()

      // 409状态码：有关联账号需要确认
      if (response.status === 409 && data.hasLinkedAccounts) {
        // 关闭简单删除对话框，打开关联账号详情对话框
        setIsDeleteDialogOpen(false)
        setRemoveGoogleAdsCampaignsOnDelete(false)
        setDeleteLinkedAccounts(data.linkedAccounts || [])
        setDeleteAccountCount(data.accountCount || 0)
        setDeleteCampaignCount(data.campaignCount || 0)
        setIsDeleteConfirmDialogOpen(true)
        return
      }

      if (!response.ok) {
        // 在对话框内显示错误，不关闭对话框
        setDeleteError(data.error || '删除Offer失败')
        return
      }

      applyLocalOfferDeletion([offerToDelete.id])
      void fetchOffers({ noCache: true })

      // 关闭所有对话框
      setIsDeleteDialogOpen(false)
      setIsDeleteConfirmDialogOpen(false)
      setOfferToDelete(null)
      setDeleteError(null)
      setRemoveGoogleAdsCampaignsOnDelete(false)
      setDeleteLinkedAccounts([])
      setDeleteAccountCount(0)
      setDeleteCampaignCount(0)
    } catch (err: any) {
      setDeleteError(err.message || '删除Offer失败')
    } finally {
      setDeleting(false)
    }
  }

  // 批量删除处理函数
  const handleBatchDelete = async () => {
    if (selectedOfferIds.size === 0) return

    try {
      const selectedIds = Array.from(selectedOfferIds)
      setBatchDeleting(true)
      setBatchDeleteError(null)

      // 并行删除所有选中的offers
      const deletePromises = selectedIds.map(async (id) => {
        const url = new URL(`/api/offers/${id}`, window.location.origin)
        if (removeGoogleAdsCampaignsOnDelete) {
          url.searchParams.set('removeGoogleAdsCampaigns', 'true')
        }
        const response = await fetch(url.toString(), {
          method: 'DELETE',
          credentials: 'include',
        })

        // 处理401未授权 - 跳转到登录页
        if (response.status === 401) {
          handleUnauthorized()
          throw new Error('UNAUTHORIZED')
        }

        const data = await response.json()
        return { id, response, data }
      })

      const results = await Promise.allSettled(deletePromises)

      // 检查是否有401错误
      const hasUnauthorized = results.some(
        (r) => r.status === 'rejected' && r.reason?.message === 'UNAUTHORIZED'
      )
      if (hasUnauthorized) {
        return // handleUnauthorized 已经在循环中调用
      }

      // 收集所有错误（包括HTTP错误响应和网络错误）
      const errors: string[] = []
      const successIds: number[] = []

      results.forEach((result) => {
        if (result.status === 'rejected') {
          // 跳过401错误（已经在循环中处理）
          if (result.reason?.message === 'UNAUTHORIZED') return
          // 网络错误等
          errors.push(result.reason?.message || '网络错误')
        } else if (result.status === 'fulfilled') {
          const { response, data, id } = result.value
          if (!response.ok) {
            // HTTP错误响应（如409 Conflict）
            const offerInfo = offers.find(o => o.id === id)?.brand || `ID:${id}`
            errors.push(`${offerInfo}: ${data.error || '删除失败'}`)
          } else {
            successIds.push(id)
          }
        }
      })

      if (successIds.length > 0) {
        applyLocalOfferDeletion(successIds)
        void fetchOffers({ noCache: true })
      }

      if (errors.length > 0) {
        // 在对话框内显示错误，不关闭对话框
        setBatchDeleteError(`${errors.length}/${selectedIds.length} 个Offer删除失败：\n${errors.join('\n')}`)
        return
      }

      // 清空选中状态
      setSelectedOfferIds(new Set())

      // 关闭对话框
      setIsBatchDeleteDialogOpen(false)
      setBatchDeleteError(null)
      setRemoveGoogleAdsCampaignsOnDelete(false)
    } catch (err: any) {
      setBatchDeleteError(err.message || '批量删除失败')
    } finally {
      setBatchDeleting(false)
    }
  }

  // 批量创建广告创意处理函数（每个Offer生成下一步类型，最多1个/Offer）
  const handleBatchCreateCreatives = async () => {
    const offerIds = Array.from(selectedOfferIds)
    if (offerIds.length === 0) return

    if (offerIds.length > MAX_BATCH_CREATIVE_OFFERS) {
      showError('选择数量超限', `单次最多支持${MAX_BATCH_CREATIVE_OFFERS}个Offer`)
      return
    }

    try {
      setBatchCreatingCreatives(true)

      const response = await fetch('/api/offers/batch/generate-creatives-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ offerIds }),
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      let data: any = null
      try {
        data = await response.json()
      } catch {
        data = {}
      }

      if (!response.ok) {
        const message = data?.message || data?.error || '批量创建广告创意失败'
        const details = data?.details && typeof data.details === 'string' ? data.details : undefined
        showError('批量创建失败', details ? `${message}\n${details}` : message)
        return
      }

      const enqueuedCount = Number(data?.enqueuedCount || 0)
      const skippedCount = Number(data?.skippedCount || 0)
      const failedCount = Number(data?.failedCount || 0)
      const summaryParts = [`已入队 ${enqueuedCount} 个`]
      if (skippedCount > 0) summaryParts.push(`跳过 ${skippedCount} 个`)
      if (failedCount > 0) summaryParts.push(`失败 ${failedCount} 个`)

      showSuccess('已提交批量生成任务', summaryParts.join('，'))
      setIsBatchCreativeDialogOpen(false)
    } catch (err: any) {
      showError('批量创建失败', err?.message || '网络错误')
    } finally {
      setBatchCreatingCreatives(false)
    }
  }

  // 批量重建Offer处理函数
  const handleBatchRebuild = async () => {
    const offerIds = Array.from(selectedOfferIds)
    if (offerIds.length === 0) return

    if (offerIds.length > MAX_BATCH_REBUILD_OFFERS) {
      showError('选择数量超限', `单次最多支持${MAX_BATCH_REBUILD_OFFERS}个Offer`)
      return
    }

    try {
      setBatchRebuilding(true)

      const response = await fetch('/api/offers/batch/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ offerIds }),
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      let data: any = null
      try {
        data = await response.json()
      } catch {
        data = {}
      }

      if (!response.ok) {
        const message = data?.message || data?.error || '批量重建Offer失败'
        const details = data?.details && typeof data.details === 'string' ? data.details : undefined
        showError('批量重建失败', details ? `${message}\n${details}` : message)
        return
      }

      const enqueuedCount = Number(data?.enqueuedCount || 0)
      const skippedCount = Number(data?.skippedCount || 0)
      const failedCount = Number(data?.failedCount || 0)
      const summaryParts = [`已入队 ${enqueuedCount} 个`]
      if (skippedCount > 0) summaryParts.push(`跳过 ${skippedCount} 个`)
      if (failedCount > 0) summaryParts.push(`失败 ${failedCount} 个`)

      showSuccess('已提交批量重建任务', summaryParts.join('，'))
      setIsBatchRebuildDialogOpen(false)

      // 3秒后刷新列表
      setTimeout(() => {
        fetchOffers({ noCache: true })
      }, 3000)
    } catch (err: any) {
      showError('批量重建失败', err?.message || '网络错误')
    } finally {
      setBatchRebuilding(false)
    }
  }

  // 全选/取消全选
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(paginatedOffers.map(o => o.id))
      setSelectedOfferIds(allIds)
    } else {
      setSelectedOfferIds(new Set())
    }
  }

  // 单选切换
  const handleSelectOffer = (offerId: number, checked: boolean) => {
    const newSelected = new Set(selectedOfferIds)
    if (checked) {
      newSelected.add(offerId)
    } else {
      newSelected.delete(offerId)
    }
    setSelectedOfferIds(newSelected)
  }

  // P1-11: 解除关联处理函数
  const handleUnlinkAccount = async () => {
    if (!offerToUnlink) return

    try {
      setUnlinking(true)
      const response = await fetch(`/api/offers/${offerToUnlink.offer.id}/unlink`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          accountId: offerToUnlink.accountId,
          removeGoogleAdsCampaigns: removeGoogleAdsCampaignsOnUnlink,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '解除关联失败')
      }

      applyLocalOfferUnlink(offerToUnlink.offer.id, offerToUnlink.accountId)
      void fetchOffers({ noCache: true })

      // 关闭对话框
      setIsUnlinkDialogOpen(false)
      setOfferToUnlink(null)
      setRemoveGoogleAdsCampaignsOnUnlink(false)
    } catch (err: any) {
      setError(err.message || '解除关联失败')
    } finally {
      setUnlinking(false)
    }
  }

  // 拉黑/取消拉黑处理函数
  const handleToggleBlacklist = async () => {
    if (!offerToBlacklist) return

    try {
      setBlacklisting(true)
      const method = offerToBlacklist.isBlacklisted ? 'DELETE' : 'POST'
      const response = await fetch(`/api/offers/${offerToBlacklist.id}/blacklist`, {
        method,
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || `${offerToBlacklist.isBlacklisted ? '取消拉黑' : '拉黑投放'}失败`)
      }

      applyLocalOfferBlacklist(offerToBlacklist.id, !offerToBlacklist.isBlacklisted)
      void fetchOffers({ noCache: true })

      // 关闭对话框
      setIsBlacklistDialogOpen(false)
      setOfferToBlacklist(null)
    } catch (err: any) {
      setError(err.message || `${offerToBlacklist.isBlacklisted ? '取消拉黑' : '拉黑投放'}失败`)
    } finally {
      setBlacklisting(false)
    }
  }

  const getScrapeStatusBadge = (status: string) => {
    const configs = {
      pending: { label: getScrapeStatusLabel('pending'), variant: 'secondary' as const, className: 'text-gray-500' },
      in_progress: { label: getScrapeStatusLabel('in_progress'), variant: 'default' as const, className: 'bg-blue-600' },
      completed: { label: getScrapeStatusLabel('completed'), variant: 'outline' as const, className: 'bg-green-50 text-green-700 border-green-200' },
      failed: { label: getScrapeStatusLabel('failed'), variant: 'destructive' as const, className: '' },
    }
    const config = configs[status as keyof typeof configs] || { label: status, variant: 'outline' as const, className: '' }
    return <Badge variant={config.variant} className={config.className}>{config.label}</Badge>
  }

  // 获取唯一国家列表
  const uniqueCountries = useMemo(() => {
    const values = new Set(offers.map((o) => o.targetCountry))
    if (countryFilter !== 'all') {
      values.add(countryFilter)
    }
    return Array.from(values)
  }, [offers, countryFilter])

  const hasActiveFilters = Boolean(searchQuery || countryFilter !== 'all' || statusFilter !== 'all' || needsCompletionFilter !== 'all')
  useEffect(() => {
    if (manualCompatMode && !hasUnsupportedServerSort) {
      setManualCompatMode(false)
    }
  }, [manualCompatMode, hasUnsupportedServerSort])

  // P2-2: 导出Offer数据
  const handleExport = async () => {
    try {
      const { exportOffers } = await import('@/lib/export-utils')
      let exportSource = offers
      if (isServerPagingMode) {
        const response = await fetch(
          buildOffersListUrl({ noCache: true, forceCompatFullList: true }),
          { credentials: 'include', cache: 'no-store' }
        )

        if (response.status === 401) {
          handleUnauthorized()
          return
        }
        if (!response.ok) {
          throw new Error('导出前拉取全量Offer失败')
        }

        const data = await response.json()
        exportSource = Array.isArray(data.offers) ? (data.offers as Offer[]) : []
      }

      const exportData: OfferExportData[] = exportSource.map((offer) => ({
        id: offer.id,
        offerName: offer.offerName || `${offer.brand}_${offer.targetCountry}_01`,
        brand: offer.brand,
        targetCountry: offer.targetCountry,
        targetLanguage: offer.targetLanguage || 'English',
        url: offer.url,
        affiliateLink: offer.affiliateLink,
        scrapeStatus: offer.scrapeStatus,
        isActive: offer.isActive,
        createdAt: offer.createdAt,
      }))
      exportOffers(exportData)
    } catch (err: any) {
      showError('导出失败', err?.message || '导出Offer失败')
    }
  }

  const shouldMountActionDialogs = (
    isUnlinkDialogOpen
    || isDeleteDialogOpen
    || isBatchDeleteDialogOpen
    || isBatchCreativeDialogOpen
    || isBatchRebuildDialogOpen
    || isBlacklistDialogOpen
  )

  const handleUnlinkDialogOpenChange = (open: boolean) => {
    setIsUnlinkDialogOpen(open)
    if (!open) {
      setRemoveGoogleAdsCampaignsOnUnlink(false)
    }
  }

  const handleDeleteDialogOpenChange = (open: boolean) => {
    setIsDeleteDialogOpen(open)
    if (!open) {
      setDeleteError(null)
      setRemoveGoogleAdsCampaignsOnDelete(false)
    }
  }

  const handleBatchDeleteDialogOpenChange = (open: boolean) => {
    setIsBatchDeleteDialogOpen(open)
    if (!open) {
      setBatchDeleteError(null)
      setRemoveGoogleAdsCampaignsOnDelete(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center py-4 sm:h-16 gap-3 sm:gap-0">
              <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-8 w-32" />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-24" />
              </div>
            </div>
          </div>
        </div>
        <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <Skeleton className="h-32 w-full mb-6" />
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header - P2-4移动端优化 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center py-4 sm:h-16 gap-3 sm:gap-0">
            {/* 左侧标题区 */}
            <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/dashboard')}
                className="flex-shrink-0"
              >
                ← 返回Dashboard
              </Button>
              <h1 className="page-title">Offer管理</h1>
              <Badge variant="outline" className="text-caption sm:text-body-sm">
                {totalItems}
              </Badge>
            </div>

            {/* 右侧操作按钮 */}
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              {/* 批量操作按钮 - 有选中项时显示 */}
              {selectedOfferIds.size > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsBatchCreativeDialogOpen(true)}
                    disabled={batchCreatingCreatives || selectedOfferIds.size > MAX_BATCH_CREATIVE_OFFERS}
                    className="flex-shrink-0"
                    title={
                      selectedOfferIds.size > MAX_BATCH_CREATIVE_OFFERS
                        ? `单次最多支持${MAX_BATCH_CREATIVE_OFFERS}个Offer`
                        : '为每个Offer生成下一步创意类型（A→B→D），每次最多1个/Offer'
                    }
                  >
                    批量创建广告创意 ({selectedOfferIds.size})
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsBatchRebuildDialogOpen(true)}
                    disabled={batchRebuilding || selectedOfferIds.size > MAX_BATCH_REBUILD_OFFERS}
                    className="flex-shrink-0"
                    title={
                      selectedOfferIds.size > MAX_BATCH_REBUILD_OFFERS
                        ? `单次最多支持${MAX_BATCH_REBUILD_OFFERS}个Offer`
                        : '重新抓取并更新所有Offer信息（约2-5分钟/个）'
                    }
                  >
                    批量重建Offer ({selectedOfferIds.size})
                  </Button>

                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setRemoveGoogleAdsCampaignsOnDelete(false)
                      setIsBatchDeleteDialogOpen(true)
                    }}
                    className="flex-shrink-0"
                  >
                    删除 ({selectedOfferIds.size})
                  </Button>
                </>
              )}

              <Button
                onClick={() => setIsCreateModalOpen(true)}
                className="flex-1 sm:flex-none"
              >
                创建Offer
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                  >
                    更多操作
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={handleExport} disabled={totalItems === 0}>
                    导出Offer
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => window.open('/api/offers/batch-template')}>
                    下载模板
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push('/offers/batch')}>
                    导入Offer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* P1-2 + P2-4: 筛选器（移动端优化） */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* 搜索框 */}
              <div className="relative flex-1">
                <Input
                  type="text"
                  placeholder="搜索品牌名称、Offer ID、Offer标识、URL..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-3"
                />
              </div>

              {/* 筛选器组 */}
              <div className="flex gap-3 overflow-x-auto pb-1 lg:pb-0">
                {/* 国家筛选 */}
                <select
                  value={countryFilter}
                  onChange={(event) => setCountryFilter(event.target.value)}
                  className="h-10 w-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="all">所有国家</option>
                  {uniqueCountries.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>

                {/* 状态筛选 */}
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="h-10 w-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="all">所有状态</option>
                  <option value="pending">{getScrapeStatusLabel('pending')}</option>
                  <option value="in_progress">{getScrapeStatusLabel('in_progress')}</option>
                  <option value="completed">{getScrapeStatusLabel('completed')}</option>
                  <option value="failed">{getScrapeStatusLabel('failed')}</option>
                </select>
              </div>
            </div>

            {/* 筛选结果提示 */}
            {hasActiveFilters && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-body-sm text-muted-foreground">
                  显示 {isServerPagingMode ? paginatedOffers.length : filteredOffers.length} / {totalItems} 个Offer
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('')
                    setCountryFilter('all')
                    setStatusFilter('all')
                    setNeedsCompletionFilter('all')
                  }}
                >
                  清除筛选
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error Message */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* P2-7: 统一空状态 */}
        {filteredOffers.length === 0 ? (
          totalItems === 0 && !hasActiveFilters ? (
            <NoOffersStateDynamic onAction={() => setIsCreateModalOpen(true)} />
          ) : (
            <NoResultsStateDynamic />
          )
        ) : (
          /* 统一使用表格视图 */
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table className="[&_thead_th]:bg-white">
                  <TableHeader>
                    <TableRow>
                      {/* 全选checkbox */}
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={paginatedOffers.length > 0 && paginatedOffers.every(o => selectedOfferIds.has(o.id))}
                          onCheckedChange={handleSelectAll}
                          aria-label="全选"
                        />
                      </TableHead>
                      {/* Offer ID */}
                      <TableHead className="w-[80px] whitespace-nowrap">
                        Offer ID
                      </TableHead>
                      <SortableTableHead
                        field="offerName"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        className="w-[200px]"
                      >
                        产品标识
                      </SortableTableHead>
                      <SortableTableHead
                        field="brand"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                      >
                        品牌信息
                      </SortableTableHead>
                      <SortableTableHead
                        field="targetCountry"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        className="w-[110px] whitespace-nowrap"
                      >
                        推广国家
                      </SortableTableHead>
                      <SortableTableHead
                        field="targetLanguage"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        className="w-[100px] whitespace-nowrap"
                      >
                        语言
                      </SortableTableHead>
                      <SortableTableHead
                        field="scrapeStatus"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        className="w-[120px] whitespace-nowrap"
                      >
                        状态
                      </SortableTableHead>
                      <SortableTableHead
                        field="linkedAccounts"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        className="whitespace-nowrap"
                      >
                        关联Ads账号
                      </SortableTableHead>
                      <TableHead className="whitespace-nowrap">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedOffers.map((offer, index) => (
                      <TableRow
                        key={offer.id}
                        className={`hover:bg-gray-50/50 ${offer.isBlacklisted ? 'bg-gray-100' : ''}`}
                      >
                        {/* 选择checkbox */}
                        <TableCell>
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            <Checkbox
                              checked={selectedOfferIds.has(offer.id)}
                              onCheckedChange={(checked) => handleSelectOffer(offer.id, checked as boolean)}
                              aria-label={`选择 ${offer.brand}`}
                            />
                          </div>
                        </TableCell>
                        {/* Offer ID */}
                        <TableCell className="font-mono text-body-sm text-gray-600">
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            {offer.id}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono">
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            <div className="flex items-center gap-2">
                              <a
                                href={`/offers/${offer.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-2"
                              >
                                {offer.offerName || `${offer.brand}_${offer.targetCountry}_01`}
                                <span aria-hidden className="text-xs">↗</span>
                              </a>
                              {offer.isBlacklisted && (
                                <span title="该品牌+国家组合已拉黑投放">
                                  <span className="text-xs font-semibold text-orange-500" aria-hidden>⚠</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            <div>
                              <div className="font-medium text-gray-900">{offer.brand}</div>
                              <div className="text-body-sm text-muted-foreground truncate max-w-[200px]" title={offer.url}>
                                {offer.url}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            <Badge variant="outline">{offer.targetCountry}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-body-sm text-muted-foreground">
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            {offer.targetLanguage || 'English'}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            {getScrapeStatusBadge(offer.scrapeStatus)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            {/* P1-11: 显示关联的Google Ads账号（只显示非MCC账号） */}
                            {offer.linkedAccounts && offer.linkedAccounts.length > 0 ? (
                              <div className="space-y-1">
                                {/* 🔧 修复(2025-12-11): snake_case → camelCase */}
                                {offer.linkedAccounts.map((account, idx) => (
                                  <div key={idx} className="flex items-center gap-1.5 text-xs">
                                    <span className="text-gray-700 font-mono">
                                      {account.customerId}
                                    </span>
                                    <button
                                      onClick={() => {
                                        setOfferToUnlink({
                                          offer,
                                          accountId: account.accountId,
                                          accountName: account.customerId
                                        })
                                        setRemoveGoogleAdsCampaignsOnUnlink(false)
                                        setIsUnlinkDialogOpen(true)
                                      }}
                                      className="text-gray-400 hover:text-red-600 transition-colors"
                                      title="解除关联"
                                    >
                                      <span className="text-xs font-semibold" aria-hidden>×</span>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-caption text-gray-300">-</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <ResponsiveActionCell
                            primaryAction={{
                              icon: <span className="text-[10px] font-semibold">GO</span>,
                              label: '发布广告',
                              href: `/offers/${offer.id}/launch`,  // 🔥 2026-01-05: 使用href打开新标签页
                              target: '_blank',
                              disabled: offer.scrapeStatus !== 'completed' || offer.campaignId !== null,
                              title: offer.campaignId !== null ? '该 Offer 已有关联广告系列，一个 Offer 只能发布一个广告系列' : (offer.scrapeStatus !== 'completed' ? '请等待数据抓取完成' : undefined),
                            }}
                            secondaryActions={[
                              {
                                icon: <span className="text-[10px] font-semibold text-gray-500">CLK</span>,
                                label: '补点击任务',
                                onClick: async () => {
                                  setClickFarmLoading(true)
                                  try {
                                    const { resolveClickFarmTaskMode } = await import('./task-modal-helpers')
                                    const { editTaskId, infoMessage } = await resolveClickFarmTaskMode(offer.id)
                                    setSelectedOfferForClickFarm(offer)
                                    setEditTaskIdForClickFarm(editTaskId)
                                    if (infoMessage) {
                                      showInfo(infoMessage)
                                    }
                                    setIsClickFarmModalOpen(true)
                                  } catch (error) {
                                    console.error('查询补点击任务出错:', error)
                                    setSelectedOfferForClickFarm(offer)
                                    setEditTaskIdForClickFarm(undefined)
                                    setIsClickFarmModalOpen(true)
                                  } finally {
                                    setClickFarmLoading(false)
                                  }
                                },
                                disabled: clickFarmLoading,
                              },
                              {
                                icon: <span className="text-[10px] font-semibold text-gray-500">URL</span>,
                                label: '换链接任务',
                                onClick: async () => {
                                  setUrlSwapLoading(true)
                                  try {
                                    const { resolveUrlSwapTaskMode } = await import('./task-modal-helpers')
                                    const { editTaskId, infoMessage } = await resolveUrlSwapTaskMode(offer.id)
                                    setSelectedOfferForUrlSwap(offer)
                                    setEditTaskIdForUrlSwap(
                                      editTaskId === undefined ? undefined : String(editTaskId)
                                    )
                                    if (infoMessage) {
                                      showInfo(infoMessage)
                                    }
                                    setIsUrlSwapModalOpen(true)
                                  } catch (error) {
                                    console.error('查询换链接任务出错:', error)
                                    setSelectedOfferForUrlSwap(offer)
                                    setEditTaskIdForUrlSwap(undefined)
                                    setIsUrlSwapModalOpen(true)
                                  } finally {
                                    setUrlSwapLoading(false)
                                  }
                                },
                                disabled: urlSwapLoading || !offer.linkedAccounts?.length,
                              },
                              {
                                icon: <span className="text-[10px] font-semibold">BL</span>,
                                label: offer.isBlacklisted ? '取消拉黑' : '拉黑投放',
                                onClick: () => {
                                  setOfferToBlacklist(offer)
                                  setIsBlacklistDialogOpen(true)
                                },
                                disabled: blacklisting,
                                variant: offer.isBlacklisted ? 'secondary' : 'ghost',
                                className: offer.isBlacklisted ? 'text-green-600' : 'text-orange-600',
                              },
                              {
                                icon: <span className="text-[10px] font-semibold">DEL</span>,
                                label: '删除Offer',
                                onClick: () => {
                                  setOfferToDelete(offer)
                                  setRemoveGoogleAdsCampaignsOnDelete(false)
                                  setIsDeleteDialogOpen(true)
                                },
                                variant: 'ghost',
                                className: 'text-red-600',
                              },
                            ]}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* 分页组件 */}
              {totalPages > 0 && (
                <div className="px-6 py-4 border-t">
                  <ResponsivePagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    totalItems={totalItems}
                    pageSize={pageSize}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                    pageSizeOptions={pageSizeOptions}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      {/* Modals */}
      {/* 补点击任务Modal */}
      {(isClickFarmModalOpen || selectedOfferForClickFarm) && (
        <ClickFarmTaskModal
          open={isClickFarmModalOpen}
          onOpenChange={(open) => {
            setIsClickFarmModalOpen(open)
            if (!open) {
              setSelectedOfferForClickFarm(null)
              setEditTaskIdForClickFarm(undefined)
            }
          }}
          onSuccess={() => {
            // 任务创建/更新成功后可以选择刷新列表或显示提示
          }}
          preSelectedOfferId={selectedOfferForClickFarm?.id}
          editTaskId={editTaskIdForClickFarm}
        />
      )}

      {(isUrlSwapModalOpen || selectedOfferForUrlSwap) && (
        <UrlSwapTaskModal
          open={isUrlSwapModalOpen}
          onOpenChange={(open) => {
            setIsUrlSwapModalOpen(open)
            if (!open) {
              setSelectedOfferForUrlSwap(null)
              setEditTaskIdForUrlSwap(undefined)
            }
          }}
          onSuccess={() => {
            // 任务创建/更新成功后可以选择刷新列表或显示提示
          }}
          offerId={selectedOfferForUrlSwap?.id}
          editTaskId={editTaskIdForUrlSwap}
        />
      )}

      {isCreateModalOpen && (
        <CreateOfferModalV2
          open={isCreateModalOpen}
          onOpenChange={setIsCreateModalOpen}
          onSuccess={fetchOffers}
        />
      )}

      {/* Delete Offer Confirm Dialog (with linked accounts details) */}
      {isDeleteConfirmDialogOpen && (
        <DeleteOfferConfirmDialog
          open={isDeleteConfirmDialogOpen}
          onOpenChange={(open) => {
            setIsDeleteConfirmDialogOpen(open)
            if (!open) {
              setDeleteLinkedAccounts([])
              setDeleteAccountCount(0)
              setDeleteCampaignCount(0)
              setDeleteError(null)
              setRemoveGoogleAdsCampaignsOnDelete(false)
            }
          }}
          offerName={offerToDelete?.offerName || offerToDelete?.brand || ''}
          linkedAccounts={deleteLinkedAccounts}
          accountCount={deleteAccountCount}
          campaignCount={deleteCampaignCount}
          onConfirmDelete={(autoUnlink) => handleDeleteOffer(autoUnlink, removeGoogleAdsCampaignsOnDelete)}
          removeGoogleAdsCampaigns={removeGoogleAdsCampaignsOnDelete}
          onRemoveGoogleAdsCampaignsChange={setRemoveGoogleAdsCampaignsOnDelete}
          deleting={deleting}
        />
      )}

      {shouldMountActionDialogs && (
        <OffersActionDialogs
          isUnlinkDialogOpen={isUnlinkDialogOpen}
          onUnlinkDialogOpenChange={handleUnlinkDialogOpenChange}
          offerToUnlink={offerToUnlink}
          removeGoogleAdsCampaignsOnUnlink={removeGoogleAdsCampaignsOnUnlink}
          onRemoveGoogleAdsCampaignsOnUnlinkChange={setRemoveGoogleAdsCampaignsOnUnlink}
          unlinking={unlinking}
          onConfirmUnlink={handleUnlinkAccount}
          isDeleteDialogOpen={isDeleteDialogOpen}
          onDeleteDialogOpenChange={handleDeleteDialogOpenChange}
          offerToDelete={offerToDelete}
          deleteError={deleteError}
          onDeleteErrorReset={() => setDeleteError(null)}
          removeGoogleAdsCampaignsOnDelete={removeGoogleAdsCampaignsOnDelete}
          onRemoveGoogleAdsCampaignsOnDeleteChange={setRemoveGoogleAdsCampaignsOnDelete}
          deleting={deleting}
          onConfirmDeleteSimple={() => handleDeleteOffer(false, removeGoogleAdsCampaignsOnDelete)}
          isBatchDeleteDialogOpen={isBatchDeleteDialogOpen}
          onBatchDeleteDialogOpenChange={handleBatchDeleteDialogOpenChange}
          batchDeleteError={batchDeleteError}
          onBatchDeleteErrorReset={() => setBatchDeleteError(null)}
          selectedOfferCount={selectedOfferIds.size}
          batchDeleting={batchDeleting}
          onConfirmBatchDelete={handleBatchDelete}
          isBatchCreativeDialogOpen={isBatchCreativeDialogOpen}
          onBatchCreativeDialogOpenChange={setIsBatchCreativeDialogOpen}
          batchCreatingCreatives={batchCreatingCreatives}
          maxBatchCreativeOffers={MAX_BATCH_CREATIVE_OFFERS}
          onConfirmBatchCreateCreatives={handleBatchCreateCreatives}
          isBatchRebuildDialogOpen={isBatchRebuildDialogOpen}
          onBatchRebuildDialogOpenChange={setIsBatchRebuildDialogOpen}
          batchRebuilding={batchRebuilding}
          maxBatchRebuildOffers={MAX_BATCH_REBUILD_OFFERS}
          onConfirmBatchRebuild={handleBatchRebuild}
          isBlacklistDialogOpen={isBlacklistDialogOpen}
          onBlacklistDialogOpenChange={setIsBlacklistDialogOpen}
          offerToBlacklist={offerToBlacklist}
          blacklisting={blacklisting}
          onConfirmToggleBlacklist={handleToggleBlacklist}
        />
      )}
    </div>
  )
}
