'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { showSuccess, showError, showWarning } from '@/lib/toast-utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
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
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Search,
  RefreshCw,
  Trash2,
  ExternalLink,
  AlertCircle,
  FileText,
  Wand2,
  Link,
  ArrowLeft,
  Eye,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Package,
  CalendarDays,
} from 'lucide-react'
import { TrendChart, TrendChartData } from '@/components/charts/TrendChart'
import { ResponsivePagination } from '@/components/ui/responsive-pagination'
import { DateRangePicker, type DateRange } from '@/components/ui/date-range-picker'

// Helper function to extract text from headline/description objects or strings
const getTextContent = (item: unknown): string => {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object' && 'text' in item) {
    return String((item as { text: unknown }).text)
  }
  return String(item || '')
}

const formatDateInputValue = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface KeywordWithVolume {
  keyword: string
  searchVolume: number
  competition?: string
}

interface Sitelink {
  text: unknown
  url: unknown
  description?: unknown
}

interface Creative {
  id: number
  offerId: number
  headlines: string[]
  descriptions: string[]
  keywords: string[]
  keywordsWithVolume?: KeywordWithVolume[]
  callouts: unknown[]
  sitelinks: Sitelink[]
  finalUrl: string
  path1: string | null
  path2: string | null
  aiModel: string
  theme?: string | null
  creativeType?: 'brand_intent' | 'model_intent' | 'product_intent' | null
  keywordBucket?: string | null
  score: number | null
  adGroupId: number | null
  adId: string | null
  creationStatus: string
  creationError: string | null
  lastSyncAt: string | null
  createdAt: string
}

interface AdGroup {
  id: number
  adGroupName: string
  campaignId: number
  status: string
}

interface Offer {
  id: number
  brand: string
  url: string
  targetCountry: string
  scrapeStatus: string
}

interface Summary {
  total: number
  synced: number
  pending: number
  draft: number
}

type CreativesTimeRange = '7' | '14' | '30' | 'custom'

const getCreativeTypeMeta = (creative: Creative): {
  label: string
  shortLabel?: string
  className: string
} => {
  const normalizedCreativeType = String(creative.creativeType || '').trim().toLowerCase()
  if (normalizedCreativeType === 'brand_intent') {
    return {
      label: '品牌意图',
      shortLabel: 'A',
      className: 'bg-blue-50 text-blue-700 border-blue-200'
    }
  }

  if (normalizedCreativeType === 'model_intent') {
    return {
      label: '商品型号',
      shortLabel: 'B',
      className: 'bg-green-50 text-green-700 border-green-200'
    }
  }

  if (normalizedCreativeType === 'product_intent') {
    return {
      label: '商品需求',
      shortLabel: 'D',
      className: 'bg-amber-50 text-amber-700 border-amber-200'
    }
  }

  const bucket = String(creative.keywordBucket || '').toUpperCase()

  if (bucket === 'A') {
    return {
      label: '品牌意图',
      shortLabel: 'A',
      className: 'bg-blue-50 text-blue-700 border-blue-200'
    }
  }

  if (bucket === 'B' || bucket === 'C') {
    return {
      label: '商品型号',
      shortLabel: 'B',
      className: 'bg-green-50 text-green-700 border-green-200'
    }
  }

  if (bucket === 'D' || bucket === 'S') {
    return {
      label: '商品需求',
      shortLabel: 'D',
      className: 'bg-amber-50 text-amber-700 border-amber-200'
    }
  }

  if (creative.theme && creative.theme.trim().length > 0) {
    return {
      label: creative.theme.trim(),
      className: 'bg-gray-50 text-gray-700 border-gray-200'
    }
  }

  return {
    label: '未分类',
    className: 'bg-gray-50 text-gray-500 border-gray-200'
  }
}

export default function CreativesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const offerId = searchParams?.get('offerId')

  const [creatives, setCreatives] = useState<Creative[]>([])
  const [filteredCreatives, setFilteredCreatives] = useState<Creative[]>([])
  const [offer, setOffer] = useState<Offer | null>(null)
  const [adGroups, setAdGroups] = useState<AdGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)

  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [timeRange, setTimeRange] = useState<CreativesTimeRange>('7')
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [appliedCustomRange, setAppliedCustomRange] = useState<{ startDate: string; endDate: string } | null>(null)

  // Trend data states - 创意维度统计
  const [trendsData, setTrendsData] = useState<TrendChartData[]>([])
  const [trendsLoading, setTrendsLoading] = useState(false)
  const [trendsError, setTrendsError] = useState<string | null>(null)
  // 分布统计数据
  const [distributions, setDistributions] = useState<{
    status: Record<string, number>
    adStrength: Record<string, number>
    quality: Record<string, number>
    theme: Record<string, number>
  } | null>(null)
  // 使用统计
  const [usageStats, setUsageStats] = useState<{
    selected: number
    notSelected: number
    total: number
    usageRate: number
  } | null>(null)

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Sorting states
  type SortField = 'id' | 'score' | 'creationStatus' | 'createdAt'
  type SortDirection = 'asc' | 'desc' | null
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const filterKeyRef = useRef<string>('')

  // Detail dialog
  const [selectedCreative, setSelectedCreative] = useState<Creative | null>(null)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Creative | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Assign Ad Group dialog
  const [assigningCreative, setAssigningCreative] = useState<Creative | null>(null)
  const [selectedAdGroupId, setSelectedAdGroupId] = useState<string>('')

  /**
   * 处理401未授权错误 - 跳转到登录页
   */
  const handleUnauthorized = () => {
    document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search)
    router.push(`/login?redirect=${redirectUrl}`)
  }

  // Batch delete states
  const [selectedCreativeIds, setSelectedCreativeIds] = useState<Set<number>>(new Set())
  const [isBatchDeleteDialogOpen, setIsBatchDeleteDialogOpen] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [batchDeleteError, setBatchDeleteError] = useState<string | null>(null)

  useEffect(() => {
    fetchOfferAndCreatives()
    fetchTrends()
  }, [offerId])

  useEffect(() => {
    fetchTrends()
  }, [timeRange, appliedCustomRange?.startDate, appliedCustomRange?.endDate])

  useEffect(() => {
    let result = creatives

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (c) =>
          c.headlines.some(h => getTextContent(h).toLowerCase().includes(query)) ||
          c.descriptions.some(d => getTextContent(d).toLowerCase().includes(query)) ||
          c.finalUrl.toLowerCase().includes(query)
      )
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.creationStatus === statusFilter)
    }

    // Sorting
    if (sortField && sortDirection) {
      result = [...result].sort((a, b) => {
        let aVal: number | string = 0
        let bVal: number | string = 0

        switch (sortField) {
          case 'id':
            aVal = a.id
            bVal = b.id
            break
          case 'score':
            aVal = a.score || 0
            bVal = b.score || 0
            break
          case 'creationStatus':
            aVal = a.creationStatus
            bVal = b.creationStatus
            break
          case 'createdAt':
            aVal = new Date(a.createdAt).getTime()
            bVal = new Date(b.createdAt).getTime()
            break
        }

        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
        return 0
      })
    }

    setFilteredCreatives(result)

    const filterKey = JSON.stringify({ searchQuery, statusFilter, sortField, sortDirection })
    const filtersChanged = filterKeyRef.current !== filterKey
    filterKeyRef.current = filterKey

    const totalPages = Math.max(1, Math.ceil(result.length / pageSize))
    setCurrentPage((prev) => {
      const nextPage = filtersChanged ? 1 : prev
      return nextPage > totalPages ? totalPages : nextPage
    })
  }, [creatives, searchQuery, statusFilter, sortField, sortDirection, pageSize])

  const fetchOfferAndCreatives = async () => {
    try {
      if (offerId) {
        // 获取Offer信息
        const offerRes = await fetch(`/api/offers/${offerId}`, {
          credentials: 'include',
        })

        if (!offerRes.ok) {
          throw new Error('获取Offer失败')
        }

        const offerData = await offerRes.json()
        setOffer(offerData.offer)

        // 获取创意列表
        const creativesRes = await fetch(`/api/creatives?offerId=${offerId}`, {
          credentials: 'include',
        })

        if (!creativesRes.ok) {
          throw new Error('获取创意列表失败')
        }

        const creativesData = await creativesRes.json()
        setCreatives(creativesData.creatives)
        setFilteredCreatives(creativesData.creatives)
        calculateSummary(creativesData.creatives)

        // 获取Ad Groups列表
        if (offerData.offer.campaignId) {
          const adGroupsRes = await fetch(
            `/api/ad-groups?campaignId=${offerData.offer.campaignId}`,
            { credentials: 'include' }
          )

          if (adGroupsRes.ok) {
            const adGroupsData = await adGroupsRes.json()
            setAdGroups(adGroupsData.adGroups)
          }
        }
      } else {
        // 显示所有创意
        const creativesRes = await fetch(`/api/creatives`, {
          credentials: 'include',
        })

        if (!creativesRes.ok) {
          throw new Error('获取创意列表失败')
        }

        const creativesData = await creativesRes.json()
        setCreatives(creativesData.creatives)
        setFilteredCreatives(creativesData.creatives)
        calculateSummary(creativesData.creatives)
      }
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const calculateSummary = (data: Creative[]) => {
    setSummary({
      total: data.length,
      synced: data.filter(c => c.creationStatus === 'synced').length,
      pending: data.filter(c => c.creationStatus === 'pending').length,
      draft: data.filter(c => c.creationStatus === 'draft').length,
    })
  }

  const handleDateRangeChange = (range: DateRange | undefined) => {
    if (!range?.from || !range?.to) {
      setDateRange(range)
      return
    }

    const startDate = formatDateInputValue(range.from)
    const endDate = formatDateInputValue(range.to)

    if (startDate > endDate) {
      showError('时间范围无效', '结束日期不能早于开始日期')
      return
    }

    setDateRange(range)
    setAppliedCustomRange({
      startDate,
      endDate,
    })
    setTimeRange('custom')
  }

  const selectPresetTimeRange = (days: Exclude<CreativesTimeRange, 'custom'>) => {
    setTimeRange(days)
  }

  const fetchTrends = async () => {
    try {
      setTrendsLoading(true)
      const params = new URLSearchParams()
      if (timeRange === 'custom') {
        if (appliedCustomRange) {
          params.set('start_date', appliedCustomRange.startDate)
          params.set('end_date', appliedCustomRange.endDate)
        } else {
          params.set('daysBack', '7')
        }
      } else {
        params.set('daysBack', timeRange)
      }
      if (offerId) {
        params.set('offerId', offerId)
      }
      const url = `/api/creatives/trends?${params.toString()}`
      const response = await fetch(url, {
        credentials: 'include',
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        throw new Error('获取趋势数据失败')
      }

      const data = await response.json()
      setTrendsData(data.trends || [])
      setDistributions(data.distributions || null)
      setUsageStats(data.usage || null)
      setTrendsError(null)
    } catch (err: any) {
      setTrendsError(err.message || '加载趋势数据失败')
    } finally {
      setTrendsLoading(false)
    }
  }

  const customRangeLabel = appliedCustomRange
    ? `${appliedCustomRange.startDate} ~ ${appliedCustomRange.endDate}`
    : '自定义'

  const handleGenerateCreatives = async () => {
    setGenerating(true)
    setError('')

    try {
      const response = await fetch(`/api/offers/${offerId}/generate-creatives`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 3 }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '生成创意失败')
      }

      showSuccess('创意生成成功', `已生成 ${data.count} 组创意`)
      fetchOfferAndCreatives()
    } catch (err: any) {
      setError(err.message || '生成创意失败')
      showError('生成失败', err.message)
    } finally {
      setGenerating(false)
    }
  }

  const openDeleteDialog = (creative: Creative) => {
    setDeleteTarget(creative)
    setDeleteError(null)
    setIsDeleteDialogOpen(true)
  }

  const confirmDeleteCreative = async () => {
    if (!deleteTarget) return
    try {
      setDeleteSubmitting(true)
      setDeleteError(null)

      const response = await fetch(`/api/creatives/${deleteTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.error || '删除失败')
      }

      showSuccess('删除成功', `创意 #${deleteTarget.id} 已删除`)
      setIsDeleteDialogOpen(false)
      setDeleteTarget(null)
      fetchOfferAndCreatives()
    } catch (err: any) {
      const message = err?.message || '删除失败'
      setDeleteError(message)
      showError('删除失败', message)
    } finally {
      setDeleteSubmitting(false)
    }
  }

  const handleAssignAdGroup = async () => {
    if (!assigningCreative || !selectedAdGroupId) {
      showWarning('请选择Ad Group', '需要先选择一个Ad Group才能继续')
      return
    }

    try {
      const response = await fetch(`/api/creatives/${assigningCreative.id}/assign-adgroup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adGroupId: parseInt(selectedAdGroupId) }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '关联失败')
      }

      setAssigningCreative(null)
      setSelectedAdGroupId('')
      fetchOfferAndCreatives()
      showSuccess('关联成功', '已成功关联到Ad Group')
    } catch (err: any) {
      showError('关联失败', err.message)
    }
  }

  const handleSyncToGoogleAds = async (creative: Creative) => {
    setSyncingId(creative.id)

    try {
      const response = await fetch(`/api/creatives/${creative.id}/sync`, {
        method: 'POST',
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '同步失败')
      }

      showSuccess('同步成功', 'Creative已成功同步到Google Ads')
      fetchOfferAndCreatives()
    } catch (err: any) {
      showError('同步失败', err.message)
    } finally {
      setSyncingId(null)
    }
  }

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
      draft: { label: '草稿', variant: 'secondary', className: 'bg-gray-100 text-gray-600' },
      pending: { label: '同步中', variant: 'secondary', className: 'bg-blue-100 text-blue-700' },
      synced: { label: '已同步', variant: 'default', className: 'bg-green-600 hover:bg-green-700' },
      failed: { label: '同步失败', variant: 'destructive', className: '' },
    }
    const config = configs[status] || { label: status, variant: 'outline' as const, className: '' }

    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    )
  }

  const openDetailDialog = (creative: Creative) => {
    setSelectedCreative(creative)
    setDetailDialogOpen(true)
  }

  // Parse keywords safely
  const parseKeywords = (creative: Creative) => {
    let keywordsWithVolume = creative.keywordsWithVolume
    if (typeof keywordsWithVolume === 'string') {
      try {
        keywordsWithVolume = JSON.parse(keywordsWithVolume)
      } catch {
        keywordsWithVolume = undefined
      }
    }

    let keywords = creative.keywords
    if (typeof keywords === 'string') {
      try {
        keywords = JSON.parse(keywords)
      } catch {
        keywords = []
      }
    }

    return keywordsWithVolume || (Array.isArray(keywords) ? keywords.map(k => ({ keyword: k, searchVolume: 0 })) : [])
  }

  // 排序处理函数
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // 如果点击的是当前排序字段，切换排序方向
      if (sortDirection === 'asc') {
        setSortDirection('desc')
      } else if (sortDirection === 'desc') {
        setSortDirection(null)
        setSortField(null)
      } else {
        setSortDirection('asc')
      }
    } else {
      // 如果点击的是新字段，设置为升序
      setSortField(field)
      setSortDirection('asc')
    }
  }

  // 可排序表头组件
  const SortableHeader = ({ field, children, className = '' }: { field: SortField; children: React.ReactNode; className?: string }) => {
    const isActive = sortField === field
    return (
      <TableHead className={`cursor-pointer select-none hover:bg-gray-50 ${className}`} onClick={() => handleSort(field)}>
        <div className="flex items-center gap-1">
          {children}
          {isActive ? (
            sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
          ) : (
            <ArrowUpDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </TableHead>
    )
  }

  // 分页后的创意列表
  const paginatedCreatives = filteredCreatives.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  // 批量选择处理
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const newSelected = new Set(selectedCreativeIds)
      paginatedCreatives.forEach(c => newSelected.add(c.id))
      setSelectedCreativeIds(newSelected)
    } else {
      const newSelected = new Set(selectedCreativeIds)
      paginatedCreatives.forEach(c => newSelected.delete(c.id))
      setSelectedCreativeIds(newSelected)
    }
  }

  const handleSelectCreative = (creativeId: number, checked: boolean) => {
    const newSelected = new Set(selectedCreativeIds)
    if (checked) {
      newSelected.add(creativeId)
    } else {
      newSelected.delete(creativeId)
    }
    setSelectedCreativeIds(newSelected)
  }

  // 批量删除处理
  const handleBatchDelete = async () => {
    if (selectedCreativeIds.size === 0) return

    try {
      setBatchDeleting(true)
      setBatchDeleteError(null)

      // 检查是否有关联了已同步到Google Ads的创意（有ad_id的不能删除）
      const creativesToDelete = creatives.filter(c => selectedCreativeIds.has(c.id))
      const creativesWithAdId = creativesToDelete.filter(c => c.adId !== null)

      if (creativesWithAdId.length > 0) {
        setBatchDeleteError(`以下 ${creativesWithAdId.length} 个创意已同步到Google Ads，无法删除：\n${creativesWithAdId.map(c => `创意 #${c.id}`).join('\n')}`)
        setBatchDeleting(false)
        return
      }

      // 执行批量删除
      const deletePromises = Array.from(selectedCreativeIds).map(id =>
        fetch(`/api/creatives/${id}`, {
          method: 'DELETE',
          credentials: 'include',
        }).then(res => {
          if (!res.ok) throw new Error(`删除创意 #${id} 失败`)
          return { id, success: true }
        }).catch(err => ({ id, success: false, error: err.message }))
      )

      const results = await Promise.allSettled(deletePromises)
      const failures = results
        .filter((r): r is PromiseFulfilledResult<{ id: number; success: false; error: string }> =>
          r.status === 'fulfilled' && !r.value.success
        )
        .map(r => r.value)

      if (failures.length > 0) {
        setBatchDeleteError(`以下创意删除失败：\n${failures.map(f => `创意 #${f.id}: ${f.error}`).join('\n')}`)
      } else {
        showSuccess('批量删除成功', `已删除 ${selectedCreativeIds.size} 个创意`)
        setIsBatchDeleteDialogOpen(false)
        setSelectedCreativeIds(new Set())
        fetchOfferAndCreatives()
      }
    } catch (err: any) {
      setBatchDeleteError(err.message || '批量删除失败')
    } finally {
      setBatchDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              {offerId && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push(`/offers/${offerId}`)}
                  className="text-gray-600 hover:text-gray-900"
                >
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  返回
                </Button>
              )}
              <h1 className="text-2xl font-bold text-gray-900">
                {offerId && offer ? `${offer.brand} - 创意管理` : '创意管理'}
              </h1>
              <Badge variant="outline" className="text-sm">
                {creatives.length}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              {selectedCreativeIds.size > 0 && (
                <Button
                  variant="destructive"
                  onClick={() => setIsBatchDeleteDialogOpen(true)}
                  className="flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  删除选中 ({selectedCreativeIds.size})
                </Button>
              )}
              <Button
                variant="outline"
                onClick={fetchOfferAndCreatives}
                className="flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                刷新
              </Button>
              {offerId && (
                <Button
                  onClick={handleGenerateCreatives}
                  disabled={generating || offer?.scrapeStatus !== 'completed'}
                  className="flex items-center gap-2"
                >
                  <Wand2 className={`w-4 h-4 ${generating ? 'animate-pulse' : ''}`} />
                  {generating ? '生成中...' : '生成新创意'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Summary Statistics */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">总创意数</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{summary.total}</p>
                  </div>
                  <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <FileText className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">草稿</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{summary.draft}</p>
                  </div>
                  <div className="h-12 w-12 bg-gray-100 rounded-full flex items-center justify-center">
                    <FileText className="w-6 h-6 text-gray-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">已同步</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{summary.synced}</p>
                  </div>
                  <div className="h-12 w-12 bg-purple-100 rounded-full flex items-center justify-center">
                    <RefreshCw className="w-6 h-6 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">同步中</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{summary.pending}</p>
                  </div>
                  <div className="h-12 w-12 bg-orange-100 rounded-full flex items-center justify-center">
                    <Wand2 className="w-6 h-6 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Creative Statistics - 创意维度统计 */}
        <div className="mb-6">
          {/* 统一的时间范围选择器 */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">创意统计</h3>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">时间范围:</span>
              <div className="flex gap-1">
                {(['7', '14', '30'] as const).map((days) => (
                  <Button
                    key={days}
                    size="sm"
                    variant={timeRange === days ? 'default' : 'ghost'}
                    className={`h-8 px-3 text-sm ${timeRange === days ? '' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    onClick={() => selectPresetTimeRange(days)}
                    aria-label={`${days}天`}
                  >
                    <span className="sm:hidden">{days}</span>
                    <span className="hidden sm:inline">{days}天</span>
                  </Button>
                ))}
                <DateRangePicker
                  value={dateRange}
                  onChange={handleDateRangeChange}
                  placeholder={customRangeLabel}
                  variant={timeRange === 'custom' ? 'default' : 'ghost'}
                  size="sm"
                  maxDate={new Date()}
                  showPresets={false}
                  showClearButton={true}
                  compact={true}
                  className="max-w-[190px]"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
            {/* 新增创意趋势 - 2/5 */}
            <div className="lg:col-span-2">
              <TrendChart
                data={trendsData}
                metrics={[
                  { key: 'newCreatives', label: '新增创意', color: 'hsl(217, 91%, 60%)' },
                ]}
                title="新增创意趋势"
                description="每日新增创意数量"
                loading={trendsLoading}
                error={trendsError}
                onRetry={fetchTrends}
                height={220}
                hideTimeRangeSelector={true}
                chartType="bar"
              />
            </div>

            {/* 创意质量趋势 - 2/5 */}
            <div className="lg:col-span-2">
              <TrendChart
                data={trendsData}
                metrics={[
                  { key: 'highQuality', label: '高质量(≥80)', color: 'hsl(142, 76%, 36%)' },
                  { key: 'mediumQuality', label: '中等(60-79)', color: 'hsl(45, 93%, 47%)' },
                  { key: 'lowQuality', label: '低质量(<60)', color: 'hsl(0, 84%, 60%)' },
                ]}
                title="创意质量分布趋势"
                description="按质量评分分类"
                loading={trendsLoading}
                error={trendsError}
                onRetry={fetchTrends}
                height={220}
                hideTimeRangeSelector={true}
              />
            </div>

            {/* 质量评分分布 + 创意使用情况 上下排列 - 1/5 */}
            <div className="lg:col-span-1 flex flex-col gap-4">
              {/* 质量评分分布 */}
              {distributions && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <h4 className="text-sm font-medium text-gray-600 mb-3">质量评分分布</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">优秀 (≥90)</span>
                        <span className="text-sm font-semibold text-green-600">{distributions.quality.excellent || 0}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">良好 (75-89)</span>
                        <span className="text-sm font-semibold text-blue-600">{distributions.quality.good || 0}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">一般 (60-74)</span>
                        <span className="text-sm font-semibold text-yellow-600">{distributions.quality.average || 0}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">较差 (&lt;60)</span>
                        <span className="text-sm font-semibold text-red-600">{distributions.quality.poor || 0}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 创意使用情况 */}
              {usageStats && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <h4 className="text-sm font-medium text-gray-600 mb-3">创意使用情况</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">总创意数</span>
                        <span className="text-sm font-semibold text-gray-900">{usageStats.total}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">已选用</span>
                        <span className="text-sm font-semibold text-green-600">{usageStats.selected}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">使用率</span>
                        <span className="text-sm font-semibold text-blue-600">{usageStats.usageRate}%</span>
                      </div>
                      {/* 使用率进度条 */}
                      <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                        <div
                          className="bg-blue-600 h-1.5 rounded-full transition-all"
                          style={{ width: `${usageStats.usageRate}%` }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Search */}
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="搜索标题、描述或链接..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <option value="all">所有同步状态</option>
                <option value="draft">草稿</option>
                <option value="pending">同步中</option>
                <option value="synced">已同步</option>
                <option value="failed">同步失败</option>
              </Select>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {offerId && offer?.scrapeStatus !== 'completed' && (
          <div className="mb-4 bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            请先完成产品信息抓取后再生成创意
          </div>
        )}

        {/* Content */}
        {filteredCreatives.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow border border-gray-200">
            <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
              <FileText className="w-full h-full" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">未找到创意</h3>
            <p className="mt-2 text-sm text-gray-500">
              {creatives.length === 0
                ? '您还没有创建任何创意，请点击"生成新创意"按钮。'
                : '没有找到符合筛选条件的创意。'}
            </p>
            {creatives.length === 0 && offerId && (
              <div className="mt-6">
                <Button
                  onClick={handleGenerateCreatives}
                  disabled={generating || offer?.scrapeStatus !== 'completed'}
                >
                  <Wand2 className="w-4 h-4 mr-2" />
                  生成第一组创意
                </Button>
              </div>
            )}
            {!offerId && (
              <div className="mt-6">
                <Button onClick={() => router.push('/offers')}>
                  前往Offer列表
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table className="[&_thead_th]:bg-white">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={paginatedCreatives.length > 0 && paginatedCreatives.every(c => selectedCreativeIds.has(c.id))}
                          onCheckedChange={handleSelectAll}
                        />
                      </TableHead>
                      <SortableHeader field="id" className="w-[60px]">ID</SortableHeader>
                      <TableHead className="w-[140px]">创意类型</TableHead>
                      <TableHead className="min-w-[300px]">标题预览</TableHead>
                      <SortableHeader field="score" className="w-[100px]">质量评分</SortableHeader>
                      <SortableHeader field="creationStatus" className="w-[100px]">同步状态</SortableHeader>
                      <SortableHeader field="createdAt" className="w-[150px]">创建时间</SortableHeader>
                      <TableHead className="w-[120px]">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedCreatives.map((creative) => {
                      const creativeType = getCreativeTypeMeta(creative)

                      return (
                        <TableRow key={creative.id} className="hover:bg-gray-50/50">
                        <TableCell>
                          <Checkbox
                            checked={selectedCreativeIds.has(creative.id)}
                            onCheckedChange={(checked) => handleSelectCreative(creative.id, checked as boolean)}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-gray-500">
                          #{creative.id}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={creativeType.className}>
                            {creativeType.shortLabel ? `${creativeType.shortLabel} · ` : ''}
                            {creativeType.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium text-gray-900 line-clamp-1">
                              {creative.headlines.slice(0, 2).map(h => getTextContent(h)).join(' | ')}
                            </div>
                            <div className="text-xs text-gray-500 line-clamp-1">
                              {creative.descriptions.slice(0, 1).map(d => getTextContent(d)).join('')}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {creative.score ? (
                            <div className="flex items-center gap-1">
                              <span className={`font-bold ${
                                creative.score >= 80 ? 'text-green-600' :
                                creative.score >= 60 ? 'text-yellow-600' : 'text-red-600'
                              }`}>
                                {creative.score}
                              </span>
                              <span className="text-gray-400">/100</span>
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {getStatusBadge(creative.creationStatus)}
                            {creative.creationError && (
                              <span className="text-xs text-red-600 max-w-[100px] truncate" title={creative.creationError}>
                                {creative.creationError}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {new Date(creative.createdAt).toLocaleDateString('zh-CN')}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {/* View Detail */}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openDetailDialog(creative)}
                              className="text-blue-600 hover:text-blue-800"
                              title="查看创意详情"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>

                            {/* View Offer Detail */}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => router.push(`/offers/${creative.offerId}`)}
                              className="text-green-600 hover:text-green-800"
                              title="查看关联的Offer详情页"
                            >
                              <Package className="w-4 h-4" />
                            </Button>

                            {/* Delete */}
                            {creative.adId === null && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openDeleteDialog(creative)}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                title="删除创意"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              {/* Pagination Controls - Bottom */}
              {filteredCreatives.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-200">
                  <ResponsivePagination
                    currentPage={currentPage}
                    totalPages={Math.ceil(filteredCreatives.length / pageSize)}
                    totalItems={filteredCreatives.length}
                    pageSize={pageSize}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }}
                    pageSizeOptions={[10, 20, 50, 100]}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="w-[96vw] max-w-6xl max-h-[90vh] overflow-y-auto p-5 sm:p-6 lg:p-8">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              创意详情 #{selectedCreative?.id}
              {selectedCreative && (() => {
                const creativeType = getCreativeTypeMeta(selectedCreative)

                return (
                  <Badge variant="outline" className={creativeType.className}>
                    {creativeType.shortLabel ? `${creativeType.shortLabel} · ` : ''}
                    {creativeType.label}
                  </Badge>
                )
              })()}
              {selectedCreative?.creationStatus === 'synced' && (
                <Badge className="bg-green-600">已同步</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              创建于 {selectedCreative && new Date(selectedCreative.createdAt).toLocaleString('zh-CN')}
            </DialogDescription>
          </DialogHeader>

          {selectedCreative && (
            <div className="space-y-6">
              {/* Ad Preview */}
              <div className="border border-gray-300 rounded-lg p-4 bg-white">
                <p className="text-xs text-gray-500 mb-2">📱 广告预览 (Google Search)</p>
                <div className="bg-gray-50 p-3 rounded">
                  <div className="text-xs text-green-700 mb-1">广告 · {offer?.url || selectedCreative.finalUrl}</div>
                  <div className="text-lg text-blue-600 font-normal leading-snug mb-1">
                    {selectedCreative.headlines.slice(0, 3).map(h => getTextContent(h)).join(' | ')}
                  </div>
                  <div className="text-xs text-gray-600 mb-1">
                    {new URL(selectedCreative.finalUrl).hostname}
                    {selectedCreative.path1 && ` › ${selectedCreative.path1}`}
                    {selectedCreative.path2 && ` › ${selectedCreative.path2}`}
                  </div>
                  <div className="text-sm text-gray-800 leading-relaxed">
                    {selectedCreative.descriptions.map(d => getTextContent(d)).join(' ')}
                  </div>
                </div>
              </div>

              {/* Headlines & Descriptions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">📝 标题 ({selectedCreative.headlines.length})</h4>
                  <div className="space-y-2">
                    {selectedCreative.headlines.map((headline, index) => {
                      const text = getTextContent(headline)
                      return (
                        <div key={index} className="flex justify-between items-center bg-white p-2 rounded border">
                          <span className="text-sm text-gray-900">{text}</span>
                          <span className="text-xs text-gray-400">{text.length}/30</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">📄 描述 ({selectedCreative.descriptions.length})</h4>
                  <div className="space-y-2">
                    {selectedCreative.descriptions.map((description, index) => {
                      const text = getTextContent(description)
                      return (
                        <div key={index} className="flex justify-between items-start bg-white p-2 rounded border">
                          <span className="text-sm text-gray-900 flex-1">{text}</span>
                          <span className="text-xs text-gray-400 ml-2">{text.length}/90</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Keywords */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">🔑 关键词</h4>
                <div className="flex flex-wrap gap-2">
                  {parseKeywords(selectedCreative).map((kw: any, index: number) => (
                    <Badge key={index} variant="secondary" className="bg-blue-100 text-blue-800">
                      {typeof kw === 'string' ? kw : kw.keyword}
                      {typeof kw !== 'string' && (kw.searchVolume ?? 0) > 0 && (
                        <span className="ml-1 text-blue-600 font-medium">
                          ({(kw.searchVolume ?? 0).toLocaleString()})
                        </span>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Callouts */}
              {selectedCreative.callouts && selectedCreative.callouts.length > 0 && (
                <div className="bg-green-50 p-4 rounded-lg">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">✨ Callouts ({selectedCreative.callouts.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedCreative.callouts.map((callout, index) => (
                      <Badge key={index} variant="secondary" className="bg-green-100 text-green-800">
                        {getTextContent(callout)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Sitelinks */}
              {selectedCreative.sitelinks && selectedCreative.sitelinks.length > 0 && (
                <div className="bg-purple-50 p-4 rounded-lg">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">🔗 Sitelinks ({selectedCreative.sitelinks.length})</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {selectedCreative.sitelinks.map((sitelink, index) => (
                      <div key={index} className="bg-white p-3 rounded border border-purple-200">
                        <p className="text-sm font-medium text-purple-700">{getTextContent(sitelink.text)}</p>
                        <p className="text-xs text-gray-500 truncate">{String(sitelink.url ?? '')}</p>
                        {getTextContent(sitelink.description).trim() && (
                          <p className="text-xs text-gray-600 mt-1">{getTextContent(sitelink.description)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Final URL & Score */}
              <div className="flex justify-between items-center bg-gray-50 p-4 rounded-lg">
                <div>
                  <p className="text-sm font-semibold text-gray-700">最终链接</p>
                  <a
                    href={selectedCreative.finalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                  >
                    {selectedCreative.finalUrl}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                {selectedCreative.score && (
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-700">质量评分</p>
                    <p className={`text-2xl font-bold ${
                      selectedCreative.score >= 80 ? 'text-green-600' :
                      selectedCreative.score >= 60 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {selectedCreative.score}/100
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Ad Group Dialog */}
      <Dialog open={!!assigningCreative} onOpenChange={() => setAssigningCreative(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>关联 Ad Group</DialogTitle>
            <DialogDescription>
              选择一个 Ad Group 来关联此创意
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Select value={selectedAdGroupId} onValueChange={setSelectedAdGroupId}>
              <option value="">选择 Ad Group</option>
              {adGroups.map((ag) => (
                <option key={ag.id} value={ag.id.toString()}>
                  {ag.adGroupName}
                </option>
              ))}
            </Select>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssigningCreative(null)}>
              取消
            </Button>
            <Button onClick={handleAssignAdGroup} disabled={!selectedAdGroupId}>
              确认关联
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Delete Dialog */}
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open)
          if (!open && !deleteSubmitting) {
            setDeleteTarget(null)
            setDeleteError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除广告创意</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要永久删除创意{' '}
                  <strong className="text-gray-900">#{deleteTarget?.id || '-'}</strong> 吗？
                </p>
                {deleteTarget?.headlines?.length ? (
                  <p className="text-sm text-gray-600 line-clamp-2">
                    标题预览：{getTextContent(deleteTarget.headlines[0])}
                  </p>
                ) : null}
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">删除后将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>从创意列表中彻底移除该条记录</li>
                    <li>仅删除本地记录，不会触发新的 Google Ads 操作</li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
                {deleteError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 whitespace-pre-line">
                    {deleteError}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSubmitting}>取消</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={confirmDeleteCreative}
              disabled={deleteSubmitting || !deleteTarget}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteSubmitting ? '删除中...' : '确认删除'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Delete Dialog */}
      <AlertDialog open={isBatchDeleteDialogOpen} onOpenChange={setIsBatchDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量删除</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>您确定要删除选中的 <strong>{selectedCreativeIds.size}</strong> 个创意吗？</p>
              <p className="text-red-600">此操作无法撤销！</p>
              {batchDeleteError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-red-700 text-sm whitespace-pre-line">{batchDeleteError}</p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setBatchDeleteError(null)}>取消</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleBatchDelete}
              disabled={batchDeleting}
            >
              {batchDeleting ? '删除中...' : '确认删除'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
