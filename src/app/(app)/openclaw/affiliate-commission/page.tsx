'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { format, parseISO, subDays } from 'date-fns'
import { ArrowLeft, CalendarDays, Coins, LayoutGrid, Loader2, RefreshCw, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DateRangePicker, type DateRange } from '@/components/ui/date-range-picker'
import { showError } from '@/lib/toast-utils'
import { formatCurrency } from '@/lib/currency'
import {
  filterAffiliatesWithRawCommissionSupport,
  getAffiliatePlatformDisplayName,
  type AffiliateCommissionReportPlatformFilter } from '@/lib/openclaw/affiliate-commission-platform'

type ViewMode = 'brand' | 'date'

type BrandSummary = {
  brandKey: string
  brandName: string
  platform: 'yeahpromos' | 'partnerboost'
  totalCommission: number
  userId?: number
  username?: string
}

type DateSummary = {
  reportDate: string
  totalCommission: number
}

type DateBounds = {
  minDate: string | null
  maxDate: string | null
}

type ReportPayload = {
  success: boolean
  isAdmin?: boolean
  report: {
    startDate: string
    endDate: string
    platform: AffiliateCommissionReportPlatformFilter
    viewMode: ViewMode
    currency: string
    totalCommission: number
    showUserScope: boolean
    dateBounds: DateBounds
    brandSummaries: BrandSummary[]
    dateSummaries: DateSummary[]
  }
}

type BoundsPayload = {
  success: boolean
  dateBounds: DateBounds
}

type BrandDetailPayload = {
  success: boolean
  items: Array<{ reportDate: string; commission: number }>
}

type DateDetailPayload = {
  success: boolean
  showUserScope?: boolean
  items: Array<{
    brandKey: string
    brandName: string
    platform: 'yeahpromos' | 'partnerboost'
    commission: number
    userId?: number
    username?: string
  }>
}

const PLATFORM_BADGE_CLASS: Record<'yeahpromos' | 'partnerboost', string> = {
  yeahpromos: 'border-sky-200 bg-sky-50 text-sky-700',
  partnerboost: 'border-orange-200 bg-orange-50 text-orange-700' }

function formatYmd(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function parseYmd(value: string): Date {
  return parseISO(value)
}

function buildInitialDateRange(bounds: DateBounds): DateRange | undefined {
  if (!bounds.minDate || !bounds.maxDate) return undefined

  const min = parseYmd(bounds.minDate)
  const max = parseYmd(bounds.maxDate)
  const preferredFrom = subDays(max, 29)
  const from = preferredFrom < min ? min : preferredFrom

  return { from, to: max }
}

function clampRangeToBounds(range: DateRange | undefined, bounds: DateBounds): DateRange | undefined {
  if (!range?.from || !bounds.minDate || !bounds.maxDate) return range

  const min = parseYmd(bounds.minDate)
  const max = parseYmd(bounds.maxDate)
  let from = range.from < min ? min : range.from
  let to = range.to && range.to > max ? max : (range.to || range.from)
  if (to < min) to = min
  if (from > max) from = max
  if (from > to) return { from: min, to: max }

  return { from, to }
}

function dateRangesEqual(left: DateRange | undefined, right: DateRange | undefined): boolean {
  if (!left?.from || !right?.from) return left === right
  const leftTo = left.to || left.from
  const rightTo = right.to || right.from
  return formatYmd(left.from) === formatYmd(right.from)
    && formatYmd(leftTo) === formatYmd(rightTo)
}

export default function AffiliateCommissionReportPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [dateBounds, setDateBounds] = useState<DateBounds | null>(null)
  const [boundsLoading, setBoundsLoading] = useState(true)
  const dateRangeInitializedRef = useRef(false)
  const [affiliateFilter, setAffiliateFilter] = useState<string>('all')
  const [affiliates, setAffiliates] = useState<Array<{ name: string; count: number }>>([])
  const [affiliatesLoading, setAffiliatesLoading] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('brand')
  const [loading, setLoading] = useState(true)
  const [report, setReport] = useState<ReportPayload['report'] | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [accessResolved, setAccessResolved] = useState(false)
  const [users, setUsers] = useState<Array<{ id: number; username: string; email: string }>>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [selectedUserFilters, setSelectedUserFilters] = useState<string[]>([])
  const [pendingUserFilters, setPendingUserFilters] = useState<string[]>([])
  const [userFilterMenuOpen, setUserFilterMenuOpen] = useState(false)
  const userSelectionInitializedRef = useRef(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailTitle, setDetailTitle] = useState('')
  const [detailType, setDetailType] = useState<'brand' | 'date'>('brand')
  const [showUserScope, setShowUserScope] = useState(false)
  const [brandDetailRows, setBrandDetailRows] = useState<BrandDetailPayload['items']>([])
  const [dateDetailRows, setDateDetailRows] = useState<DateDetailPayload['items']>([])

  const startDate = dateRange?.from ? formatYmd(dateRange.from) : ''
  const endDate = dateRange?.to ? formatYmd(dateRange.to) : startDate

  const commissionAffiliates = useMemo(
    () => filterAffiliatesWithRawCommissionSupport(affiliates),
    [affiliates]
  )

  const allUsersSelected = users.length > 0
    && selectedUserFilters.length === users.length
    && users.every((user) => selectedUserFilters.includes(String(user.id)))
  const userFilterApplied = selectedUserFilters.length > 0 && !allUsersSelected
  const selectedUsersLabel = userFilterApplied
    ? `用户(${selectedUserFilters.length})`
    : '所有用户'

  const boundsUserScopeKey = useMemo(() => {
    if (!isAdmin) return 'self'
    if (selectedUserFilters.length === 0) return 'none'
    return selectedUserFilters.slice().sort((left, right) => left.localeCompare(right)).join(',')
  }, [isAdmin, selectedUserFilters])

  useEffect(() => {
    const checkAdminAndLoadUsers = async () => {
      try {
        setUsersLoading(true)
        const usersResponse = await fetch('/api/admin/users?role=user&status=active&limit=200', {
          credentials: 'include',
          cache: 'no-store' })

        if (usersResponse.status === 403 || usersResponse.status === 401) {
          setIsAdmin(false)
          return
        }

        if (usersResponse.ok) {
          const data = await usersResponse.json()
          const fetchedUsers: Array<{ id: number; username: string; email: string }> = data.users || []
          setUsers(fetchedUsers)
          if (!userSelectionInitializedRef.current && fetchedUsers.length > 0) {
            const initialUserIds = fetchedUsers.map((user) => String(user.id))
            setSelectedUserFilters(initialUserIds)
            setPendingUserFilters(initialUserIds)
            userSelectionInitializedRef.current = true
          }
          setIsAdmin(true)
        } else {
          setIsAdmin(false)
        }
      } catch (error) {
        console.error('检查管理员权限或加载用户列表失败:', error)
        setIsAdmin(false)
      } finally {
        setUsersLoading(false)
        setAccessResolved(true)
      }
    }

    void checkAdminAndLoadUsers()
  }, [])

  useEffect(() => {
    const loadAffiliates = async () => {
      setAffiliatesLoading(true)
      try {
        const response = await fetch('/api/campaigns/affiliate-platforms', { credentials: 'include' })
        if (response.ok) {
          const data = await response.json()
          setAffiliates(data.affiliates || [])
        }
      } catch (error) {
        console.error('加载联盟平台列表失败:', error)
      } finally {
        setAffiliatesLoading(false)
      }
    }

    void loadAffiliates()
  }, [])

  useEffect(() => {
    if (affiliateFilter === 'all') return
    const stillAvailable = commissionAffiliates.some((affiliate) => affiliate.name === affiliateFilter)
    if (!stillAvailable) {
      setAffiliateFilter('all')
    }
  }, [affiliateFilter, commissionAffiliates])

  const loadDateBounds = useCallback(async () => {
    setBoundsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('meta', 'bounds')
      params.set('platform', affiliateFilter)
      if (isAdmin && selectedUserFilters.length > 0) {
        params.set('userIds', selectedUserFilters.join(','))
      }

      const response = await fetch(
        `/api/openclaw/affiliate-commission-report?${params.toString()}`,
        { credentials: 'include' }
      )
      const payload = await response.json() as BoundsPayload & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || '加载可选日期范围失败')
      }

      const nextBounds = payload.dateBounds
      setDateBounds(nextBounds)

      if (!nextBounds.minDate || !nextBounds.maxDate) {
        setDateRange(undefined)
        dateRangeInitializedRef.current = true
        return
      }

      setDateRange((current) => {
        if (!dateRangeInitializedRef.current) {
          dateRangeInitializedRef.current = true
          return buildInitialDateRange(nextBounds)
        }
        return clampRangeToBounds(current, nextBounds)
      })
    } catch (error: any) {
      showError('加载日期范围失败', error?.message || '无法获取数据日期范围')
      setDateBounds(null)
    } finally {
      setBoundsLoading(false)
    }
  }, [affiliateFilter, isAdmin, selectedUserFilters])

  useEffect(() => {
    if (!accessResolved) return
    void loadDateBounds()
  }, [accessResolved, boundsUserScopeKey, loadDateBounds])

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    params.set('platform', affiliateFilter)
    params.set('viewMode', viewMode)
    if (isAdmin && selectedUserFilters.length > 0) {
      params.set('userIds', selectedUserFilters.join(','))
    }
    return params.toString()
  }, [startDate, endDate, affiliateFilter, viewMode, isAdmin, selectedUserFilters])

  const buildScopedQueryString = useCallback((extra: Record<string, string>) => {
    const params = new URLSearchParams(extra)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    params.set('platform', affiliateFilter)
    if (isAdmin && selectedUserFilters.length > 0) {
      params.set('userIds', selectedUserFilters.join(','))
    }
    return params.toString()
  }, [startDate, endDate, affiliateFilter, isAdmin, selectedUserFilters])

  const applyReportPayload = useCallback((payload: ReportPayload['report']) => {
    setReport(payload)
    setShowUserScope(Boolean(payload.showUserScope))

    const nextBounds = payload.dateBounds
    setDateBounds(nextBounds)
    if (!nextBounds.minDate || !nextBounds.maxDate) {
      return
    }

    setDateRange((current) => {
      if (!dateRangeInitializedRef.current) {
        dateRangeInitializedRef.current = true
        return buildInitialDateRange(nextBounds)
      }
      const nextRange = clampRangeToBounds(current, nextBounds)
      return dateRangesEqual(current, nextRange) ? current : nextRange
    })
  }, [])

  const loadReport = useCallback(async () => {
    if (!startDate || !endDate || !accessResolved || boundsLoading) return
    if (isAdmin && usersLoading) return

    setLoading(true)
    try {
      const response = await fetch(`/api/openclaw/affiliate-commission-report?${queryString}`, {
        credentials: 'include' })
      const payload = await response.json() as ReportPayload & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || '加载佣金数据失败')
      }
      applyReportPayload(payload.report)
    } catch (error: any) {
      showError('加载失败', error?.message || '无法加载联盟佣金数据')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [queryString, startDate, endDate, isAdmin, usersLoading, accessResolved, boundsLoading, applyReportPayload])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

  const pickerMinDate = useMemo(
    () => (dateBounds?.minDate ? parseYmd(dateBounds.minDate) : undefined),
    [dateBounds?.minDate]
  )
  const pickerMaxDate = useMemo(
    () => (dateBounds?.maxDate ? parseYmd(dateBounds.maxDate) : undefined),
    [dateBounds?.maxDate]
  )

  const handleDateRangeChange = useCallback((range: DateRange | undefined) => {
    if (!range || !dateBounds?.minDate || !dateBounds?.maxDate) {
      setDateRange(range)
      return
    }
    setDateRange(clampRangeToBounds(range, dateBounds))
  }, [dateBounds])

  const openBrandDetail = async (item: BrandSummary) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailType('brand')
    setDetailTitle(
      showUserScope && item.username
        ? `${item.username} · ${item.brandName} · ${getAffiliatePlatformDisplayName(item.platform)}`
        : `${item.brandName} · ${getAffiliatePlatformDisplayName(item.platform)}`
    )
    setBrandDetailRows([])
    setDateDetailRows([])

    try {
      const response = await fetch(
        `/api/openclaw/affiliate-commission-report?${buildScopedQueryString({
          detail: 'brand',
          brandKey: item.brandKey })}`,
        { credentials: 'include' }
      )
      const payload = await response.json() as BrandDetailPayload & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || '加载品牌明细失败')
      }
      setBrandDetailRows(payload.items)
    } catch (error: any) {
      showError('加载明细失败', error?.message || '无法加载品牌佣金明细')
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  const openDateDetail = async (item: DateSummary) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailType('date')
    setDetailTitle(`日期 ${item.reportDate}`)
    setBrandDetailRows([])
    setDateDetailRows([])

    try {
      const response = await fetch(
        `/api/openclaw/affiliate-commission-report?${buildScopedQueryString({
          detail: 'date',
          reportDate: item.reportDate })}`,
        { credentials: 'include' }
      )
      const payload = await response.json() as DateDetailPayload & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || '加载日期明细失败')
      }
      setDateDetailRows(payload.items)
      if (typeof payload.showUserScope === 'boolean') {
        setShowUserScope(payload.showUserScope)
      }
    } catch (error: any) {
      showError('加载明细失败', error?.message || '无法加载日期佣金明细')
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  const currency = report?.currency || 'USD'

  const filteredCommissionTotal = report?.totalCommission ?? 0

  return (
    <div className="min-h-screen bg-slate-50/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Link
              href="/openclaw"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              返回 OpenClaw
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">联盟佣金原始数据</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                聚合展示 YeahPromos / PartnerBoost 佣金，支持按品牌或日期下钻
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className="shrink-0 bg-white shadow-xs"
            onClick={() => void loadReport()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            刷新
          </Button>
        </div>

        <Card className="overflow-hidden border-violet-200/70 bg-linear-to-br from-violet-50 via-purple-50 to-fuchsia-50 shadow-xs">
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-white/80 p-3 shadow-xs ring-1 ring-violet-100">
                  <Coins className="h-6 w-6 text-violet-600" />
                </div>
                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-medium text-violet-900/80">当前筛选佣金总和</p>
                    <p className="mt-1 text-xs text-violet-700/70">
                      {isAdmin
                        ? '管理员视图 · 默认包含所有活跃非管理员用户'
                        : '个人视图 · 仅展示您自己的佣金数据'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {startDate && endDate && (
                      <Badge variant="secondary" className="border border-violet-200/80 bg-white/70 text-violet-800">
                        {startDate} ~ {endDate}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="border border-violet-200/80 bg-white/70 text-violet-800">
                      {affiliateFilter === 'all' ? '全部联盟' : affiliateFilter}
                    </Badge>
                    <Badge variant="secondary" className="border border-violet-200/80 bg-white/70 text-violet-800">
                      {isAdmin
                        ? (userFilterApplied ? selectedUsersLabel : '所有活跃用户')
                        : '仅本人数据'}
                    </Badge>
                    <Badge variant="secondary" className="border border-violet-200/80 bg-white/70 text-violet-800">
                      {viewMode === 'brand' ? '按品牌' : '按日期'}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="sm:text-right">
                {loading ? (
                  <span className="inline-flex items-center text-base text-violet-600">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    计算中...
                  </span>
                ) : (
                  <p className="text-3xl font-bold tabular-nums tracking-tight text-violet-700 sm:text-4xl">
                    {formatCurrency(filteredCommissionTotal, currency)}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">筛选与视图</CardTitle>
            <CardDescription>
              调整日期、联盟与用户范围；切换下方表格的聚合维度
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] xl:items-end">
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    日期范围
                  </div>
                  {dateBounds?.minDate && dateBounds?.maxDate && (
                    <span className="text-[11px] text-muted-foreground">
                      可选 {dateBounds.minDate} ~ {dateBounds.maxDate}
                    </span>
                  )}
                </div>
                <DateRangePicker
                  value={dateRange}
                  onChange={handleDateRangeChange}
                  placeholder={boundsLoading ? '加载可选日期...' : '选择日期范围'}
                  minDate={pickerMinDate}
                  maxDate={pickerMaxDate}
                  showPresets={false}
                  className="w-full bg-white"
                />
                {!boundsLoading && dateBounds && !dateBounds.minDate && (
                  <p className="mt-2 text-xs text-amber-600">当前筛选条件下暂无可用日期</p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <LayoutGrid className="h-3.5 w-3.5" />
                  联盟
                </div>
                <Select
                  value={affiliateFilter}
                  onValueChange={setAffiliateFilter}
                  disabled={affiliatesLoading}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder={affiliatesLoading ? '加载联盟...' : '选择联盟'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部联盟</SelectItem>
                    {commissionAffiliates.map((affiliate) => (
                      <SelectItem key={affiliate.name} value={affiliate.name}>
                        {affiliate.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isAdmin && (
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    用户
                  </div>
                  <DropdownMenu
                    open={userFilterMenuOpen}
                    onOpenChange={(open) => {
                      if (open) {
                        setPendingUserFilters(selectedUserFilters.slice())
                      }
                      setUserFilterMenuOpen(open)
                    }}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-between bg-white font-normal"
                        disabled={usersLoading}
                      >
                        {selectedUsersLabel}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-64 max-h-80 overflow-y-auto p-0">
                      <div className="max-h-64 overflow-y-auto p-1">
                        <DropdownMenuItem
                          onSelect={(event) => {
                            event.preventDefault()
                            setPendingUserFilters((prev) => {
                              const pendingAllSelected = users.length > 0
                                && prev.length === users.length
                                && users.every((user) => prev.includes(String(user.id)))
                              if (pendingAllSelected) {
                                return []
                              }
                              return users.map((user) => String(user.id))
                            })
                          }}
                        >
                          <Checkbox
                            checked={
                              users.length > 0
                              && pendingUserFilters.length === users.length
                              && users.every((user) => pendingUserFilters.includes(String(user.id)))
                            }
                            className="mr-2"
                          />
                          {users.length > 0
                            && pendingUserFilters.length === users.length
                            && users.every((user) => pendingUserFilters.includes(String(user.id)))
                            ? '取消全选'
                            : '全选'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {users.map((user) => {
                          const userId = String(user.id)
                          const checked = pendingUserFilters.includes(userId)
                          return (
                            <DropdownMenuItem
                              key={user.id}
                              onSelect={(event) => {
                                event.preventDefault()
                                setPendingUserFilters((prev) => {
                                  const exists = prev.includes(userId)
                                  if (exists) {
                                    return prev.filter((id) => id !== userId)
                                  }
                                  return [...prev, userId]
                                })
                              }}
                            >
                              <Checkbox checked={checked} className="mr-2" />
                              {user.username}
                            </DropdownMenuItem>
                          )
                        })}
                      </div>
                      <div className="flex justify-end gap-2 border-t p-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setUserFilterMenuOpen(false)}
                        >
                          取消
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            setBoundsLoading(true)
                            const nextFilters = pendingUserFilters.slice()
                            setSelectedUserFilters(nextFilters)
                            setUserFilterMenuOpen(false)
                          }}
                        >
                          确认
                        </Button>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 xl:min-w-[180px]">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  展示维度
                </div>
                <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)} className="w-full">
                  <TabsList className="grid h-10 w-full grid-cols-2 bg-white">
                    <TabsTrigger value="brand">按品牌</TabsTrigger>
                    <TabsTrigger value="date">按日期</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs">
          <CardHeader className="pb-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Coins className="h-5 w-5 text-violet-600" />
                {viewMode === 'brand' ? '品牌佣金明细' : '日期佣金明细'}
              </CardTitle>
              <CardDescription className="mt-1">
                {viewMode === 'brand'
                  ? '点击品牌行可查看按日期的佣金明细'
                  : '点击日期行可查看该日各品牌佣金明细'}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="flex items-center justify-center rounded-xl border border-dashed py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                加载中...
              </div>
            ) : viewMode === 'brand' ? (
              <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                    {showUserScope && <TableHead>所属用户</TableHead>}
                    <TableHead>品牌名称</TableHead>
                    <TableHead>所属联盟</TableHead>
                    <TableHead className="text-right">佣金总和</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(report?.brandSummaries || []).length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={showUserScope ? 5 : 4}
                        className="py-12 text-center text-muted-foreground"
                      >
                        所选范围内暂无佣金数据
                      </TableCell>
                    </TableRow>
                  ) : (
                    report?.brandSummaries.map((item) => (
                      <TableRow key={item.brandKey} className="transition-colors hover:bg-violet-50/40">
                        {showUserScope && (
                          <TableCell className="text-muted-foreground">{item.username || '-'}</TableCell>
                        )}
                        <TableCell className="font-medium">{item.brandName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={PLATFORM_BADGE_CLASS[item.platform]}>
                            {getAffiliatePlatformDisplayName(item.platform)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(item.totalCommission, currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="text-violet-700 hover:text-violet-800 hover:bg-violet-50" onClick={() => void openBrandDetail(item)}>
                            查看明细
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">佣金总和</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(report?.dateSummaries || []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-12 text-center text-muted-foreground">
                        所选范围内暂无佣金数据
                      </TableCell>
                    </TableRow>
                  ) : (
                    report?.dateSummaries.map((item) => (
                      <TableRow key={item.reportDate} className="transition-colors hover:bg-violet-50/40">
                        <TableCell className="font-medium">{item.reportDate}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(item.totalCommission, currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="text-violet-700 hover:text-violet-800 hover:bg-violet-50" onClick={() => void openDateDetail(item)}>
                            查看明细
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detailTitle}</DialogTitle>
            <DialogDescription>
              {detailType === 'brand' ? '按日期展示该品牌的佣金明细' : '展示该日期下有佣金的品牌明细'}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              加载明细中...
            </div>
          ) : detailType === 'brand' ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead className="text-right">佣金</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {brandDetailRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                      暂无明细
                    </TableCell>
                  </TableRow>
                ) : (
                  brandDetailRows.map((row) => (
                    <TableRow key={row.reportDate}>
                      <TableCell>{row.reportDate}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.commission, currency)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {showUserScope && <TableHead>所属用户</TableHead>}
                  <TableHead>品牌名称</TableHead>
                  <TableHead>所属联盟</TableHead>
                  <TableHead className="text-right">佣金</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dateDetailRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={showUserScope ? 4 : 3}
                      className="text-center text-muted-foreground py-8"
                    >
                      暂无明细
                    </TableCell>
                  </TableRow>
                ) : (
                  dateDetailRows.map((row) => (
                    <TableRow key={row.brandKey}>
                      {showUserScope && (
                        <TableCell>{row.username || '-'}</TableCell>
                      )}
                      <TableCell>{row.brandName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={PLATFORM_BADGE_CLASS[row.platform]}>
                          {getAffiliatePlatformDisplayName(row.platform)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(row.commission, currency)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
