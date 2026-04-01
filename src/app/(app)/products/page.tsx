'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { SortableTableHead } from '@/components/SortableTableHead'
import { ResponsivePagination } from '@/components/ui/responsive-pagination'
import { NoDataState, NoResultsState } from '@/components/ui/empty-state'
import { DateRangePicker, type DateRange } from '@/components/ui/date-range-picker'
import { showError, showSuccess } from '@/lib/toast-utils'
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  XCircle,
  ExternalLink,
  Link,
  Loader2,
  Package,
  Plus,
  PowerOff,
  RefreshCw,
  ChevronDown,
  Search,
  Building2,
  HelpCircle,
  AlertCircle,
  Info,
  PauseCircle,
  PlayCircle,
  Star,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

type ProductPlatform = 'yeahpromos' | 'partnerboost'
type PlatformSyncStrategy = 'light' | 'full'
type PlatformSyncOptions = {
  resumeFailedRun?: boolean
}

function getDefaultPlatformSyncStrategy(platform: ProductPlatform): PlatformSyncStrategy {
  return platform === 'partnerboost' ? 'light' : 'full'
}

function getPlatformSyncStrategyLabel(strategy: PlatformSyncStrategy): string {
  return strategy === 'light' ? '快速刷新' : '全量补齐'
}

function getPlatformSyncActionLabel(strategy: PlatformSyncStrategy, options?: PlatformSyncOptions): string {
  if (strategy !== 'full') {
    return getPlatformSyncStrategyLabel(strategy)
  }
  return options?.resumeFailedRun
    ? '全量补齐（续传失败任务）'
    : '全量补齐（从头）'
}
type LandingPageType = 'amazon_product' | 'amazon_store' | 'independent_product' | 'independent_store' | 'unknown'
type LandingPageTypeFilter = LandingPageType | 'all'
type ProductLifecycleStatus = 'active' | 'invalid' | 'sync_missing' | 'unknown'
type ProductStatusFilter = ProductLifecycleStatus | 'all'
type SortOrder = 'asc' | 'desc'
type SortField =
  | 'serial'
  | 'platform'
  | 'mid'
  | 'asin'
  | 'createdAt'
  | 'allowedCountries'
  | 'priceAmount'
  | 'commissionRate'
  | 'commissionAmount'
  | 'reviewCount'
  | 'promoLink'
  | 'relatedOfferCount'
  | 'updatedAt'
  | 'recommendationScore' // 新增: 推荐指数排序

type ProductListItem = {
  id: number
  serial: number
  platform: ProductPlatform
  mid: string
  merchantId: string | null
  productStatus: ProductLifecycleStatus
  asin: string | null
  landingPageType: LandingPageType
  brand: string | null
  productName: string | null
  productUrl: string | null
  allowedCountries: string[]
  priceAmount: number | null
  priceCurrency: string | null
  commissionRate: number | null
  commissionRateMode: 'percent' | 'amount'
  commissionAmount: number | null
  commissionCurrency: string | null
  reviewCount: number | null
  promoLink: string | null
  shortPromoLink: string | null
  activeOfferCount: number
  historicalOfferCount: number
  relatedOfferCount: number
  isBlacklisted: boolean
  recommendationScore: number | null // 新增: 推荐指数
  recommendationReasons: string[] | null // 新增: 推荐理由
  seasonalityScore: number | null // 新增: 季节性评分
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

type ProductListResponse = {
  success: boolean
  items: ProductListItem[]
  total: number
  landingPageStats?: {
    productCount: number
    storeCount: number
    unknownCount: number
  }
  productsWithLinkCount: number
  activeProductsCount: number
  invalidProductsCount: number
  syncMissingProductsCount: number
  unknownProductsCount: number
  blacklistedCount: number
  platformStats?: Record<ProductPlatform, {
    total: number
    visibleCount: number
    productCount: number
    storeCount: number
    productsWithLinkCount: number
    activeProductsCount: number
    invalidProductsCount: number
    syncMissingProductsCount: number
    unknownProductsCount: number
    blacklistedCount: number
  }>
  page: number
  pageSize: number
}

type ProductSummaryResponse = {
  success: boolean
  total: number
  landingPageStats?: {
    productCount: number
    storeCount: number
    unknownCount: number
  }
  productsWithLinkCount: number
  activeProductsCount: number
  invalidProductsCount: number
  syncMissingProductsCount: number
  unknownProductsCount: number
  blacklistedCount: number
  recommendationScoreSummary?: {
    effectiveCount: number
    lastCalculatedAt: string | null
  }
  platformStats?: Record<ProductPlatform, {
    total: number
    visibleCount: number
    productCount: number
    storeCount: number
    productsWithLinkCount: number
    activeProductsCount: number
    invalidProductsCount: number
    syncMissingProductsCount: number
    unknownProductsCount: number
    blacklistedCount: number
  }>
}

type YeahPromosSessionStatus = {
  hasSession: boolean
  isExpired: boolean
  capturedAt: string | null
  expiresAt: string | null
  maskedPhpSessionId: string | null
}

type YeahPromosSessionStatusResponse = {
  success: boolean
  session?: YeahPromosSessionStatus
  manualOnly?: boolean
  error?: string
}

type YeahPromosCapturePrepareResponse = {
  success: boolean
  loginUrl: string
  productsUrl: string
  captureUrl: string
  captureTokenExpiresAt: string
  bookmarklet: string
  error?: string
}

type PlatformStatsItem = {
  total: number
  visibleCount: number
  productCount: number
  storeCount: number
  productsWithLinkCount: number
  activeProductsCount: number
  invalidProductsCount: number
  syncMissingProductsCount: number
  unknownProductsCount: number
  blacklistedCount: number
}

type PlatformStatsMap = Record<ProductPlatform, PlatformStatsItem>

type LandingPageStats = {
  productCount: number
  storeCount: number
  unknownCount: number
}

type RecommendationScoreSummary = {
  effectiveCount: number
  lastCalculatedAt: string | null
}

type SyncRunItem = {
  id: number
  platform: ProductPlatform
  mode: 'platform' | 'single' | 'delta' | string
  status: 'queued' | 'running' | 'completed' | 'failed' | string
  total_items: number
  created_count: number
  updated_count: number
  failed_count: number
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

type SyncHourlyStatItem = {
  hourBucket: string
  fetchedCount: number
  cumulativeFetched: number
  sampleCount: number
  updatedAt: string | null
}

type YeahPromosSyncMonitorItem = {
  runId: number | null
  runStatus: string | null
  targetItems: number | null
  fetchedItems: number
  remainingItems: number | null
  avgItemsPerHour: number | null
  etaAt: string | null
  statsUpdatedAt: string | null
  hourlyStats: SyncHourlyStatItem[]
}

type BatchRow = {
  productId: number
  linkType: '单品'
  promoLink: string
  targetCountry: string
  availableCountries: string[]
  productPrice: string
  commissionRate: string
}

type NumericRangeFilters = {
  reviewCountMin: number | null
  reviewCountMax: number | null
  priceAmountMin: number | null
  priceAmountMax: number | null
  commissionRateMin: number | null
  commissionRateMax: number | null
  commissionAmountMin: number | null
  commissionAmountMax: number | null
  recommendationScoreMin: number | null
  recommendationScoreMax: number | null
}

type NumericRangeFilterDrafts = Record<keyof NumericRangeFilters, string>

const PARTNERBOOST_MERCHANT_PAGE_URL = 'https://app.partnerboost.com/partner/amazon-offers'
const YP_CAPTURE_EXTENSION_VERSION = '1.0.2'
const YP_CAPTURE_EXTENSION_DOWNLOAD_PATH = `/downloads/yp-session-capture-v${YP_CAPTURE_EXTENSION_VERSION}.zip`

const PLATFORM_LABEL: Record<ProductPlatform, string> = {
  yeahpromos: 'YeahPromos',
  partnerboost: 'PartnerBoost',
}

const PLATFORM_SHORT_LABEL: Record<ProductPlatform, string> = {
  yeahpromos: 'YP',
  partnerboost: 'PB',
}

const PRODUCT_TARGET_COUNTRY_FILTER_OPTIONS = ['US', 'MX', 'CA', 'DE', 'UK', 'ES', 'FR', 'IT'] as const
const LANDING_PAGE_TYPE_FILTER_OPTIONS: LandingPageType[] = [
  'amazon_product',
  'amazon_store',
  'independent_product',
  'independent_store',
  'unknown',
]

const PLATFORM_CARD_ACCENT_CLASS: Record<ProductPlatform, string> = {
  yeahpromos: 'text-indigo-600',
  partnerboost: 'text-emerald-600',
}

const LANDING_PAGE_TYPE_META: Record<LandingPageType, {
  label: string
  badgeClassName: string
}> = {
  amazon_product: {
    label: 'Amazon商品',
    badgeClassName: 'border-amber-300 bg-amber-50 text-amber-700',
  },
  amazon_store: {
    label: 'Amazon店铺',
    badgeClassName: 'border-amber-300 bg-amber-50 text-amber-700',
  },
  independent_product: {
    label: '独立站商品',
    badgeClassName: 'border-sky-300 bg-sky-50 text-sky-700',
  },
  independent_store: {
    label: '独立站店铺',
    badgeClassName: 'border-sky-300 bg-sky-50 text-sky-700',
  },
  unknown: {
    label: '其他',
    badgeClassName: 'text-muted-foreground',
  },
}

const PRODUCT_STATUS_LABEL: Record<ProductLifecycleStatus, string> = {
  active: '有效',
  invalid: '已失效(平台确认)',
  sync_missing: '同步未命中',
  unknown: '状态未知',
}

const EMPTY_NUMERIC_RANGE_FILTERS: NumericRangeFilters = {
  reviewCountMin: null,
  reviewCountMax: null,
  priceAmountMin: null,
  priceAmountMax: null,
  commissionRateMin: null,
  commissionRateMax: null,
  commissionAmountMin: null,
  commissionAmountMax: null,
  recommendationScoreMin: null,
  recommendationScoreMax: null,
}

const EMPTY_NUMERIC_RANGE_FILTER_DRAFTS: NumericRangeFilterDrafts = {
  reviewCountMin: '',
  reviewCountMax: '',
  priceAmountMin: '',
  priceAmountMax: '',
  commissionRateMin: '',
  commissionRateMax: '',
  commissionAmountMin: '',
  commissionAmountMax: '',
  recommendationScoreMin: '',
  recommendationScoreMax: '',
}

function createEmptyPlatformStatsItem(): PlatformStatsItem {
  return {
    total: 0,
    visibleCount: 0,
    productCount: 0,
    storeCount: 0,
    productsWithLinkCount: 0,
    activeProductsCount: 0,
    invalidProductsCount: 0,
    syncMissingProductsCount: 0,
    unknownProductsCount: 0,
    blacklistedCount: 0,
  }
}

function createEmptyLandingPageStats(): LandingPageStats {
  return {
    productCount: 0,
    storeCount: 0,
    unknownCount: 0,
  }
}

function createEmptyRecommendationScoreSummary(): RecommendationScoreSummary {
  return {
    effectiveCount: 0,
    lastCalculatedAt: null,
  }
}

function createEmptyPlatformStatsMap(): PlatformStatsMap {
  return {
    yeahpromos: createEmptyPlatformStatsItem(),
    partnerboost: createEmptyPlatformStatsItem(),
  }
}

function createEmptyYeahPromosSyncMonitor(): YeahPromosSyncMonitorItem {
  return {
    runId: null,
    runStatus: null,
    targetItems: null,
    fetchedItems: 0,
    remainingItems: null,
    avgItemsPerHour: null,
    etaAt: null,
    statsUpdatedAt: null,
    hourlyStats: [],
  }
}

function createEmptyYeahPromosSessionStatus(): YeahPromosSessionStatus {
  return {
    hasSession: false,
    isExpired: false,
    capturedAt: null,
    expiresAt: null,
    maskedPhpSessionId: null,
  }
}

function toSafeCount(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
}

function normalizePlatformStatsMap(value: unknown): PlatformStatsMap {
  const fallback = createEmptyPlatformStatsMap()
  if (!value || typeof value !== 'object') return fallback

  const readPlatformStats = (platform: ProductPlatform): PlatformStatsItem => {
    const raw = (value as Record<string, unknown>)[platform]
    if (!raw || typeof raw !== 'object') return createEmptyPlatformStatsItem()
    const record = raw as Record<string, unknown>

    return {
      total: toSafeCount(record.total),
      visibleCount: toSafeCount(record.visibleCount),
      productCount: toSafeCount(record.productCount),
      storeCount: toSafeCount(record.storeCount),
      productsWithLinkCount: toSafeCount(record.productsWithLinkCount),
      activeProductsCount: toSafeCount(record.activeProductsCount),
      invalidProductsCount: toSafeCount(record.invalidProductsCount),
      syncMissingProductsCount: toSafeCount(record.syncMissingProductsCount),
      unknownProductsCount: toSafeCount(record.unknownProductsCount),
      blacklistedCount: toSafeCount(record.blacklistedCount),
    }
  }

  return {
    yeahpromos: readPlatformStats('yeahpromos'),
    partnerboost: readPlatformStats('partnerboost'),
  }
}

function normalizeLandingPageStats(value: unknown): LandingPageStats {
  if (!value || typeof value !== 'object') return createEmptyLandingPageStats()
  const record = value as Record<string, unknown>
  return {
    productCount: toSafeCount(record.productCount),
    storeCount: toSafeCount(record.storeCount),
    unknownCount: toSafeCount(record.unknownCount),
  }
}

function normalizeRecommendationScoreSummary(value: unknown): RecommendationScoreSummary {
  if (!value || typeof value !== 'object') return createEmptyRecommendationScoreSummary()
  const record = value as Record<string, unknown>
  const lastCalculatedAt = typeof record.lastCalculatedAt === 'string'
    ? record.lastCalculatedAt
    : null

  return {
    effectiveCount: toSafeCount(record.effectiveCount),
    lastCalculatedAt,
  }
}

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount === null || amount === undefined) return '-'
  if (!currency) return `${amount}`
  return `${currency.toUpperCase()} ${amount}`
}

function formatPercent(rate: number | null): string {
  if (rate === null || rate === undefined) return '-'
  return `${rate}%`
}

function formatReviewCount(count: number | null): string {
  if (count === null || count === undefined) return '-'
  return String(count)
}

function formatIntegerCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  if (!Number.isFinite(value)) return '-'
  return Math.max(0, Math.trunc(value)).toLocaleString('en-US')
}

function resolveDisplayCurrency(product: ProductListItem): string | null {
  const normalizedCommissionCurrency = String(product.commissionCurrency || '').trim()
  if (normalizedCommissionCurrency) return normalizedCommissionCurrency

  const normalizedPriceCurrency = String(product.priceCurrency || '').trim()
  if (normalizedPriceCurrency) return normalizedPriceCurrency

  return null
}


function normalizeCountries(countries: string[]): string[] {
  const deduped = new Set<string>()
  for (const code of countries || []) {
    const normalized = String(code || '').trim().toUpperCase()
    if (!normalized) continue
    deduped.add(normalized)
  }
  return Array.from(deduped)
}

function defaultCountryFromProduct(product: ProductListItem): string {
  const countries = normalizeCountries(product.allowedCountries)
  if (countries.includes('US')) return 'US'
  return countries[0] || 'US'
}

function safeOpenExternal(url?: string | null): void {
  if (!url) return
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
    window.open(parsed.toString(), '_blank', 'noopener,noreferrer')
  } catch {
    // ignore invalid url
  }
}

function resolveMidTargetUrl(product: ProductListItem): string | null {
  if (product.platform !== 'partnerboost') return null

  const asin = String(product.asin || '').trim()
  if (!asin) return null

  const url = new URL(PARTNERBOOST_MERCHANT_PAGE_URL)
  url.searchParams.set('sku', asin)
  return url.toString()
}

function getSyncRunBadgeVariant(status: SyncRunItem['status']): 'default' | 'destructive' | 'outline' {
  if (status === 'completed') return 'default'
  if (status === 'failed') return 'destructive'
  return 'outline'
}

function getSyncRunStatusIcon(status: SyncRunItem['status']) {
  if (status === 'completed') return CheckCircle2
  if (status === 'failed') return AlertCircle
  return Clock3
}

function getSyncRunProcessedCount(run: SyncRunItem): number {
  const created = Number.isFinite(run.created_count) ? Math.max(0, run.created_count) : 0
  const updated = Number.isFinite(run.updated_count) ? Math.max(0, run.updated_count) : 0
  const failed = Number.isFinite(run.failed_count) ? Math.max(0, run.failed_count) : 0
  return created + updated + failed
}

function getSyncRunProgressText(run: SyncRunItem): string {
  const processed = getSyncRunProcessedCount(run)
  const total = Number.isFinite(run.total_items) ? Math.max(0, run.total_items) : 0
  if (total > 0) {
    return `已处理 ${processed}/${total}`
  }
  return `已处理 ${processed}/待统计`
}

function getSyncRunMetricsText(run: SyncRunItem): string {
  const created = Number.isFinite(run.created_count) ? Math.max(0, run.created_count) : 0
  const updated = Number.isFinite(run.updated_count) ? Math.max(0, run.updated_count) : 0
  const failed = Number.isFinite(run.failed_count) ? Math.max(0, run.failed_count) : 0
  const total = Number.isFinite(run.total_items) ? Math.max(0, run.total_items) : 0

  if ((run.status === 'queued' || run.status === 'running') && created === 0 && updated === 0 && failed === 0) {
    if (total > 0) {
      return `已抓取 ${total} 条 · 正在补全推广链接并写入数据库`
    }
    return run.status === 'queued'
      ? '任务排队中...'
      : '正在抓取商品数据...'
  }

  return `新增 ${created} · 更新 ${updated} · 失败 ${failed}`
}

function formatSyncRunDateTime(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatMonthDayTime(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

function formatHourBucket(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatProductAddedDate(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString('zh-CN')
  }
  return String(value).slice(0, 10)
}

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateInputValue(value: string): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function resolveRecentDateRange(days: number): { from: string; to: string } {
  const normalizedDays = Math.max(1, Math.floor(days))
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - (normalizedDays - 1))
  return {
    from: formatDateInputValue(start),
    to: formatDateInputValue(end),
  }
}

function getSyncRunStartedAtText(run: SyncRunItem): string {
  if (run.started_at) return formatSyncRunDateTime(run.started_at)
  if (run.status === 'queued') return '排队中（未开始）'
  return formatSyncRunDateTime(run.created_at)
}

function getProductStatusBadgeVariant(status: ProductLifecycleStatus): 'default' | 'secondary' | 'outline' {
  if (status === 'active') return 'default'
  if (status === 'invalid') return 'secondary'
  return 'outline'
}

function toBoolValue(value: boolean | 'indeterminate'): boolean {
  return value === true
}

function parseNumericRangeInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function buildNumericRangeFiltersFromDraft(drafts: NumericRangeFilterDrafts): NumericRangeFilters {
  return {
    reviewCountMin: parseNumericRangeInput(drafts.reviewCountMin),
    reviewCountMax: parseNumericRangeInput(drafts.reviewCountMax),
    priceAmountMin: parseNumericRangeInput(drafts.priceAmountMin),
    priceAmountMax: parseNumericRangeInput(drafts.priceAmountMax),
    commissionRateMin: parseNumericRangeInput(drafts.commissionRateMin),
    commissionRateMax: parseNumericRangeInput(drafts.commissionRateMax),
    commissionAmountMin: parseNumericRangeInput(drafts.commissionAmountMin),
    commissionAmountMax: parseNumericRangeInput(drafts.commissionAmountMax),
    recommendationScoreMin: parseNumericRangeInput(drafts.recommendationScoreMin),
    recommendationScoreMax: parseNumericRangeInput(drafts.recommendationScoreMax),
  }
}

function isNumericRangeFiltersEqual(a: NumericRangeFilters, b: NumericRangeFilters): boolean {
  return (
    a.reviewCountMin === b.reviewCountMin
    && a.reviewCountMax === b.reviewCountMax
    && a.priceAmountMin === b.priceAmountMin
    && a.priceAmountMax === b.priceAmountMax
    && a.commissionRateMin === b.commissionRateMin
    && a.commissionRateMax === b.commissionRateMax
    && a.commissionAmountMin === b.commissionAmountMin
    && a.commissionAmountMax === b.commissionAmountMax
    && a.recommendationScoreMin === b.recommendationScoreMin
    && a.recommendationScoreMax === b.recommendationScoreMax
  )
}

export default function ProductsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const productsRequestSeqRef = useRef(0)
  const productsAbortControllerRef = useRef<AbortController | null>(null)
  const summaryAbortControllerRef = useRef<AbortController | null>(null)
  const summaryRequestKeyRef = useRef<string | null>(null)
  const foregroundProductsRequestSeqRef = useRef<number | null>(null)
  const syncRunsInFlightRef = useRef(false)
  const periodicRefreshInFlightRef = useRef(false)
  const scorePauseInFlightRef = useRef(false)
  const [items, setItems] = useState<ProductListItem[]>([])
  const [total, setTotal] = useState(0)
  const [landingPageStats, setLandingPageStats] = useState<LandingPageStats>(() => createEmptyLandingPageStats())
  const [platformStats, setPlatformStats] = useState<PlatformStatsMap>(() => createEmptyPlatformStatsMap())
  const [recommendationScoreSummary, setRecommendationScoreSummary] = useState<RecommendationScoreSummary>(
    () => createEmptyRecommendationScoreSummary()
  )
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [searchText, setSearchText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [midText, setMidText] = useState('')
  const [midQuery, setMidQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState<'all' | ProductPlatform>('all')
  const [statusFilter, setStatusFilter] = useState<ProductStatusFilter>('all')
  const [targetCountryFilter, setTargetCountryFilter] = useState('all')
  const [landingPageTypeFilter, setLandingPageTypeFilter] = useState<LandingPageTypeFilter>('all')
  const [numericRangeDrafts, setNumericRangeDrafts] = useState<NumericRangeFilterDrafts>({
    ...EMPTY_NUMERIC_RANGE_FILTER_DRAFTS,
  })
  const [numericRangeFilters, setNumericRangeFilters] = useState<NumericRangeFilters>({
    ...EMPTY_NUMERIC_RANGE_FILTERS,
  })
  const [createdAtFrom, setCreatedAtFrom] = useState('')
  const [createdAtTo, setCreatedAtTo] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('serial')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set())

  const [syncingPlatform, setSyncingPlatform] = useState<{
    platform: ProductPlatform
    strategy: PlatformSyncStrategy
    resumeFailedRun?: boolean
  } | null>(null)
  const [latestRuns, setLatestRuns] = useState<SyncRunItem[]>([])
  const [ypSyncMonitor, setYpSyncMonitor] = useState<YeahPromosSyncMonitorItem>(() => createEmptyYeahPromosSyncMonitor())
  const [syncingProductId, setSyncingProductId] = useState<number | null>(null)
  const [creatingOfferId, setCreatingOfferId] = useState<number | null>(null)
  const [offliningProductId, setOffliningProductId] = useState<number | null>(null)
  const [batchCreating, setBatchCreating] = useState(false)
  const [batchOfflining, setBatchOfflining] = useState(false)
  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const [singleOfflineDialogOpen, setSingleOfflineDialogOpen] = useState(false)
  const [batchOfflineDialogOpen, setBatchOfflineDialogOpen] = useState(false)
  const [createOfferDialogOpen, setCreateOfferDialogOpen] = useState(false)
  const [calculatingScores, setCalculatingScores] = useState(false)
  const [scoreCalculationPaused, setScoreCalculationPaused] = useState(false)
  const [scorePauseUpdating, setScorePauseUpdating] = useState(false)
  const [calculateScoresConfirmOpen, setCalculateScoresConfirmOpen] = useState(false)
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [ypSessionStatusLoading, setYpSessionStatusLoading] = useState(false)
  const [ypSessionStatus, setYpSessionStatus] = useState<YeahPromosSessionStatus>(() => createEmptyYeahPromosSessionStatus())
  const [ypCaptureDialogOpen, setYpCaptureDialogOpen] = useState(false)
  const [ypPreparingCapture, setYpPreparingCapture] = useState(false)
  const [ypSessionStatusWhenDialogOpened, setYpSessionStatusWhenDialogOpened] = useState(false)

  const [batchRows, setBatchRows] = useState<BatchRow[]>([])
  const [offlineProduct, setOfflineProduct] = useState<ProductListItem | null>(null)
  const [pendingCreateOfferProduct, setPendingCreateOfferProduct] = useState<ProductListItem | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const selectedProducts = useMemo(() => {
    const selected = new Set(selectedProductIds)
    return items.filter((item) => selected.has(item.id))
  }, [items, selectedProductIds])

  const recommendationScoreCoveragePercent = useMemo(() => {
    if (total <= 0) return 0
    const ratio = (recommendationScoreSummary.effectiveCount / total) * 100
    if (!Number.isFinite(ratio) || ratio < 0) return 0
    return Math.min(100, ratio)
  }, [recommendationScoreSummary.effectiveCount, total])

  const creatableSelectedProducts = useMemo(
    () => selectedProducts.filter((item) => !item.isBlacklisted),
    [selectedProducts]
  )

  const canBatchCreate = creatableSelectedProducts.length > 0
  const canBatchOffline = selectedProducts.length > 0
  const hasFilters = searchQuery.length > 0
    || midQuery.length > 0
    || platformFilter !== 'all'
    || statusFilter !== 'all'
    || targetCountryFilter !== 'all'
    || landingPageTypeFilter !== 'all'
    || createdAtFrom.length > 0
    || createdAtTo.length > 0
    || Object.values(numericRangeFilters).some((value) => value !== null)

  const numericRangeFilterCards: Array<{
    label: string
    minKey: keyof NumericRangeFilterDrafts
    maxKey: keyof NumericRangeFilterDrafts
    minPlaceholder: string
    maxPlaceholder: string
  }> = [
    {
      label: '商品评论数',
      minKey: 'reviewCountMin',
      maxKey: 'reviewCountMax',
      minPlaceholder: '最小值',
      maxPlaceholder: '最大值',
    },
    {
      label: '商品价格',
      minKey: 'priceAmountMin',
      maxKey: 'priceAmountMax',
      minPlaceholder: '最低价',
      maxPlaceholder: '最高价',
    },
    {
      label: '佣金比例(%)',
      minKey: 'commissionRateMin',
      maxKey: 'commissionRateMax',
      minPlaceholder: '最小比例',
      maxPlaceholder: '最大比例',
    },
    {
      label: '佣金金额',
      minKey: 'commissionAmountMin',
      maxKey: 'commissionAmountMax',
      minPlaceholder: '最小金额',
      maxPlaceholder: '最大金额',
    },
    {
      label: '推荐指数',
      minKey: 'recommendationScoreMin',
      maxKey: 'recommendationScoreMax',
      minPlaceholder: '最低星级',
      maxPlaceholder: '最高星级',
    },
  ]

  const createdDateQuickFilters: Array<{ key: string; label: string; days: number }> = [
    { key: 'today', label: '今天', days: 1 },
    { key: '7d', label: '过去7天（含当天）', days: 7 },
    { key: '30d', label: '过去30天（含当天）', days: 30 },
    { key: '90d', label: '过去90天（含当天）', days: 90 },
  ]
  const isCreatedDateCustomActive = Boolean(createdAtFrom || createdAtTo)
    && !createdDateQuickFilters.some((filter) => {
      const range = resolveRecentDateRange(filter.days)
      return createdAtFrom === range.from && createdAtTo === range.to
    })
  const createdDateRangeValue = useMemo<DateRange | undefined>(() => {
    const from = parseDateInputValue(createdAtFrom)
    const to = parseDateInputValue(createdAtTo)
    if (!from || !to) return undefined
    return { from, to }
  }, [createdAtFrom, createdAtTo])

  const syncHistoryRows = useMemo(() => {
    const rows: Array<{
      key: string
      label: string
      runs: SyncRunItem[]
      emptyText: string
    }> = [
      {
        key: 'light',
        label: '快速刷新任务',
        runs: latestRuns.filter((run) => run.mode === 'delta').slice(0, 4),
        emptyText: '暂无快速刷新历史任务',
      },
      {
        key: 'full',
        label: '全量补齐任务',
        runs: latestRuns.filter((run) => run.mode === 'platform').slice(0, 4),
        emptyText: '暂无全量补齐历史任务',
      },
    ]
    return rows
  }, [latestRuns])
  const hasActiveSyncRuns = useMemo(
    () => latestRuns.some((run) => run.status === 'queued' || run.status === 'running'),
    [latestRuns]
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchText.trim())
      setPage(1)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [searchText])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMidQuery(midText.trim())
      setPage(1)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [midText])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextFilters = buildNumericRangeFiltersFromDraft(numericRangeDrafts)
      if (isNumericRangeFiltersEqual(nextFilters, numericRangeFilters)) {
        return
      }
      setNumericRangeFilters(nextFilters)
      setPage(1)
    }, 350)

    return () => window.clearTimeout(timer)
  }, [numericRangeDrafts, numericRangeFilters])

  const fetchProducts = async (options: {
    forceNoCache?: boolean
    silent?: boolean
    suppressErrorToast?: boolean
  } = {}) => {
    const { forceNoCache = false, silent = false, suppressErrorToast = false } = options
    const shouldRefreshSummary = !silent
    // 后台静默刷新不应打断前台显式加载（筛选/排序/分页），否则会导致 loading 无法收敛。
    if (silent && foregroundProductsRequestSeqRef.current !== null) {
      return
    }

    const requestSeq = productsRequestSeqRef.current + 1
    productsRequestSeqRef.current = requestSeq
    productsAbortControllerRef.current?.abort()
    if (shouldRefreshSummary) {
      summaryAbortControllerRef.current?.abort()
      summaryRequestKeyRef.current = null
    }
    const controller = new AbortController()
    productsAbortControllerRef.current = controller
    if (shouldRefreshSummary) {
      summaryAbortControllerRef.current = null
    }

    if (!silent) {
      foregroundProductsRequestSeqRef.current = requestSeq
      setLoading(true)
    }
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      params.set('sortBy', sortBy)
      params.set('sortOrder', sortOrder)
      if (searchQuery) params.set('search', searchQuery)
      if (midQuery) params.set('mid', midQuery)
      if (platformFilter !== 'all') params.set('platform', platformFilter)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (targetCountryFilter !== 'all') params.set('targetCountry', targetCountryFilter)
      if (landingPageTypeFilter !== 'all') params.set('landingPageType', landingPageTypeFilter)
      if (createdAtFrom) params.set('createdAtFrom', createdAtFrom)
      if (createdAtTo) params.set('createdAtTo', createdAtTo)

      const numericRangeParams: Array<[string, number | null]> = [
        ['reviewCountMin', numericRangeFilters.reviewCountMin],
        ['reviewCountMax', numericRangeFilters.reviewCountMax],
        ['priceAmountMin', numericRangeFilters.priceAmountMin],
        ['priceAmountMax', numericRangeFilters.priceAmountMax],
        ['commissionRateMin', numericRangeFilters.commissionRateMin],
        ['commissionRateMax', numericRangeFilters.commissionRateMax],
        ['commissionAmountMin', numericRangeFilters.commissionAmountMin],
        ['commissionAmountMax', numericRangeFilters.commissionAmountMax],
        ['recommendationScoreMin', numericRangeFilters.recommendationScoreMin],
        ['recommendationScoreMax', numericRangeFilters.recommendationScoreMax],
      ]
      for (const [key, value] of numericRangeParams) {
        if (value === null) continue
        params.set(key, String(value))
      }

      if (forceNoCache) params.set('noCache', 'true')

      const response = await fetch(`/api/products?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      })

      if (response.status === 401) {
        router.push('/login')
        return
      }

      const data = await response.json() as ProductListResponse
      if (!response.ok || !data.success) {
        throw new Error((data as any)?.error || '加载商品列表失败')
      }

      if (requestSeq !== productsRequestSeqRef.current) {
        return
      }

      const nextTotal = Number(data.total || 0)
      const nextLandingPageStats = normalizeLandingPageStats(data.landingPageStats)
      const nextPlatformStats = normalizePlatformStatsMap(data.platformStats)
      const shouldBackfillLandingSummary = (
        nextTotal > 0
        && nextLandingPageStats.productCount === 0
        && nextLandingPageStats.storeCount === 0
        && nextLandingPageStats.unknownCount >= nextTotal
      )

      setItems(data.items || [])
      setTotal(nextTotal)
      if (!shouldBackfillLandingSummary) {
        setLandingPageStats(nextLandingPageStats)
      }
      setPlatformStats(nextPlatformStats)

      setSelectedProductIds((prev) => {
        if (prev.size === 0) return prev
        const available = new Set((data.items || []).map((item) => item.id))
        const next = new Set<number>()
        prev.forEach((id) => {
          if (available.has(id)) next.add(id)
        })
        return next
      })

      if (shouldRefreshSummary) {
        const summaryRequestKey = params.toString()
        const summaryController = new AbortController()
        summaryAbortControllerRef.current = summaryController
        summaryRequestKeyRef.current = summaryRequestKey
        void (async () => {
          try {
            const summaryResponse = await fetch(`/api/products/summary?${summaryRequestKey}`, {
              credentials: 'include',
              cache: 'no-store',
              signal: summaryController.signal,
            })

            if (summaryResponse.status === 401) {
              router.push('/login')
              return
            }

            const summaryData = await summaryResponse.json() as ProductSummaryResponse
            if (!summaryResponse.ok || !summaryData.success) return
            if (summaryRequestKeyRef.current !== summaryRequestKey) return

            setRecommendationScoreSummary(normalizeRecommendationScoreSummary(summaryData.recommendationScoreSummary))
            setLandingPageStats(normalizeLandingPageStats(summaryData.landingPageStats))
            setPlatformStats(normalizePlatformStatsMap(summaryData.platformStats))
          } catch (summaryError: any) {
            if (summaryError?.name === 'AbortError') {
              return
            }
          } finally {
            if (summaryAbortControllerRef.current === summaryController) {
              summaryAbortControllerRef.current = null
            }
          }
        })()
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return
      }
      if (!suppressErrorToast) {
        showError('加载失败', error?.message || '加载商品列表失败')
      }
    } finally {
      if (!silent && foregroundProductsRequestSeqRef.current === requestSeq) {
        foregroundProductsRequestSeqRef.current = null
        setLoading(false)
      }
      if (productsAbortControllerRef.current === controller) {
        productsAbortControllerRef.current = null
      }
    }
  }

  const fetchSyncRuns = async () => {
    if (syncRunsInFlightRef.current) return
    syncRunsInFlightRef.current = true
    try {
      const response = await fetch('/api/products/sync-runs?limit=20', {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!response.ok) return
      const data = await response.json() as {
        success?: boolean
        runs?: SyncRunItem[]
        ypMonitor?: YeahPromosSyncMonitorItem
      }
      if (!data.success) return
      setLatestRuns(data.runs || [])
      setYpSyncMonitor(data.ypMonitor || createEmptyYeahPromosSyncMonitor())
    } catch {
      // ignore
    } finally {
      syncRunsInFlightRef.current = false
    }
  }

  const loadScoreCalculationPauseStatus = async () => {
    if (scorePauseInFlightRef.current) return

    scorePauseInFlightRef.current = true
    try {
      const response = await fetch('/api/products/calculate-scores/pause', {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!response.ok) return

      const data = await response.json().catch(() => ({})) as {
        success?: boolean
        paused?: boolean
      }
      if (!data.success) return

      setScoreCalculationPaused(Boolean(data.paused))
    } catch {
      // ignore
    } finally {
      scorePauseInFlightRef.current = false
    }
  }

  const loadYeahPromosSessionStatus = async () => {
    if (ypSessionStatusLoading) return
    setYpSessionStatusLoading(true)
    try {
      const response = await fetch('/api/products/yeahpromos/session/status', {
        credentials: 'include',
        cache: 'no-store',
      })
      if (response.status === 401) {
        router.push('/login')
        return
      }
      const data = await response.json().catch(() => ({})) as YeahPromosSessionStatusResponse
      if (!response.ok || !data.success || !data.session) {
        throw new Error(data.error || '加载YP登录态失败')
      }

      setYpSessionStatus(data.session)
    } catch (error: any) {
      showError('加载失败', error?.message || '加载YP登录态失败')
    } finally {
      setYpSessionStatusLoading(false)
    }
  }

  const handlePrepareYeahPromosCapture = async () => {
    if (ypPreparingCapture) return
    setYpPreparingCapture(true)

    // 🔥 修复：在用户点击时立即打开空白窗口，避免被浏览器弹窗拦截器阻止
    // 这个窗口引用会在API返回后更新URL
    let newWindow: Window | null = null
    try {
      newWindow = window.open('about:blank', '_blank')
      console.log('[YP采集] 空白窗口已打开:', newWindow ? '成功' : '失败')
    } catch (error) {
      console.warn('[YP采集] 无法打开新窗口，可能被浏览器拦截:', error)
    }

    try {
      console.log('[YP采集] 开始调用API...')
      const response = await fetch('/api/products/yeahpromos/session/request-capture', {
        method: 'POST',
        credentials: 'include',
      })
      console.log('[YP采集] API响应状态:', response.status)

      if (response.status === 401) {
        console.log('[YP采集] 未授权，跳转登录')
        router.push('/login')
        newWindow?.close()
        return
      }

      const data = await response.json().catch(() => ({})) as Partial<YeahPromosCapturePrepareResponse>
      console.log('[YP采集] API返回数据:', {
        success: data.success,
        hasBookmarklet: !!data.bookmarklet,
        hasLoginUrl: !!data.loginUrl
      })

      if (!response.ok || !data.success || !data.bookmarklet || !data.loginUrl) {
        console.error('[YP采集] 数据验证失败:', {
          responseOk: response.ok,
          dataSuccess: data.success,
          hasBookmarklet: !!data.bookmarklet,
          hasLoginUrl: !!data.loginUrl
        })
        newWindow?.close()
        throw new Error(data.error || '生成YP登录态采集脚本失败')
      }

      console.log('[YP采集] 设置Dialog状态...')
      setYpSessionStatusWhenDialogOpened(ypSessionStatus.hasSession) // 记录打开时的登录态状态
      setYpCaptureDialogOpen(true)
      console.log('[YP采集] Dialog状态已设置为true')

      // 🔥 修复：更新已打开窗口的URL，而不是重新打开
      console.log('[YP采集] 更新窗口URL...')
      if (newWindow && !newWindow.closed) {
        try {
          newWindow.location.href = data.loginUrl
          console.log('[YP采集] 窗口URL已更新')
        } catch (error) {
          console.warn('[YP采集] 无法更新窗口URL，尝试重新打开:', error)
          newWindow.close()
          safeOpenExternal(data.loginUrl)
        }
      } else {
        console.log('[YP采集] 窗口已关闭或未打开，直接打开新窗口')
        // 如果窗口打开失败或被关闭，尝试直接打开
        safeOpenExternal(data.loginUrl)
      }

      showSuccess('请完成登录', '已打开YP登录页。登录后请优先使用浏览器扩展回传登录态；书签脚本可在弹窗中按备用流程执行。')
      console.log('[YP采集] 流程完成')
    } catch (error: any) {
      console.error('[YP采集] 错误:', error)
      showError('准备失败', error?.message || '生成YP登录态采集脚本失败')
    } finally {
      setYpPreparingCapture(false)
      console.log('[YP采集] 清理完成')
    }
  }

  useEffect(() => {
    fetchProducts()
    fetchSyncRuns()
  }, [page, pageSize, searchQuery, midQuery, platformFilter, statusFilter, targetCountryFilter, landingPageTypeFilter, numericRangeFilters, createdAtFrom, createdAtTo, sortBy, sortOrder])

  useEffect(() => {
    if (!hasActiveSyncRuns) return

    const timer = window.setInterval(() => {
      if (periodicRefreshInFlightRef.current) return
      periodicRefreshInFlightRef.current = true
      const tasks: Array<Promise<void>> = [fetchSyncRuns()]
      // 用户正在筛选时固定结果集，避免被后台同步过程中的数据波动干扰。
      if (!hasFilters) {
        tasks.push(fetchProducts({ forceNoCache: true, silent: true, suppressErrorToast: true }))
      }
      Promise.all(tasks).finally(() => {
        periodicRefreshInFlightRef.current = false
      })
    }, 8000)

    return () => window.clearInterval(timer)
  }, [hasActiveSyncRuns, hasFilters])

  useEffect(() => {
    loadYeahPromosSessionStatus()
  }, [])

  useEffect(() => {
    loadScoreCalculationPauseStatus()
  }, [])

  // 🔥 调试：监控Dialog状态变化
  useEffect(() => {
    console.log('[YP采集] Dialog状态变化:', ypCaptureDialogOpen)
  }, [ypCaptureDialogOpen])

  useEffect(() => {
    if (!ypCaptureDialogOpen) return

    const timer = window.setInterval(() => {
      loadYeahPromosSessionStatus()
    }, 6000)

    return () => window.clearInterval(timer)
  }, [ypCaptureDialogOpen])

  // 🔥 修复：只有在Dialog打开期间登录态从无到有时才自动关闭
  // 避免在Dialog刚打开时就因为已有登录态而立即关闭
  useEffect(() => {
    if (!ypCaptureDialogOpen) return
    if (!ypSessionStatus.hasSession) return

    // 只有当打开Dialog时没有登录态，现在有了登录态，才自动关闭
    if (!ypSessionStatusWhenDialogOpened && ypSessionStatus.hasSession) {
      showSuccess('登录态已就绪', 'YP 登录态回传成功，现在可以执行 YP 同步')
      setYpCaptureDialogOpen(false)
    }
  }, [ypCaptureDialogOpen, ypSessionStatus.hasSession, ypSessionStatusWhenDialogOpened])

  const handleSort = (field: string) => {
    const target = field as SortField
    if (sortBy === target) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
      return
    }
    setSortBy(target)
    setSortOrder('desc')
  }

  const updateNumericRangeDraft = (key: keyof NumericRangeFilterDrafts, value: string) => {
    setNumericRangeDrafts((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const applyCreatedDateQuickFilter = (days: number) => {
    const range = resolveRecentDateRange(days)
    setCreatedAtFrom(range.from)
    setCreatedAtTo(range.to)
    setPage(1)
  }

  const handleCreatedDateRangeChange = (range: DateRange | undefined) => {
    if (!range?.from || !range?.to) {
      setCreatedAtFrom('')
      setCreatedAtTo('')
      setPage(1)
      return
    }

    const nextFrom = formatDateInputValue(range.from)
    const nextTo = formatDateInputValue(range.to)
    if (nextFrom > nextTo) {
      showError('时间范围无效', '结束日期不能早于开始日期')
      return
    }

    setCreatedAtFrom(nextFrom)
    setCreatedAtTo(nextTo)
    setPage(1)
  }

  const clearCreatedDateFilter = () => {
    setCreatedAtFrom('')
    setCreatedAtTo('')
    setPage(1)
  }

  const handleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedProductIds(new Set())
      return
    }
    setSelectedProductIds(new Set(items.map((item) => item.id)))
  }

  const toggleSelect = (id: number, checked: boolean) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  const handlePlatformSync = async (
    platform: ProductPlatform,
    strategy?: PlatformSyncStrategy,
    options?: PlatformSyncOptions
  ) => {
    if (syncingPlatform) return
    const resolvedStrategy: PlatformSyncStrategy = strategy || getDefaultPlatformSyncStrategy(platform)
    const resumeFailedRun = resolvedStrategy === 'full'
      ? Boolean(options?.resumeFailedRun)
      : undefined
    setSyncingPlatform({ platform, strategy: resolvedStrategy, resumeFailedRun })
    try {
      const requestBody: Record<string, unknown> = {
        strategy: resolvedStrategy,
      }
      if (resolvedStrategy === 'full') {
        requestBody.resumeFailedRun = resumeFailedRun
      }
      const response = await fetch(`/api/products/sync/${platform}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data?.code === 'CONFIG_REQUIRED') {
          showError('请先配置平台', data?.error || '请先完成联盟平台配置')
          router.push('/settings?category=affiliate_sync')
          return
        }
        if (data?.code === 'YP_SESSION_REQUIRED') {
          showError('请先采集登录态', data?.error || '请先完成 YeahPromos 登录态采集')
          setYpCaptureDialogOpen(true)
          void loadYeahPromosSessionStatus()
          return
        }
        throw new Error(data?.error || '提交同步任务失败')
      }

      const strategyLabel = getPlatformSyncActionLabel(resolvedStrategy, { resumeFailedRun })
      showSuccess('任务已提交', `${PLATFORM_LABEL[platform]} ${strategyLabel}已加入队列`)
      setTimeout(() => {
        fetchProducts({ forceNoCache: true, silent: true, suppressErrorToast: true })
        fetchSyncRuns()
      }, 1200)
    } catch (error: any) {
      showError('提交失败', error?.message || '提交同步任务失败')
    } finally {
      setSyncingPlatform(null)
    }
  }

  const handleProductSync = async (product: ProductListItem) => {
    if (syncingProductId) return
    setSyncingProductId(product.id)
    try {
      const response = await fetch(`/api/products/${product.id}/sync`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data?.code === 'CONFIG_REQUIRED') {
          showError('请先配置平台', data?.error || '请先完成联盟平台配置')
          router.push('/settings?category=affiliate_sync')
          return
        }
        throw new Error(data?.error || '提交单商品同步失败')
      }

      showSuccess('任务已提交', '单商品同步已加入队列')
      setTimeout(() => {
        fetchProducts({ forceNoCache: true, silent: true, suppressErrorToast: true })
        fetchSyncRuns()
      }, 1000)
    } catch (error: any) {
      showError('提交失败', error?.message || '提交单商品同步失败')
    } finally {
      setSyncingProductId(null)
    }
  }

  const handleCalculateScores = async () => {
    if (calculatingScores) return
    const selectedIds = selectedProducts
      .map((item) => Number(item.id))
      .filter((id) => Number.isFinite(id) && id > 0)

    if (scoreCalculationPaused && selectedIds.length === 0) {
      showError('已暂停计算', '全局暂停时请先勾选要重算的商品（不支持全量提交）')
      return
    }

    setCalculatingScores(true)
    try {
      const payload: {
        productIds?: number[]
        forceRecalculate: boolean
        allowWhenPaused: boolean
        batchSize: number
        includeSeasonalityAnalysis: boolean
      } = {
        forceRecalculate: false,
        allowWhenPaused: scoreCalculationPaused,
        batchSize: 200,
        includeSeasonalityAnalysis: true,
      }
      if (selectedIds.length > 0) {
        payload.productIds = selectedIds
      }

      const response = await fetch('/api/products/calculate-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data?.success) {
        if (data?.code === 'PRODUCT_SCORE_CALCULATION_PAUSED') {
          setScoreCalculationPaused(true)
        }
        throw new Error(data?.error || data?.details || '提交推荐指数计算任务失败')
      }

      if (selectedIds.length > 0) {
        showSuccess(
          '任务已提交',
          scoreCalculationPaused
            ? `已提交 ${selectedIds.length} 个商品的手动重算（全局暂停中，不影响自动调度状态）`
            : `已提交 ${selectedIds.length} 个商品的推荐指数计算（默认跳过已算分且未过期商品）`
        )
      } else {
        showSuccess('任务已提交', '已提交增量推荐指数计算（默认跳过已算分且未过期商品）')
      }

      setTimeout(() => {
        fetchProducts({ forceNoCache: true, silent: true, suppressErrorToast: true })
        fetchSyncRuns()
      }, 1200)
    } catch (error: any) {
      showError('提交失败', error?.message || '提交推荐指数计算任务失败')
    } finally {
      setCalculatingScores(false)
    }
  }

  const handleToggleScoreCalculationPause = async () => {
    if (scorePauseUpdating) return

    const targetPaused = !scoreCalculationPaused
    setScorePauseUpdating(true)
    try {
      const response = await fetch('/api/products/calculate-scores/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paused: targetPaused }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || data?.details || '更新暂停状态失败')
      }

      const paused = Boolean(data.paused)
      setScoreCalculationPaused(paused)
      if (paused) {
        setCalculateScoresConfirmOpen(false)
      }

      showSuccess(
        paused ? '已暂停计算' : '已恢复计算',
        paused
          ? '后续推荐指数任务将停止调度与续跑'
          : '可以继续提交推荐指数计算任务'
      )
    } catch (error: any) {
      showError('操作失败', error?.message || '更新暂停状态失败')
    } finally {
      setScorePauseUpdating(false)
    }
  }

  const handleCreateOffer = async (product: ProductListItem, targetCountry?: string): Promise<boolean> => {
    setCreatingOfferId(product.id)
    try {
      const response = await fetch(`/api/products/${product.id}/create-offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ targetCountry }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '创建Offer失败')
      }

      if (data?.taskId) {
        showSuccess('创建成功', `Offer #${data.offerId} 已创建并加入完整处理队列`)
      } else {
        showSuccess('创建成功', `Offer #${data.offerId} 已创建`)
      }
      fetchProducts({ forceNoCache: true, silent: true })
      return true
    } catch (error: any) {
      showError('创建失败', error?.message || '创建Offer失败')
      return false
    } finally {
      setCreatingOfferId(null)
    }
  }

  const openCreateOfferDialog = (product: ProductListItem) => {
    if (creatingOfferId !== null || !product.promoLink || product.isBlacklisted) return
    setPendingCreateOfferProduct(product)
    setCreateOfferDialogOpen(true)
  }

  const submitCreateOffer = async () => {
    if (!pendingCreateOfferProduct || creatingOfferId !== null) return

    const created = await handleCreateOffer(pendingCreateOfferProduct)
    if (created) {
      setCreateOfferDialogOpen(false)
      setPendingCreateOfferProduct(null)
    }
  }

  const openSingleOfflineDialog = (product: ProductListItem) => {
    if (offliningProductId !== null || product.isBlacklisted) return
    setOfflineProduct(product)
    setSingleOfflineDialogOpen(true)
  }

  const submitSingleOffline = async () => {
    if (!offlineProduct || offliningProductId !== null) return

    setOffliningProductId(offlineProduct.id)
    try {
      const response = await fetch(`/api/products/${offlineProduct.id}/offline`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || '手动下线商品失败')
      }

      showSuccess('商品已手动下线', `已删除 ${data?.deletedOfferCount || 0} 个关联Offer`)
      setSingleOfflineDialogOpen(false)
      setOfflineProduct(null)
      setSelectedProductIds((prev) => {
        const next = new Set(prev)
        next.delete(offlineProduct.id)
        return next
      })
      fetchProducts({ forceNoCache: true, silent: true })
    } catch (error: any) {
      showError('手动下线失败', error?.message || '手动下线商品失败')
    } finally {
      setOffliningProductId(null)
    }
  }

  const openBatchOfflineConfirm = () => {
    if (!canBatchOffline || batchOfflining) return
    setBatchOfflineDialogOpen(true)
  }

  const submitBatchOffline = async () => {
    if (!canBatchOffline || batchOfflining) return

    setBatchOfflining(true)
    try {
      const response = await fetch('/api/products/batch-offline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          productIds: selectedProducts.map((item) => item.id),
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '批量手动下线商品失败')
      }

      const total = Number(data?.total || 0)
      const successCount = Number(data?.successCount || 0)
      const failureCount = Number(data?.failureCount || 0)

      showSuccess('批量手动下线完成', `成功 ${successCount} / ${total}`)
      if (failureCount > 0) {
        showError('部分商品手动下线失败', `${failureCount} 个商品手动下线失败，请稍后重试`)
      }

      const failedIds = new Set<number>(
        Array.isArray(data?.results)
          ? data.results.filter((item: any) => !item?.success).map((item: any) => Number(item?.productId)).filter((id: number) => Number.isFinite(id) && id > 0)
          : []
      )

      setSelectedProductIds(failedIds)
      setBatchOfflineDialogOpen(false)
      fetchProducts({ forceNoCache: true, silent: true })
    } catch (error: any) {
      showError('批量手动下线失败', error?.message || '批量手动下线商品失败')
    } finally {
      setBatchOfflining(false)
    }
  }

  const openBatchDialog = () => {
    if (!canBatchCreate) return
    const rows: BatchRow[] = creatableSelectedProducts.map((product) => {
      const displayCurrency = resolveDisplayCurrency(product)

      return {
        productId: product.id,
        linkType: '单品',
        promoLink: product.promoLink || '',
        targetCountry: defaultCountryFromProduct(product),
        availableCountries: normalizeCountries(product.allowedCountries),
        productPrice: formatCurrency(product.priceAmount, product.priceCurrency || displayCurrency),
        commissionRate: product.commissionRateMode === 'amount'
          ? formatCurrency(product.commissionRate, displayCurrency)
          : formatPercent(product.commissionRate),
      }
    })
    setBatchRows(rows)
    setBatchDialogOpen(true)
  }

  const openClearAllDialog = () => {
    if (clearingAll) return
    setClearAllConfirmOpen(true)
  }

  const submitClearAll = async () => {
    if (clearingAll) return

    setClearingAll(true)
    try {
      const response = await fetch('/api/products/clear', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || '清空商品失败')
      }

      const deletedCount = Number(data?.deletedCount || 0)
      showSuccess('清空完成', `已清空 ${deletedCount} 条商品数据`)

      setClearAllConfirmOpen(false)
      setSelectedProductIds(new Set())
      setPage(1)
      setItems([])
      setTotal(0)
      setPlatformStats(createEmptyPlatformStatsMap())
      void fetchProducts({ forceNoCache: true, silent: true })
      void fetchSyncRuns()
    } catch (error: any) {
      showError('清空失败', error?.message || '清空商品失败')
    } finally {
      setClearingAll(false)
    }
  }

  const updateBatchRowCountry = (productId: number, country: string) => {
    setBatchRows((prev) => prev.map((row) => {
      if (row.productId !== productId) return row
      return { ...row, targetCountry: country }
    }))
  }

  const submitBatchCreate = async () => {
    if (batchRows.length === 0 || batchCreating) return

    setBatchCreating(true)
    try {
      const payload = {
        items: batchRows.map((row) => ({
          productId: row.productId,
          targetCountry: row.targetCountry,
        })),
      }

      const response = await fetch('/api/products/batch-create-offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '批量创建Offer失败')
      }

      const queuedCount = Array.isArray(data?.results)
        ? data.results.filter((item: any) => item?.success && item?.taskId).length
        : 0

      showSuccess(
        '批量创建完成',
        queuedCount > 0
          ? `成功 ${data.successCount} / ${data.total}，已入队完整流程 ${queuedCount} 条`
          : `成功 ${data.successCount} / ${data.total}`
      )
      setBatchDialogOpen(false)
      setSelectedProductIds(new Set())
      fetchProducts({ forceNoCache: true, silent: true })
    } catch (error: any) {
      showError('批量创建失败', error?.message || '批量创建Offer失败')
    } finally {
      setBatchCreating(false)
    }
  }

  const renderProductTable = () => (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="table-fixed min-w-[2000px] [&_thead_th]:bg-white">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[42px] whitespace-nowrap">
              <Checkbox
                checked={items.length > 0 && items.every((item) => selectedProductIds.has(item.id))}
                onCheckedChange={(value) => handleSelectAll(toBoolValue(value))}
                aria-label="全选"
              />
            </TableHead>
            <TableHead className="w-[68px] whitespace-nowrap">序号</TableHead>
            <SortableTableHead field="serial" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[150px] whitespace-nowrap">
              主键ID（非连续）
            </SortableTableHead>
            <SortableTableHead field="platform" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[96px] whitespace-nowrap">
              联盟平台
            </SortableTableHead>
            <TableHead className="w-[108px] whitespace-nowrap">状态</TableHead>
            <TableHead className="w-[140px] whitespace-nowrap">MID</TableHead>
            <TableHead className="w-[136px] whitespace-nowrap">品牌名</TableHead>
            <SortableTableHead field="asin" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[122px] whitespace-nowrap">
              <span className="inline-flex items-center gap-1">
                ASIN
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex items-center text-muted-foreground"
                        onClick={(event) => event.stopPropagation()}
                        aria-label="ASIN说明"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs leading-5">
                      <div>Amazon 商品唯一标识</div>
                      <div>PB: 通常有值；YP: 通常为空</div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </span>
            </SortableTableHead>
            <TableHead className="w-[146px] whitespace-nowrap">落地页类型</TableHead>
            <SortableTableHead field="reviewCount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[114px] whitespace-nowrap">
              商品评论数
            </SortableTableHead>
            <SortableTableHead field="recommendationScore" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[120px] whitespace-nowrap">
              推荐指数
            </SortableTableHead>
            <SortableTableHead field="allowedCountries" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[128px] whitespace-nowrap">
              允许投放国家
            </SortableTableHead>
            <SortableTableHead field="priceAmount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[108px] whitespace-nowrap">
              商品价格
            </SortableTableHead>
            <SortableTableHead field="commissionRate" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[104px] whitespace-nowrap">
              佣金比例
            </SortableTableHead>
            <SortableTableHead field="commissionAmount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[108px] whitespace-nowrap">
              佣金金额
            </SortableTableHead>
            <SortableTableHead field="promoLink" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[102px] whitespace-nowrap">
              推广链接
            </SortableTableHead>
            <SortableTableHead field="relatedOfferCount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[172px] whitespace-nowrap">
              Offer数量（投放中/历史）
            </SortableTableHead>
            <SortableTableHead field="createdAt" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[118px] whitespace-nowrap">
              添加日期
            </SortableTableHead>
            <TableHead className="w-[118px] whitespace-nowrap">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const selected = selectedProductIds.has(item.id)
            const promoLink = item.promoLink || item.shortPromoLink
            const midTargetUrl = resolveMidTargetUrl(item)
            const merchantIdText = item.merchantId || '-'
            const asinText = item.asin || '-'
            const landingPageTypeMeta = LANDING_PAGE_TYPE_META[item.landingPageType] || LANDING_PAGE_TYPE_META.unknown
            const brandText = item.brand || '-'
            const allowedCountriesText = item.allowedCountries.length > 0 ? item.allowedCountries.join(', ') : '-'
            const displayCurrency = resolveDisplayCurrency(item)
            const priceText = formatCurrency(item.priceAmount, item.priceCurrency || displayCurrency)
            const commissionAmountText = formatCurrency(item.commissionAmount, displayCurrency)
            const commissionRateText = item.commissionRateMode === 'amount'
              ? formatCurrency(item.commissionRate, displayCurrency)
              : formatPercent(item.commissionRate)
            const reviewCountText = formatReviewCount(item.reviewCount)
            const relatedOfferCountText = `${Math.max(0, Number(item.activeOfferCount || 0))}/${Math.max(0, Number(item.historicalOfferCount || 0))}`
            const createdAtDateText = formatProductAddedDate(item.createdAt)
            const createdAtDateTimeText = formatSyncRunDateTime(item.createdAt)

            return (
              <TableRow key={item.id} className={`hover:bg-gray-50/50 ${item.isBlacklisted ? 'bg-gray-100' : ''}`}>
                <TableCell>
                  <Checkbox
                    checked={selected}
                    onCheckedChange={(value) => toggleSelect(item.id, toBoolValue(value))}
                    aria-label={`选择商品 ${item.id}`}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  <div className={`max-w-[54px] truncate ${item.isBlacklisted ? 'opacity-50' : ''}`} title={String(item.serial)}>
                    {item.serial}
                  </div>
                </TableCell>
                <TableCell className="font-medium">
                  <div className={`max-w-[138px] truncate ${item.isBlacklisted ? 'opacity-50' : ''}`} title={String(item.id)}>
                    {item.id}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={item.isBlacklisted ? 'opacity-50' : ''}>
                    <Badge variant="outline">{PLATFORM_SHORT_LABEL[item.platform]}</Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <div className={item.isBlacklisted ? 'opacity-50' : ''}>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={getProductStatusBadgeVariant(item.productStatus)}>
                        {PRODUCT_STATUS_LABEL[item.productStatus]}
                      </Badge>
                      {item.productStatus === 'invalid' && !item.isBlacklisted && (
                        <Badge variant="destructive" className="font-medium">
                          风险识别
                        </Badge>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`${item.isBlacklisted ? 'opacity-50' : ''}`}>
                    {midTargetUrl && merchantIdText !== '-' ? (
                      <button
                        type="button"
                        className="inline-flex max-w-[132px] items-center gap-1 truncate font-medium text-blue-600 hover:underline"
                        onClick={() => safeOpenExternal(midTargetUrl)}
                        title={`MID(商家ID): ${merchantIdText}${item.mid ? ` | 商品ID: ${item.mid}` : ''}`}
                      >
                        <span className="truncate">{merchantIdText}</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <div className="max-w-[132px] truncate whitespace-nowrap" title={merchantIdText}>
                        {merchantIdText}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[130px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={brandText}>
                    {brandText}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[108px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={asinText}>{asinText}</div>
                </TableCell>
                <TableCell>
                  <div className={item.isBlacklisted ? 'opacity-50' : ''}>
                    <Badge
                      variant="outline"
                      className={`inline-flex max-w-[132px] items-center whitespace-nowrap px-2 py-1 text-xs ${landingPageTypeMeta.badgeClassName}`}
                      title={landingPageTypeMeta.label}
                      aria-label={landingPageTypeMeta.label}
                    >
                      <span className="truncate">{landingPageTypeMeta.label}</span>
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[84px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={reviewCountText}>
                    {reviewCountText}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`flex items-center gap-2 ${item.isBlacklisted ? 'opacity-50' : ''}`}>
                    {item.recommendationScore ? (
                      <>
                        <div className="flex items-center gap-1">
                          <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                          <span className="text-sm font-medium">{item.recommendationScore.toFixed(1)}</span>
                        </div>
                        {item.recommendationReasons && item.recommendationReasons.length > 0 && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <ul className="space-y-1 text-sm">
                                  {item.recommendationReasons.map((reason, i) => (
                                    <li key={i}>• {reason}</li>
                                  ))}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[116px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={allowedCountriesText}>
                    {allowedCountriesText}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[100px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={priceText}>{priceText}</div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[96px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={commissionRateText}>{commissionRateText}</div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[100px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={commissionAmountText}>{commissionAmountText}</div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[98px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={promoLink || '-'}>
                    {promoLink ? (
                      <button
                        className="inline-flex max-w-[92px] items-center gap-1 truncate text-blue-600 hover:underline"
                        onClick={() => safeOpenExternal(promoLink)}
                        title={promoLink}
                      >
                        <Link className="h-3.5 w-3.5" />
                        查看链接
                      </button>
                    ) : (
                      '-'
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[120px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={relatedOfferCountText}>
                    {relatedOfferCountText}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[108px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={createdAtDateTimeText}>
                    {createdAtDateText}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openCreateOfferDialog(item)}
                      disabled={creatingOfferId !== null || !item.promoLink || item.isBlacklisted}
                      title={item.isBlacklisted ? '商品已下线，无法创建Offer' : '创建Offer'}
                    >
                      {creatingOfferId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleProductSync(item)}
                      disabled={syncingProductId !== null}
                      title="同步数据"
                    >
                      {syncingProductId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openSingleOfflineDialog(item)}
                      disabled={offliningProductId !== null || item.isBlacklisted}
                      title={item.isBlacklisted ? '商品已手动下线' : '手动下线商品'}
                      className={item.isBlacklisted ? 'text-muted-foreground' : 'text-red-600 hover:text-red-600'}
                    >
                      {offliningProductId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PowerOff className="h-4 w-4" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 py-4 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:gap-0">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/dashboard')}
                className="flex-shrink-0"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                返回Dashboard
              </Button>
              <h1 className="text-xl font-semibold tracking-tight">商品管理</h1>
              <Badge variant="outline">{total}</Badge>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-2">
              <div className="flex flex-col items-start gap-1">
                <Badge variant={ypSessionStatus.hasSession ? 'default' : 'outline'}>
                  YP登录态
                  {ypSessionStatusLoading
                    ? '检测中'
                    : ypSessionStatus.hasSession
                      ? '已就绪'
                      : (ypSessionStatus.isExpired ? '已过期' : '未采集')}
                </Badge>
                {(!ypSessionStatusLoading && ypSessionStatus.hasSession) && (
                  <div className="pl-1 text-[11px] leading-none text-muted-foreground">
                    过期时间：{formatMonthDayTime(ypSessionStatus.expiresAt)}
                  </div>
                )}
              </div>

              <Button
                variant="outline"
                onClick={handlePrepareYeahPromosCapture}
                disabled={ypPreparingCapture}
                title="打开YP登录页并生成书签脚本，登录后点击书签自动回传登录态"
              >
                {ypPreparingCapture ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
                采集YP登录态
              </Button>

              {(['yeahpromos', 'partnerboost'] as const).map((platform) => {
                const defaultStrategy = getDefaultPlatformSyncStrategy(platform)
                const defaultStrategyLabel = getPlatformSyncStrategyLabel(defaultStrategy)
                const alternateStrategy: PlatformSyncStrategy = defaultStrategy === 'light' ? 'full' : 'light'
                const alternateStrategyLabel = getPlatformSyncStrategyLabel(alternateStrategy)
                const isPlatformSyncing = syncingPlatform?.platform === platform
                const isFullFromScratchSyncing = isPlatformSyncing
                  && syncingPlatform?.strategy === 'full'
                  && syncingPlatform?.resumeFailedRun !== true
                const isFullResumeSyncing = isPlatformSyncing
                  && syncingPlatform?.strategy === 'full'
                  && syncingPlatform?.resumeFailedRun === true
                const isPrimarySyncing = defaultStrategy === 'full'
                  ? isFullFromScratchSyncing
                  : (isPlatformSyncing && syncingPlatform?.strategy === defaultStrategy)
                const isAlternateSyncing = alternateStrategy === 'full'
                  ? isFullFromScratchSyncing
                  : (isPlatformSyncing && syncingPlatform?.strategy === alternateStrategy)
                const isDropdownSyncing = isAlternateSyncing || isFullResumeSyncing
                const isBlockedBySession = platform === 'yeahpromos' && !ypSessionStatus.hasSession
                const triggerDefaultSync = () => {
                  if (defaultStrategy === 'full') {
                    return handlePlatformSync(platform, 'full', { resumeFailedRun: false })
                  }
                  return handlePlatformSync(platform, defaultStrategy)
                }
                const defaultButtonLabel = defaultStrategy === 'full'
                  ? '全量补齐（从头）'
                  : defaultStrategyLabel
                return (
                  <div key={platform} className="inline-flex">
                    <Button
                      variant="outline"
                      onClick={triggerDefaultSync}
                      disabled={syncingPlatform !== null || isBlockedBySession}
                      className="rounded-r-none border-r-0 bg-white"
                      title={isBlockedBySession ? '请先完成YP登录态采集' : undefined}
                    >
                      {isPrimarySyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      {PLATFORM_SHORT_LABEL[platform]} {defaultButtonLabel}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          disabled={syncingPlatform !== null || isBlockedBySession}
                          className="h-10 w-10 rounded-l-none bg-white"
                          aria-label={`选择${PLATFORM_SHORT_LABEL[platform]}同步模式`}
                          title={isBlockedBySession ? '请先完成YP登录态采集' : undefined}
                        >
                          {isDropdownSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {defaultStrategy === 'full' ? (
                          <>
                            <DropdownMenuItem onClick={() => handlePlatformSync(platform, 'full', { resumeFailedRun: false })} disabled={syncingPlatform !== null}>
                              全量补齐（从头，默认）
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handlePlatformSync(platform, 'full', { resumeFailedRun: true })} disabled={syncingPlatform !== null}>
                              全量补齐（续传失败任务）
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handlePlatformSync(platform, alternateStrategy)} disabled={syncingPlatform !== null}>
                              {alternateStrategyLabel}
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <>
                            <DropdownMenuItem onClick={() => handlePlatformSync(platform, defaultStrategy)} disabled={syncingPlatform !== null}>
                              {defaultStrategyLabel}（默认）
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handlePlatformSync(platform, 'full', { resumeFailedRun: false })} disabled={syncingPlatform !== null}>
                              全量补齐（从头）
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handlePlatformSync(platform, 'full', { resumeFailedRun: true })} disabled={syncingPlatform !== null}>
                              全量补齐（续传失败任务）
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary">
                    更多操作
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    onClick={openClearAllDialog}
                    disabled={clearingAll || total <= 0}
                    className="text-red-600 focus:text-red-600"
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    一键清空
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">联盟平台配置</CardTitle>
            <CardDescription>联盟配置已迁移到设置页，商品管理页不再提供编辑入口。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              联盟平台凭证与佣金同步策略已迁移到 <span className="font-mono">/settings?category=affiliate_sync</span>。
            </div>
            <div className="mt-3 flex justify-end">
              <Button variant="outline" onClick={() => router.push('/settings?category=affiliate_sync')}>
                前往设置页配置
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="px-4 pb-4 pt-4">
              <div className="text-xs text-muted-foreground">当前筛选条目</div>
              <div className="mt-1 flex items-center gap-2">
                <Package className="h-4 w-4 text-blue-600" />
                <span className="text-xl font-semibold">{total}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                商品 {landingPageStats.productCount} · 店铺 {landingPageStats.storeCount}
                {landingPageStats.unknownCount > 0 ? ` · 其他 ${landingPageStats.unknownCount}` : ''}
              </div>
            </CardContent>
          </Card>
          {(['yeahpromos', 'partnerboost'] as const).map((platform) => {
            const statsItem = platformStats[platform]
            return (
              <Card key={platform}>
                <CardContent className="px-4 pb-4 pt-4">
                  <div className="text-xs text-muted-foreground">{PLATFORM_LABEL[platform]}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Building2 className={`h-4 w-4 ${PLATFORM_CARD_ACCENT_CLASS[platform]}`} />
                    <span className="text-xl font-semibold">{statsItem.visibleCount}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">商品 {statsItem.productCount} · 店铺 {statsItem.storeCount}</div>
                  <div className="text-[11px] text-muted-foreground">平台总条目 {statsItem.total}</div>
                </CardContent>
              </Card>
            )
          })}
          <Card>
            <CardContent className="px-4 pb-4 pt-4">
              <div className="text-xs text-muted-foreground">推荐指数</div>
              <div className="mt-1 flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-500" />
                <span className="text-xl font-semibold">{recommendationScoreSummary.effectiveCount}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                占总商品 {recommendationScoreCoveragePercent.toFixed(1)}%
              </div>
              <div className="text-[11px] text-muted-foreground">
                最后计算 {formatMonthDayTime(recommendationScoreSummary.lastCalculatedAt)}
              </div>
            </CardContent>
          </Card>
        </div>

        {latestRuns.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">最近同步任务</CardTitle>
              <CardDescription>按同步模式分组展示历史任务（各最多 4 条）</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {syncHistoryRows.map((row) => (
                  <div key={row.key} className="rounded-md border px-3 py-2 text-xs">
                    <div className="mb-2 font-medium">{row.label}</div>
                    {row.runs.length === 0 ? (
                      <div className="text-muted-foreground">{row.emptyText}</div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {row.runs.map((run) => {
                          const StatusIcon = getSyncRunStatusIcon(run.status)
                          return (
                            <div key={run.id} className="rounded-md border px-2 py-1">
                              <div className="mb-1 flex items-center gap-2">
                                <span className="font-medium">{PLATFORM_SHORT_LABEL[run.platform]} #{run.id}</span>
                                <Badge variant={getSyncRunBadgeVariant(run.status)}>
                                  <StatusIcon className="mr-1 h-3 w-3" />
                                  {run.status}
                                </Badge>
                              </div>
                              <div className="text-muted-foreground">{getSyncRunProgressText(run)}</div>
                              <div className="text-muted-foreground">{getSyncRunMetricsText(run)}</div>
                              <div className="text-muted-foreground">开始时间 {getSyncRunStartedAtText(run)}</div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {(ypSyncMonitor.runId !== null || ypSyncMonitor.targetItems !== null) && (
          <Card>
            <details>
              <summary className="cursor-pointer px-6 py-4">
                <span className="text-base font-semibold">YP 同步 ETA 监控</span>
                <p className="mt-1 text-sm text-muted-foreground">基于每小时抓取快照估算完成时间，按跨天连续抓取模型计算。</p>
              </summary>
            <CardContent className="space-y-3 pt-0">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-md border p-2">
                  <div className="text-[11px] text-muted-foreground">运行任务</div>
                  <div className="mt-1 text-sm font-medium">
                    {ypSyncMonitor.runId ? `#${ypSyncMonitor.runId}` : '-'}
                    {ypSyncMonitor.runStatus ? ` · ${ypSyncMonitor.runStatus}` : ''}
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[11px] text-muted-foreground">目标商品量</div>
                  <div className="mt-1 text-sm font-medium">{formatIntegerCount(ypSyncMonitor.targetItems)}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[11px] text-muted-foreground">已抓取</div>
                  <div className="mt-1 text-sm font-medium">{formatIntegerCount(ypSyncMonitor.fetchedItems)}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[11px] text-muted-foreground">近小时均速</div>
                  <div className="mt-1 text-sm font-medium">
                    {ypSyncMonitor.avgItemsPerHour !== null
                      ? `${formatIntegerCount(Math.round(ypSyncMonitor.avgItemsPerHour))} /小时`
                      : '-'}
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[11px] text-muted-foreground">预计完成时间</div>
                  <div className="mt-1 text-sm font-medium">{formatSyncRunDateTime(ypSyncMonitor.etaAt)}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>剩余 {formatIntegerCount(ypSyncMonitor.remainingItems)}</span>
                <span>数据更新时间 {formatSyncRunDateTime(ypSyncMonitor.statsUpdatedAt)}</span>
              </div>

              <div className="rounded-md border">
                <div className="border-b px-3 py-2 text-xs font-medium">每小时抓取统计（最近 12 小时）</div>
                {ypSyncMonitor.hourlyStats.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-muted-foreground">暂无小时级抓取快照，任务运行后会自动生成。</div>
                ) : (
                  <div className="max-h-64 overflow-auto px-3 py-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-1 pr-2 font-medium">小时</th>
                          <th className="py-1 pr-2 font-medium">本小时新增</th>
                          <th className="py-1 pr-2 font-medium">累计抓取</th>
                          <th className="py-1 font-medium">采样点</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...ypSyncMonitor.hourlyStats].slice(-12).reverse().map((stat) => (
                          <tr key={stat.hourBucket} className="border-t">
                            <td className="py-1 pr-2">{formatHourBucket(stat.hourBucket)}</td>
                            <td className="py-1 pr-2">{formatIntegerCount(stat.fetchedCount)}</td>
                            <td className="py-1 pr-2">{formatIntegerCount(stat.cumulativeFetched)}</td>
                            <td className="py-1">{formatIntegerCount(stat.sampleCount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </CardContent>
            </details>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">商品列表</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              <span>共 {total} 个商品，支持排序、单商品同步、推荐指数计算、创建 Offer、手动下线商品和批量操作</span>
              {hasActiveSyncRuns && (
                <span className="inline-flex items-center text-xs text-muted-foreground">
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  {hasFilters ? '后台更新中（筛选结果已锁定）' : '后台更新中'}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>同一 ASIN 可能对应多个推广条目（不同链接/佣金/策略），列表按推广条目展示。同步未命中不会自动计入失效或执行手动下线。</span>
            </div>
            <div className="space-y-3">
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_146px_128px_128px_122px_152px] lg:items-center">
                <div className="relative w-full">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="搜索 平台商品ID / ASIN / 商品名 / 品牌"
                    className="pl-9"
                  />
                </div>
                <Input
                  value={midText}
                  onChange={(event) => setMidText(event.target.value)}
                  placeholder="MID筛选（商家ID）"
                  className="w-full lg:w-[146px]"
                />
                <Select value={platformFilter} onValueChange={(value) => {
                  setPlatformFilter(value as typeof platformFilter)
                  setPage(1)
                }}>
                  <SelectTrigger className="w-full lg:w-[128px]">
                    <SelectValue placeholder="联盟平台" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部平台</SelectItem>
                    <SelectItem value="yeahpromos">YeahPromos</SelectItem>
                    <SelectItem value="partnerboost">PartnerBoost</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(value) => {
                  setStatusFilter(value as ProductStatusFilter)
                  setPage(1)
                }}>
                  <SelectTrigger className="w-full lg:w-[128px]">
                    <SelectValue placeholder="状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="active">有效</SelectItem>
                    <SelectItem value="invalid">已失效(平台确认)</SelectItem>
                    <SelectItem value="sync_missing">同步未命中</SelectItem>
                    <SelectItem value="unknown">状态未知</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={targetCountryFilter} onValueChange={(value) => {
                  setTargetCountryFilter(value)
                  setPage(1)
                }}>
                  <SelectTrigger className="w-full lg:w-[122px]">
                    <SelectValue placeholder="投放国家" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部国家</SelectItem>
                    {PRODUCT_TARGET_COUNTRY_FILTER_OPTIONS.map((countryCode) => (
                      <SelectItem key={countryCode} value={countryCode}>
                        {countryCode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={landingPageTypeFilter} onValueChange={(value) => {
                  setLandingPageTypeFilter(value as LandingPageTypeFilter)
                  setPage(1)
                }}>
                  <SelectTrigger className="w-full lg:w-[152px]">
                    <SelectValue placeholder="落地页类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部落地页</SelectItem>
                    {LANDING_PAGE_TYPE_FILTER_OPTIONS.map((type) => (
                      <SelectItem key={type} value={type}>
                        {LANDING_PAGE_TYPE_META[type].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <Badge variant={scoreCalculationPaused ? 'destructive' : 'secondary'}>
                  推荐指数计算：{scoreCalculationPaused ? '已暂停' : '运行中'}
                </Badge>
                <Button
                  variant="outline"
                  onClick={() => setCalculateScoresConfirmOpen(true)}
                  disabled={calculatingScores || scorePauseUpdating || (scoreCalculationPaused && selectedProducts.length === 0)}
                  title={scoreCalculationPaused
                    ? (selectedProducts.length > 0 ? '全局暂停中：支持对选中商品手动重算' : '全局暂停中：请先勾选要重算的商品')
                    : undefined}
                >
                  {calculatingScores ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Star className="mr-2 h-4 w-4" />
                  )}
                  {selectedProducts.length > 0
                    ? `提交推荐指数计算 (${selectedProducts.length})`
                    : '提交推荐指数计算'}
                </Button>
                <Button
                  variant={scoreCalculationPaused ? 'default' : 'secondary'}
                  onClick={handleToggleScoreCalculationPause}
                  disabled={scorePauseUpdating || calculatingScores}
                >
                  {scorePauseUpdating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : scoreCalculationPaused ? (
                    <PlayCircle className="mr-2 h-4 w-4" />
                  ) : (
                    <PauseCircle className="mr-2 h-4 w-4" />
                  )}
                  {scoreCalculationPaused ? '恢复全局计算' : '暂停全局计算'}
                </Button>
                {hasFilters && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSearchText('')
                      setSearchQuery('')
                      setMidText('')
                      setMidQuery('')
                      setPlatformFilter('all')
                      setStatusFilter('all')
                      setTargetCountryFilter('all')
                      setLandingPageTypeFilter('all')
                      setCreatedAtFrom('')
                      setCreatedAtTo('')
                      setNumericRangeDrafts({ ...EMPTY_NUMERIC_RANGE_FILTER_DRAFTS })
                      setNumericRangeFilters({ ...EMPTY_NUMERIC_RANGE_FILTERS })
                      setPage(1)
                    }}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    清除筛选
                  </Button>
                )}
                {canBatchCreate && (
                  <Button onClick={openBatchDialog}>
                    <Plus className="mr-2 h-4 w-4" />
                    批量创建Offer ({creatableSelectedProducts.length})
                  </Button>
                )}
                {canBatchOffline && (
                  <Button variant="destructive" onClick={openBatchOfflineConfirm}>
                    <PowerOff className="mr-2 h-4 w-4" />
                    批量手动下线商品 ({selectedProducts.length})
                  </Button>
                )}
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">添加日期</span>
                {createdDateQuickFilters.map((filter) => {
                  const range = resolveRecentDateRange(filter.days)
                  const isActive = createdAtFrom === range.from && createdAtTo === range.to
                  return (
                    <Button
                      key={filter.key}
                      size="sm"
                      variant={isActive ? 'secondary' : 'outline'}
                      onClick={() => applyCreatedDateQuickFilter(filter.days)}
                    >
                      {filter.label}
                    </Button>
                  )
                })}
                <DateRangePicker
                  value={createdDateRangeValue}
                  onChange={handleCreatedDateRangeChange}
                  placeholder="自定义"
                  variant={isCreatedDateCustomActive ? 'default' : 'ghost'}
                  size="sm"
                  maxDate={new Date()}
                  showPresets={false}
                  showClearButton={false}
                  compact={true}
                  className="max-w-[190px]"
                />
                {(createdAtFrom || createdAtTo) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearCreatedDateFilter}
                  >
                    清空日期
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              {numericRangeFilterCards.map((card) => (
                <div key={card.label} className="rounded-md border p-3 space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">{card.label}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={numericRangeDrafts[card.minKey]}
                      onChange={(event) => updateNumericRangeDraft(card.minKey, event.target.value)}
                      placeholder={card.minPlaceholder}
                      inputMode="decimal"
                    />
                    <Input
                      value={numericRangeDrafts[card.maxKey]}
                      onChange={(event) => updateNumericRangeDraft(card.maxKey, event.target.value)}
                      placeholder={card.maxPlaceholder}
                      inputMode="decimal"
                    />
                  </div>
                </div>
              ))}
            </div>

            {loading ? (
              <div className="h-56 rounded-md border flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                加载中...
              </div>
            ) : items.length === 0 ? (
              hasFilters ? (
                <NoResultsState description="当前筛选条件下暂无商品，试试清除筛选后再查看。" />
              ) : (
                platformFilter === 'all' ? (
                  <div className="space-y-3">
                    <NoDataState
                      title="暂无商品数据"
                      description="请先执行联盟平台同步，系统会自动拉取可推广商品。"
                      actionLabel="同步 PB(快速刷新)"
                      onAction={() => handlePlatformSync('partnerboost', 'light')}
                    />
                    <div className="flex justify-center">
                      <div className="inline-flex">
                        <Button
                          variant="outline"
                          className="rounded-r-none border-r-0 bg-white"
                          onClick={() => handlePlatformSync('yeahpromos', 'full', { resumeFailedRun: false })}
                          disabled={syncingPlatform !== null || !ypSessionStatus.hasSession}
                          title={!ypSessionStatus.hasSession ? '请先完成YP登录态采集' : undefined}
                        >
                          {syncingPlatform?.platform === 'yeahpromos'
                            && syncingPlatform.strategy === 'full'
                            && syncingPlatform.resumeFailedRun !== true ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-2 h-4 w-4" />
                          )}
                          同步 YP(全量补齐-从头)
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-10 w-10 rounded-l-none bg-white"
                              disabled={syncingPlatform !== null || !ypSessionStatus.hasSession}
                              aria-label="选择 YP 全量同步方式"
                              title={!ypSessionStatus.hasSession ? '请先完成YP登录态采集' : undefined}
                            >
                              {syncingPlatform?.platform === 'yeahpromos'
                                && syncingPlatform.strategy === 'full'
                                && syncingPlatform.resumeFailedRun === true ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem
                              onClick={() => handlePlatformSync('yeahpromos', 'full', { resumeFailedRun: false })}
                              disabled={syncingPlatform !== null}
                            >
                              全量补齐（从头，默认）
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handlePlatformSync('yeahpromos', 'full', { resumeFailedRun: true })}
                              disabled={syncingPlatform !== null}
                            >
                              全量补齐（续传失败任务）
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                ) : (
                  <NoDataState
                    title="暂无商品数据"
                    description="请先执行联盟平台同步，系统会自动拉取可推广商品。"
                    actionLabel={`立即同步${platformFilter === 'yeahpromos' ? 'YP' : 'PB'}商品（${getPlatformSyncStrategyLabel(getDefaultPlatformSyncStrategy(platformFilter))}）`}
                    onAction={() => handlePlatformSync(platformFilter, getDefaultPlatformSyncStrategy(platformFilter))}
                  />
                )
              )
            ) : (
              renderProductTable()
            )}

            <ResponsivePagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size)
                setPage(1)
              }}
              pageSizeOptions={[10, 20, 50, 100, 500, 1000]}
            />
          </CardContent>
        </Card>
      </main>

      <Dialog
        open={ypCaptureDialogOpen}
        onOpenChange={(open) => {
          setYpCaptureDialogOpen(open)
          if (!open) {
            setYpSessionStatusWhenDialogOpened(false) // 重置标志
          }
        }}
      >
        <DialogContent className="max-h-[85vh] w-[96vw] max-w-5xl overflow-hidden p-0">
          <div className="flex max-h-[85vh] flex-col p-6">
            <DialogHeader className="shrink-0">
              <DialogTitle>YeahPromos 登录态采集</DialogTitle>
              <DialogDescription>
                使用浏览器扩展一键回传登录态
              </DialogDescription>
            </DialogHeader>

            <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1 text-sm">
              <div className="rounded-md border bg-slate-50 p-3">
                <div className="font-medium">使用步骤</div>
                <div>1. 点击"下载扩展包"，解压后得到扩展目录。</div>
                <div>2. Chrome 打开 chrome://extensions 或 Edge 打开 edge://extensions。</div>
                <div>3. 打开"开发者模式"后，点"加载已解压的扩展程序"，选择解压后的目录。</div>
                <div>4. 保持当前 AutoAds /products 页面已登录，再打开 yeahpromos.com 完成登录。</div>
                <div>5. 切回 AutoAds /products 标签页，点击浏览器右上角扩展图标，执行"回传 YeahPromos 登录态"。</div>
                <div>6. 回到本页点"刷新登录态"，状态变为"已就绪"后即可同步 YP。</div>
              </div>

              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">当前登录态</div>
                <div className="mt-1">
                  {ypSessionStatus.hasSession
                    ? `已就绪（会话 ${ypSessionStatus.maskedPhpSessionId || '-'}，到期 ${ypSessionStatus.expiresAt ? formatMonthDayTime(ypSessionStatus.expiresAt) : '-'}）`
                    : (ypSessionStatus.isExpired ? '已过期，请重新采集' : '未采集')}
                </div>
              </div>
            </div>

            <DialogFooter className="mt-4 shrink-0 gap-2 sm:flex-row sm:flex-nowrap sm:justify-end">
              <Button
                variant="outline"
                className="shrink-0 whitespace-nowrap border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                onClick={() => {
                  window.open(YP_CAPTURE_EXTENSION_DOWNLOAD_PATH, '_blank', 'noopener,noreferrer')
                }}
              >
                下载扩展包
              </Button>
              <Button
                variant="outline"
                className="shrink-0 whitespace-nowrap border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                onClick={() => void loadYeahPromosSessionStatus()}
                disabled={ypSessionStatusLoading}
              >
                {ypSessionStatusLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                刷新登录态
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createOfferDialogOpen}
        onOpenChange={(open) => {
          setCreateOfferDialogOpen(open)
          if (!open && creatingOfferId === null) {
            setPendingCreateOfferProduct(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>确认创建 Offer</DialogTitle>
            <DialogDescription>
              确认为商品 <strong className="text-foreground">{pendingCreateOfferProduct?.mid || '-'}</strong> 创建 Offer？
              系统将使用当前商品推广链接生成 Offer，创建后可在 Offer 页面继续编辑。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOfferDialogOpen(false)
                setPendingCreateOfferProduct(null)
              }}
              disabled={creatingOfferId !== null}
            >
              取消
            </Button>
            <Button
              onClick={submitCreateOffer}
              disabled={!pendingCreateOfferProduct || creatingOfferId !== null}
            >
              {creatingOfferId !== null ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              确认创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={singleOfflineDialogOpen}
        onOpenChange={(open) => {
          setSingleOfflineDialogOpen(open)
          if (!open && offliningProductId === null) {
            setOfflineProduct(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>确认手动下线商品</DialogTitle>
            <DialogDescription>
              确认手动下线商品 <strong className="text-foreground">{offlineProduct?.mid || '-'}</strong>？
              此操作不可撤销，系统会删除该商品所有关联Offer，并自动附带删除对应广告系列。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSingleOfflineDialogOpen(false)
                setOfflineProduct(null)
              }}
              disabled={offliningProductId !== null}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={submitSingleOffline}
              disabled={!offlineProduct || offliningProductId !== null}
            >
              {offliningProductId !== null ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PowerOff className="mr-2 h-4 w-4" />}
              确认手动下线
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchOfflineDialogOpen} onOpenChange={setBatchOfflineDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>确认批量手动下线商品</DialogTitle>
            <DialogDescription>
              已选择 <strong className="text-foreground">{selectedProducts.length}</strong> 个商品。
              确认后将手动下线这些商品并删除所有关联Offer，同时附带删除对应广告系列。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBatchOfflineDialogOpen(false)}
              disabled={batchOfflining}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={submitBatchOffline}
              disabled={!canBatchOffline || batchOfflining}
            >
              {batchOfflining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PowerOff className="mr-2 h-4 w-4" />}
              确认批量手动下线
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent className="w-[92vw] !max-w-[960px]">
          <DialogHeader>
            <DialogTitle>批量创建Offer</DialogTitle>
            <DialogDescription>
              已选择 {batchRows.length} 个商品。链接类型固定为“单品”，推广国家默认 US（可改）。
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table className="min-w-[720px] [&_thead_th]:bg-white">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[84px] whitespace-nowrap">链接类型</TableHead>
                  <TableHead className="min-w-[260px] whitespace-nowrap">推广链接</TableHead>
                  <TableHead className="w-[116px] whitespace-nowrap">推广国家</TableHead>
                  <TableHead className="w-[108px] whitespace-nowrap">商品价格</TableHead>
                  <TableHead className="w-[108px] whitespace-nowrap">佣金比例</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchRows.map((row) => {
                  const hasCountries = row.availableCountries.length > 0
                  const fallbackCountries = hasCountries ? row.availableCountries : ['US']
                  const value = fallbackCountries.includes(row.targetCountry)
                    ? row.targetCountry
                    : fallbackCountries[0]

                  return (
                    <TableRow key={row.productId}>
                      <TableCell>{row.linkType}</TableCell>
                      <TableCell className="max-w-[240px] truncate" title={row.promoLink || '-'}>
                        {row.promoLink || '-'}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={value}
                          onValueChange={(country) => updateBatchRowCountry(row.productId, country)}
                        >
                          <SelectTrigger className="w-[104px]">
                            <SelectValue placeholder="国家" />
                          </SelectTrigger>
                          <SelectContent>
                            {fallbackCountries.map((country) => (
                              <SelectItem key={country} value={country}>
                                {country}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{row.productPrice}</TableCell>
                      <TableCell>{row.commissionRate}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDialogOpen(false)} disabled={batchCreating}>
              取消
            </Button>
            <Button onClick={submitBatchCreate} disabled={batchCreating || batchRows.length === 0}>
              {batchCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              确认批量创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={calculateScoresConfirmOpen} onOpenChange={setCalculateScoresConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认计算推荐指数？</AlertDialogTitle>
            <AlertDialogDescription>
              {scoreCalculationPaused && (
                <span className="mb-2 block text-amber-600">
                  全局计算已暂停：仅支持对已选中商品手动计算，不支持全量提交。
                </span>
              )}
              {selectedProducts.length > 0 ? (
                <>
                  已选择 <strong className="text-foreground">{selectedProducts.length}</strong> 个商品，将仅计算选中商品。
                  若不选择商品则会执行全量计算，全量计算耗时较长且会消耗 AI token。
                </>
              ) : (
                <>
                  当前未选择商品，确认后将执行全量推荐指数计算。全量计算耗时较长且会消耗 AI token，请确认继续。
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={calculatingScores}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleCalculateScores()
              }}
              disabled={calculatingScores || (scoreCalculationPaused && selectedProducts.length === 0)}
            >
              {calculatingScores ? '提交中...' : '确认计算'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearAllConfirmOpen} onOpenChange={setClearAllConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空全部商品？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作会清空你在“商品管理”中已同步的全部商家/商品数据（共 <strong className="text-foreground">{total}</strong> 条）。
              不会删除已经创建的 Offer。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingAll}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={submitClearAll}
              disabled={clearingAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {clearingAll ? '清空中...' : '确认清空全部'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}
