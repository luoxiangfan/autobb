'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { format, parseISO, subDays } from 'date-fns'
import { ArrowLeft, Coins, Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DateRangePicker, type DateRange } from '@/components/ui/date-range-picker'
import { showError } from '@/lib/toast-utils'
import { formatCurrency } from '@/lib/currency'

type ViewMode = 'brand' | 'date'
type PlatformFilter = 'all' | 'yeahpromos' | 'partnerboost'

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
    platform: PlatformFilter
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

const PLATFORM_LABELS: Record<'yeahpromos' | 'partnerboost', string> = {
  yeahpromos: 'YeahPromos',
  partnerboost: 'PartnerBoost',
}

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

export default function AffiliateCommissionReportPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [dateBounds, setDateBounds] = useState<DateBounds | null>(null)
  const [boundsLoading, setBoundsLoading] = useState(true)
  const dateRangeInitializedRef = useRef(false)
  const [platform, setPlatform] = useState<PlatformFilter>('all')
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

  const allUsersSelected = users.length > 0
    && selectedUserFilters.length === users.length
    && users.every((user) => selectedUserFilters.includes(String(user.id)))
  const userFilterApplied = selectedUserFilters.length > 0 && !allUsersSelected
  const selectedUsersLabel = userFilterApplied
    ? `用户(${selectedUserFilters.length})`
    : '所有用户'

  const boundsQueryString = useMemo(() => {
    const params = new URLSearchParams()
    params.set('meta', 'bounds')
    params.set('platform', platform)
    if (isAdmin && selectedUserFilters.length > 0 && !allUsersSelected) {
      params.set('userIds', selectedUserFilters.join(','))
    }
    return params.toString()
  }, [platform, isAdmin, selectedUserFilters, allUsersSelected])

  useEffect(() => {
    const checkAdminAndLoadUsers = async () => {
      try {
        setUsersLoading(true)
        const usersResponse = await fetch('/api/admin/users?role=user&status=active&limit=200', {
          credentials: 'include',
          cache: 'no-store',
        })

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
    if (!accessResolved) return

    const loadDateBounds = async () => {
      setBoundsLoading(true)
      try {
        const response = await fetch(
          `/api/openclaw/affiliate-commission-report?${boundsQueryString}`,
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
    }

    void loadDateBounds()
  }, [accessResolved, boundsQueryString])

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    params.set('platform', platform)
    params.set('viewMode', viewMode)
    if (isAdmin && selectedUserFilters.length > 0 && !allUsersSelected) {
      params.set('userIds', selectedUserFilters.join(','))
    }
    return params.toString()
  }, [startDate, endDate, platform, viewMode, isAdmin, selectedUserFilters, allUsersSelected])

  const buildScopedQueryString = useCallback((extra: Record<string, string>) => {
    const params = new URLSearchParams(extra)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    params.set('platform', platform)
    if (isAdmin && selectedUserFilters.length > 0 && !allUsersSelected) {
      params.set('userIds', selectedUserFilters.join(','))
    }
    return params.toString()
  }, [startDate, endDate, platform, isAdmin, selectedUserFilters, allUsersSelected])

  const loadReport = useCallback(async () => {
    if (!startDate || !endDate || !accessResolved || boundsLoading) return
    if (isAdmin && usersLoading) return

    setLoading(true)
    try {
      const response = await fetch(`/api/openclaw/affiliate-commission-report?${queryString}`, {
        credentials: 'include',
      })
      const payload = await response.json() as ReportPayload & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || '加载佣金数据失败')
      }
      setReport(payload.report)
      setShowUserScope(Boolean(payload.report.showUserScope))
    } catch (error: any) {
      showError('加载失败', error?.message || '无法加载联盟佣金数据')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [queryString, startDate, endDate, isAdmin, usersLoading, accessResolved, boundsLoading])

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
        ? `${item.username} · ${item.brandName} · ${PLATFORM_LABELS[item.platform]}`
        : `${item.brandName} · ${PLATFORM_LABELS[item.platform]}`
    )
    setBrandDetailRows([])
    setDateDetailRows([])

    try {
      const response = await fetch(
        `/api/openclaw/affiliate-commission-report?${buildScopedQueryString({
          detail: 'brand',
          brandKey: item.brandKey,
        })}`,
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
          reportDate: item.reportDate,
        })}`,
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

  const filterSummaryText = useMemo(() => {
    const parts: string[] = []
    if (startDate && endDate) {
      parts.push(`${startDate} 至 ${endDate}`)
    }
    parts.push(platform === 'all' ? '全部联盟' : PLATFORM_LABELS[platform])
    if (isAdmin) {
      parts.push(userFilterApplied ? selectedUsersLabel : '所有活跃用户')
    } else {
      parts.push('仅本人数据')
    }
    return parts.join(' · ')
  }, [startDate, endDate, platform, isAdmin, userFilterApplied, selectedUsersLabel])

  const filteredCommissionTotal = report?.totalCommission ?? 0

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Link
              href="/openclaw"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              返回 OpenClaw
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">联盟佣金原始数据</h1>
              <p className="text-sm text-muted-foreground mt-1">
                基于 openclaw_affiliate_commission_raw_sync_payloads 聚合展示 YeahPromos / PartnerBoost 佣金
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={() => void loadReport()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            刷新
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>筛选条件</CardTitle>
            <CardDescription>
              {isAdmin
                ? '默认按品牌展示；管理员默认展示所有活跃非管理员用户的数据'
                : '默认按品牌展示；仅展示您自己的佣金数据'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="space-y-2">
                <div className="text-sm font-medium">日期范围</div>
                <DateRangePicker
                  value={dateRange}
                  onChange={handleDateRangeChange}
                  placeholder={boundsLoading ? '加载可选日期...' : '选择日期范围'}
                  minDate={pickerMinDate}
                  maxDate={pickerMaxDate}
                  showPresets={false}
                />
                {dateBounds?.minDate && dateBounds?.maxDate && (
                  <div className="text-xs text-muted-foreground">
                    可选范围：{dateBounds.minDate} 至 {dateBounds.maxDate}
                  </div>
                )}
                {!boundsLoading && dateBounds && !dateBounds.minDate && (
                  <div className="text-xs text-muted-foreground">
                    当前筛选条件下暂无可用日期
                  </div>
                )}
              </div>
              <div className="space-y-2 min-w-[180px]">
                <div className="text-sm font-medium">联盟</div>
                <Select value={platform} onValueChange={(value) => setPlatform(value as PlatformFilter)}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择联盟" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部联盟</SelectItem>
                    <SelectItem value="yeahpromos">YeahPromos</SelectItem>
                    <SelectItem value="partnerboost">PartnerBoost</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isAdmin && (
                <div className="space-y-2 min-w-[180px]">
                  <div className="text-sm font-medium">用户</div>
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
                        className="w-full justify-between font-normal"
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
            </div>
            <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)}>
              <TabsList>
                <TabsTrigger value="brand">按品牌</TabsTrigger>
                <TabsTrigger value="date">按日期</TabsTrigger>
              </TabsList>
            </Tabs>
            </div>

            <div className="rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-purple-900">当前筛选佣金总和</div>
                <div className="text-xs text-purple-700 mt-0.5">{filterSummaryText}</div>
              </div>
              <div className="text-2xl font-semibold text-purple-700 tabular-nums">
                {loading ? (
                  <span className="inline-flex items-center text-base text-purple-600">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    计算中...
                  </span>
                ) : (
                  formatCurrency(filteredCommissionTotal, currency)
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5 text-purple-600" />
                {viewMode === 'brand' ? '品牌佣金明细' : '日期佣金明细'}
              </CardTitle>
              <CardDescription>
                {viewMode === 'brand'
                  ? '点击品牌行可查看按日期的佣金明细'
                  : '点击日期行可查看该日各品牌佣金明细'}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                加载中...
              </div>
            ) : viewMode === 'brand' ? (
              <Table>
                <TableHeader>
                  <TableRow>
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
                        className="text-center text-muted-foreground py-10"
                      >
                        所选范围内暂无佣金数据
                      </TableCell>
                    </TableRow>
                  ) : (
                    report?.brandSummaries.map((item) => (
                      <TableRow key={item.brandKey}>
                        {showUserScope && (
                          <TableCell>{item.username || '-'}</TableCell>
                        )}
                        <TableCell className="font-medium">{item.brandName}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{PLATFORM_LABELS[item.platform]}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.totalCommission, currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => void openBrandDetail(item)}>
                            查看明细
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">佣金总和</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(report?.dateSummaries || []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-10">
                        所选范围内暂无佣金数据
                      </TableCell>
                    </TableRow>
                  ) : (
                    report?.dateSummaries.map((item) => (
                      <TableRow key={item.reportDate}>
                        <TableCell className="font-medium">{item.reportDate}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.totalCommission, currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => void openDateDetail(item)}>
                            查看明细
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
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
                        <Badge variant="outline">{PLATFORM_LABELS[row.platform]}</Badge>
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
