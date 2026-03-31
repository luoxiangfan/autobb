'use client'

/**
 * Step 2: Google Ads Account Linking
 * 关联Google Ads账号、OAuth授权
 *
 * 账号筛选规则：
 * 1. 不能是 MCC 账号（manager !== true）
 * 2. 过滤取消/关闭等不可用账号
 *
 * 🔓 KISS优化(2025-12-12): 移除独占约束，允许多个Offer共享同一Ads账号
 * 优先级排序：当前Offer已用 > 同品牌Offer已用 > 未使用
 */

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Link2, CheckCircle2, AlertCircle, Plus, RefreshCw, ExternalLink, Loader2, Info } from 'lucide-react'
import { showError, showSuccess } from '@/lib/toast-utils'
import Link from 'next/link'

interface Props {
  offer: any
  onAccountsLinked: (accounts: any[]) => void
  selectedAccounts: any[]
}

interface GoogleAdsAccount {
  customerId: string
  descriptiveName: string
  currencyCode: string
  timeZone: string
  manager: boolean
  testAccount: boolean
  status: string
  identityVerification?: {
    programStatus: string | null
    startDeadlineTime: string | null
    completionDeadlineTime: string | null
    overdue: boolean
    checkedAt: string | null
  }
  parentMcc?: string
  parentMccName?: string
  dbAccountId: number | null
  lastSyncAt?: string
  accountBalance?: number | null  // 账户余额（微单位，需除以1000000）
  linkedOffers?: Array<{
    id: number
    offerName: string | null
    brand: string
    targetCountry: string
    isActive: boolean
    campaignCount: number
  }>
  // 🔓 KISS优化(2025-12-12): 优先级标识
  priority?: 'current' | 'same-brand' | 'none'
  priorityScore?: number
}

// 格式化账户余额显示
const formatBalance = (balance: number | null | undefined, currency: string): string => {
  if (balance === null || balance === undefined) return '-'
  // Google Ads API 返回的金额是微单位，需要除以 1,000,000
  const amount = balance / 1000000
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)
}

const getAccountStatusBadge = (status: string | null | undefined) => {
  const statusUpper = String(status || 'UNKNOWN').toUpperCase()

  if (statusUpper === 'ENABLED') {
    return <Badge className="bg-green-100 text-green-800 border-green-300">启用</Badge>
  }

  if (statusUpper === 'PAUSED') {
    return <Badge className="bg-amber-100 text-amber-800 border-amber-300">暂停</Badge>
  }

  if (statusUpper === 'SUSPENDED' || statusUpper === 'DISABLED') {
    return <Badge className="bg-red-100 text-red-800 border-red-300">受限</Badge>
  }

  if (statusUpper === 'CANCELED' || statusUpper === 'CANCELLED' || statusUpper === 'CLOSED') {
    return <Badge className="bg-gray-100 text-gray-800 border-gray-300">已关闭</Badge>
  }

  if (statusUpper === 'UNKNOWN' || statusUpper === 'UNSPECIFIED') {
    return <Badge className="bg-gray-100 text-gray-800 border-gray-300">未知</Badge>
  }

  return <Badge className="bg-gray-100 text-gray-800 border-gray-300">{statusUpper}</Badge>
}

const MAX_SELECTABLE_ACCOUNTS = 10

export default function Step2AccountLinking({ offer, onAccountsLinked, selectedAccounts }: Props) {
  const [accounts, setAccounts] = useState<GoogleAdsAccount[]>([])
  const [accountStats, setAccountStats] = useState({
    total: 0,
    available: 0,
    filteredManager: 0,
    filteredClosed: 0,
  })
  const [selectedIds, setSelectedIds] = useState<string[]>(selectedAccounts.map(account => account.customerId))
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const refreshPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hasCredentials, setHasCredentials] = useState(false)
  const [isCached, setIsCached] = useState(false)
  const [cacheStale, setCacheStale] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [refreshInProgress, setRefreshInProgress] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [showGuideDialog, setShowGuideDialog] = useState(false)

  useEffect(() => {
    setSelectedIds(selectedAccounts.map(account => account.customerId))
  }, [selectedAccounts])

  useEffect(() => {
    checkCredentials()
    fetchAccounts()

    return () => {
      if (refreshPollTimerRef.current) {
        clearTimeout(refreshPollTimerRef.current)
        refreshPollTimerRef.current = null
      }
    }
  }, [])

  const checkCredentials = async () => {
    try {
      const response = await fetch('/api/google-ads/credentials', {
        credentials: 'include'
      })

      if (response.ok) {
        const data = await response.json()
        setHasCredentials(Boolean(data?.data?.hasCredentials))
      }
    } catch (error) {
      console.error('Failed to check credentials:', error)
    }
  }

  const scheduleRefreshPoll = () => {
    if (refreshPollTimerRef.current) clearTimeout(refreshPollTimerRef.current)
    refreshPollTimerRef.current = setTimeout(() => {
      fetchAccounts(false, true)
    }, 2000)
  }

  const fetchAccounts = async (forceRefresh: boolean = false, isPoll: boolean = false) => {
    try {
      if (forceRefresh) {
        setRefreshing(true)
      } else if (!isPoll) {
        setLoading(true)
      }
      setRefreshFailed(false)

      // 🔧 修复(2025-12-26): 检查认证类型，支持服务账号模式
      const credResponse = await fetch('/api/google-ads/credentials', {
        credentials: 'include'
      })
      const credData = await credResponse.json()
      const authType = credData.data?.authType || 'oauth'
      const serviceAccountId = credData.data?.serviceAccountId

      // 构建查询参数
      const params = new URLSearchParams({
        refresh: forceRefresh ? 'true' : 'false',
        offerId: offer.id.toString(),
        auth_type: authType,
      })
      // async 刷新：先返回缓存/部分结果，后台继续同步，前端通过轮询逐步更新
      if (forceRefresh) {
        params.append('async', 'true')
      }
      if (serviceAccountId) {
        params.append('service_account_id', serviceAccountId)
      }

      // 🔓 KISS优化(2025-12-12): 传入offerId用于计算账号优先级
      const response = await fetch(`/api/google-ads/credentials/accounts?${params}`, {
        credentials: 'include'
      })

      if (!response.ok) {
        let errorData: any = null
        try {
          errorData = await response.json()
        } catch {
          errorData = null
        }
        throw new Error(errorData?.message || errorData?.error || '获取账号列表失败')
      }

      const data = await response.json()

      if (data.success && data.data?.accounts) {
        setIsCached(Boolean(data.data.cached))
        setCacheStale(Boolean(data.data.cacheStale))
        setRefreshFailed(Boolean(data.data.refreshFailed))
        setLastSyncAt(data.data.lastSyncAt || null)
        setRefreshInProgress(Boolean(data.data.refreshInProgress))
        setRefreshError(data.data.refreshError || null)

        const allAccounts = data.data.accounts as GoogleAdsAccount[]
        const isClosedOrCanceled = (status: string | null | undefined) => {
          const normalizedStatus = String(status || '').toUpperCase()
          return normalizedStatus === 'CANCELED' || normalizedStatus === 'CANCELLED' || normalizedStatus === 'CLOSED'
        }
        const filteredManagerCount = allAccounts.filter(account => account.manager === true).length
        const filteredClosedCount = allAccounts.filter(account => isClosedOrCanceled(account.status)).length

        // 🔓 KISS优化(2025-12-12): 移除独占约束，只筛选基本条件
        // 筛选可用账号：
        // 1. 不能是 MCC 账号
        // 2. 过滤明显不可用（取消/关闭）的账号
        const availableAccounts = allAccounts.filter(account => {
          // 条件1：不能是 MCC 账号
          if (account.manager === true) return false

          // 条件2：明确不可用的账号不展示（一般不可恢复/不可操作）
          if (isClosedOrCanceled(account.status)) return false

          return true
        })

        setAccountStats({
          total: allAccounts.length,
          available: availableAccounts.length,
          filteredManager: filteredManagerCount,
          filteredClosed: filteredClosedCount,
        })

        // API已按优先级排序，直接使用
        setAccounts(availableAccounts)

        if (forceRefresh) {
          if (data.data.refreshInProgress) {
            showSuccess('已开始刷新', '后台同步中，列表将自动更新')
            scheduleRefreshPoll()
          } else {
            showSuccess('已刷新', `已同步 ${allAccounts.length} 个账号`)
            setRefreshing(false)
          }
        } else if (isPoll) {
          if (data.data.refreshInProgress) {
            scheduleRefreshPoll()
          } else {
            setRefreshing(false)
          }
        }
      } else {
        setAccounts([])
        setAccountStats({ total: 0, available: 0, filteredManager: 0, filteredClosed: 0 })
      }
    } catch (error: any) {
      console.error('获取账号列表失败:', error)
      showError('加载失败', error.message || '获取账号列表失败')
      setRefreshing(false)
      setRefreshInProgress(false)
      setRefreshError(null)
      setAccountStats({ total: 0, available: 0, filteredManager: 0, filteredClosed: 0 })
    } finally {
      if (!isPoll) {
        setLoading(false)
      }
    }
  }

  const handleConnectNewAccount = () => {
    // 显示操作指南弹窗，引导用户添加新账号
    setShowGuideDialog(true)
  }

  const normalizeCurrencyCode = (currencyCode: string | null | undefined): string => {
    return String(currencyCode || '').trim().toUpperCase()
  }

  const getSelectedCurrencyCode = (): string | null => {
    const selectedInFetchedList = accounts.find(item => {
      if (!selectedIds.includes(item.customerId)) return false
      return normalizeCurrencyCode(item.currencyCode).length > 0
    })
    if (selectedInFetchedList) {
      return normalizeCurrencyCode(selectedInFetchedList.currencyCode)
    }

    const selectedInProps = selectedAccounts.find(item => {
      if (!selectedIds.includes(item.customerId)) return false
      return normalizeCurrencyCode(item.currencyCode).length > 0
    })
    if (selectedInProps) {
      return normalizeCurrencyCode(selectedInProps.currencyCode)
    }

    return null
  }

  const handleSelectAccount = (account: GoogleAdsAccount) => {
    if (account.dbAccountId === null) {
      showError('账号暂不可用', '该账号尚未完成本地同步，请先刷新账号列表后重试')
      return
    }

    const isAlreadySelected = selectedIds.includes(account.customerId)
    const nextSelectedIds = isAlreadySelected
      ? selectedIds.filter(id => id !== account.customerId)
      : [...selectedIds, account.customerId]

    const selectedCurrencyCode = getSelectedCurrencyCode()
    const accountCurrencyCode = normalizeCurrencyCode(account.currencyCode)
    if (!isAlreadySelected && selectedCurrencyCode && accountCurrencyCode !== selectedCurrencyCode) {
      showError(
        '币种不一致',
        `仅支持同币种批量发布。当前已选币种为 ${selectedCurrencyCode}，该账号币种为 ${accountCurrencyCode || '未知'}`
      )
      return
    }

    if (!isAlreadySelected && nextSelectedIds.length > MAX_SELECTABLE_ACCOUNTS) {
      showError('选择超限', `最多可选择 ${MAX_SELECTABLE_ACCOUNTS} 个账号`)
      return
    }

    setSelectedIds(nextSelectedIds)

    const transformedAccounts = accounts
      .filter(item => nextSelectedIds.includes(item.customerId) && item.dbAccountId !== null)
      .map(item => ({
        id: item.dbAccountId!,  // Database ID used in Step4
        customerId: item.customerId,
        accountName: item.descriptiveName,
        isActive: item.status === 'ENABLED',
        currencyCode: item.currencyCode,
        status: item.status
      }))

    onAccountsLinked(transformedAccounts)
    const message = transformedAccounts.length > 0
      ? `已选择 ${transformedAccounts.length} 个账号`
      : '已取消所有账号选择'
    showSuccess('账号选择已更新', message)
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">加载账号列表...</p>
        </CardContent>
      </Card>
    )
  }

  const selectedCurrencyCode = getSelectedCurrencyCode()

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-green-600" />
            关联Google Ads账号
          </CardTitle>
          <CardDescription>
            选择或连接Google Ads账号，用于发布广告系列
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleConnectNewAccount} variant="outline">
              <Plus className="w-4 h-4 mr-2" />
              连接新账号
            </Button>
            <Button
              onClick={() => fetchAccounts(true)}
              variant="outline"
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              刷新账号列表
            </Button>
          </div>

          <div className="text-xs text-gray-500">
            {lastSyncAt ? `上次同步：${new Date(lastSyncAt).toLocaleString('zh-CN')}` : '上次同步：-'}
            {isCached ? '（来自缓存）' : '（已实时同步）'}
            {cacheStale ? '（缓存已过期）' : ''}
            {refreshFailed ? '（本次刷新失败，已回退缓存）' : ''}
          </div>

          {accountStats.total > 0 && (
            <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
              口径说明：`/google-ads` 显示可访问账号总数 {accountStats.total}；本步骤展示可选账号 {accountStats.available}
              （已过滤 MCC {accountStats.filteredManager} 个、已关闭账号 {accountStats.filteredClosed} 个）。
            </div>
          )}
        </CardContent>
      </Card>

      {/* No Credentials Warning */}
      {!hasCredentials && accounts.length === 0 && (
        <Alert className="bg-yellow-50 border-yellow-200">
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-900">
            <strong>尚未配置Google Ads凭证</strong>
            <p className="mt-2">
              您需要先在<Link href="/settings" className="text-blue-600 hover:underline">设置页面</Link>配置Google Ads OAuth凭证（Client ID、Client Secret、Developer Token、MCC账号），然后在<Link href="/google-ads" className="text-blue-600 hover:underline">Google Ads管理页面</Link>刷新账户列表。
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Accounts List */}
      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Link2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">暂无可用的Google Ads账号</p>
            <p className="text-sm text-gray-400 mt-2">
              点击"连接新账号"查看添加账号的操作指南
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">可用账号列表</CardTitle>
          <CardDescription>
            最多选择 {MAX_SELECTABLE_ACCOUNTS} 个账号用于同步发布（仅支持同一货币，已按推荐优先级排序）
          </CardDescription>
        </CardHeader>
        <CardContent>
          {selectedCurrencyCode && (
            <div className="mb-2 text-xs text-amber-700">
              已锁定币种：{selectedCurrencyCode}（仅可继续选择相同币种账号）
            </div>
          )}
          <div className="mb-3 text-xs text-gray-600">
            已选择 {selectedIds.length}/{MAX_SELECTABLE_ACCOUNTS}
          </div>
          <Table className="table-fixed min-w-[1120px] [&_thead_th]:bg-white">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">选择</TableHead>
                  <TableHead className="w-[220px]">账号名称</TableHead>
                  <TableHead>账号ID</TableHead>
                  <TableHead className="w-[80px] whitespace-nowrap">状态</TableHead>
                  <TableHead className="w-[90px] whitespace-nowrap">推荐</TableHead>
                  <TableHead>账户余额</TableHead>
                  <TableHead className="w-[200px]">已关联Offer</TableHead>
                  <TableHead>时区</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => {
                  const isSelected = selectedIds.includes(account.customerId)
                  const accountCurrencyCode = normalizeCurrencyCode(account.currencyCode)
                  const isCurrencyCompatible = isSelected
                    || !selectedCurrencyCode
                    || (accountCurrencyCode.length > 0 && accountCurrencyCode === selectedCurrencyCode)
                  const isSelectable = account.dbAccountId !== null && isCurrencyCompatible

                  return (
                    <TableRow
                      key={account.customerId}
                      className={`${isSelectable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'} ${isSelected ? 'bg-green-50' : 'hover:bg-gray-50'}`}
                      onClick={() => {
                        if (!isSelectable) return
                        handleSelectAccount(account)
                      }}
                    >
                      <TableCell>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          isSelected ? 'border-green-600 bg-green-600' : 'border-gray-300'
                        }`}>
                          {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                        </div>
                      </TableCell>
                      <TableCell className="w-[220px]">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="block truncate font-medium" title={account.descriptiveName}>
                            {account.descriptiveName}
                          </span>
                          {account.testAccount && (
                            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 text-xs">
                              测试
                            </Badge>
                          )}
                        </div>
                        {account.parentMcc && (
                          <div className="text-xs text-gray-500 mt-1">
                            MCC: {account.parentMccName || account.parentMcc}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{account.customerId}</TableCell>
                      <TableCell className="w-[80px] whitespace-nowrap">
                        {getAccountStatusBadge(account.status)}
                      </TableCell>
                      <TableCell className="w-[90px] whitespace-nowrap">
                        {/* 🔓 KISS优化(2025-12-12): 优先级标识 */}
                        {account.priority === 'current' && (
                          <Badge className="bg-green-100 text-green-800 border-green-300">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            已用
                          </Badge>
                        )}
                        {account.priority === 'same-brand' && (
                          <Badge className="bg-blue-100 text-blue-800 border-blue-300">
                            同品牌
                          </Badge>
                        )}
                        {account.priority === 'none' && (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatBalance(account.accountBalance, account.currencyCode)}
                      </TableCell>
                      <TableCell className="w-[200px] text-sm">
                        {account.linkedOffers && account.linkedOffers.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {account.linkedOffers.map((linkedOffer) => (
                              <Badge
                                key={linkedOffer.id}
                                variant="outline"
                                className={linkedOffer.id === offer.id ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50'}
                              >
                                #{linkedOffer.id}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{account.timeZone}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            window.open('https://ads.google.com', '_blank')
                          }}
                          title="在Google Ads中查看"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {/* Selected Account Info */}
            {selectedIds.length > 0 && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 text-green-800">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="font-medium">已选择 {selectedIds.length} 个账号</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {accounts
                    .filter(account => selectedIds.includes(account.customerId))
                    .map(account => (
                      <Badge key={account.customerId} variant="secondary">
                        {account.descriptiveName} ({account.customerId})
                      </Badge>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Info Alert */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>账号权限说明</strong>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>需要具有创建和管理广告系列的权限</li>
            <li>建议使用管理员或标准访问权限的账号</li>
            <li>确保账号已完成计费设置</li>
          </ul>
        </AlertDescription>
      </Alert>

      {/* Add New Account Guide Dialog */}
      <Dialog open={showGuideDialog} onOpenChange={setShowGuideDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-600" />
              如何添加新的Google Ads账号
            </DialogTitle>
            <DialogDescription>
              请按照以下步骤操作，完成后返回此页面选择账号
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Step 1 */}
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold">
                1
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-gray-900 mb-1">在MCC账号中添加新的Ads账号</h4>
                <p className="text-sm text-gray-600 mb-2">
                  登录您的Google Ads MCC账号，将新的Ads账号关联到MCC下进行统一管理
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('https://ads.google.com', '_blank')}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  打开Google Ads MCC
                </Button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold">
                2
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-gray-900 mb-1">在系统中刷新账户列表</h4>
                <p className="text-sm text-gray-600 mb-2">
                  前往"Google Ads账号管理"页面，点击"刷新账户列表"按钮同步最新的账号信息
                </p>
                <Link href="/google-ads" target="_blank">
                  <Button variant="outline" size="sm">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    打开Google Ads管理页面
                  </Button>
                </Link>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold">
                3
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-gray-900 mb-1">返回此页面选择账号</h4>
                <p className="text-sm text-gray-600">
                  账号刷新完成后，返回此页面即可在列表中看到新添加的账号
                </p>
              </div>
            </div>

            {/* Important Notes */}
            <Alert className="bg-blue-50 border-blue-200">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                <strong>重要提示</strong>
                <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                  <li>新账号必须在MCC账号下才能被系统识别</li>
                  <li>建议选择状态为“启用(ENABLED)”的账号</li>
                  <li>不支持MCC账号，仅支持普通Ads账号</li>
                  <li>账号刷新可能需要1-2分钟时间</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGuideDialog(false)}>
              我知道了
            </Button>
            <Link href="/google-ads" target="_blank">
              <Button onClick={() => setShowGuideDialog(false)}>
                <RefreshCw className="w-4 h-4 mr-2" />
                前往刷新账号列表
              </Button>
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
