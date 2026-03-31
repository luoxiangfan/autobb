'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface GoogleAdsAccount {
  customerId: string
  descriptiveName: string
  currencyCode: string
  timeZone: string
  manager: boolean
  testAccount: boolean
  status: string
  accountBalance?: number | null  // 账户预算余额（单位：微货币，即实际金额×1,000,000）
  parentMcc?: string
  parentMccName?: string
  identityVerification?: {
    programStatus: string | null
    startDeadlineTime: string | null
    completionDeadlineTime: string | null
    overdue: boolean
    checkedAt: string | null
  }
  dbAccountId: number | null
  lastSyncAt?: string
  linkedOffers?: Array<{
    id: number
    offerName: string | null
    brand: string
    targetCountry: string
    isActive: boolean
    campaignCount: number
  }>
}

interface Credentials {
  clientId: string
  developerToken: string
  loginCustomerId?: string
  refreshToken?: string
  hasRefreshToken: boolean
  hasServiceAccount: boolean
  serviceAccountId?: string
  serviceAccountName?: string
}

export default function GoogleAdsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [accounts, setAccounts] = useState<GoogleAdsAccount[]>([])
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [loading, setLoading] = useState(true)
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsSyncing, setAccountsSyncing] = useState(false)
  const [accountsSyncError, setAccountsSyncError] = useState<string | null>(null)
  const accountsPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [needsReauth, setNeedsReauth] = useState(false)  // 是否需要重新授权
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [expandedOffers, setExpandedOffers] = useState<Set<string>>(new Set())
  const [isCached, setIsCached] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [currentServiceAccountId, setCurrentServiceAccountId] = useState<string | null>(null)
  const [currentAuthType, setCurrentAuthType] = useState<'oauth' | 'service_account'>('oauth')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  const formatErrorMessage = (value: unknown): string => {
    if (!value) return ''
    if (typeof value === 'string') return value
    if (value instanceof Error) return value.message
    const maybeMessage = (value as any)?.message
    if (typeof maybeMessage === 'string') return maybeMessage
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const formatNullableErrorMessage = (value: unknown): string | null => {
    const msg = formatErrorMessage(value).trim()
    return msg ? msg : null
  }

  const safeReadJson = async (response: Response): Promise<any | null> => {
    try {
      return await response.json()
    } catch {
      return null
    }
  }

  const buildApiErrorMessage = (response: Response, body: any | null): string => {
    const msgFromBody =
      formatNullableErrorMessage(body?.message) ||
      formatNullableErrorMessage(body?.error)

    if (msgFromBody) return msgFromBody

    // 兜底：尽量给出可操作提示
    if (response.status === 401) return '未登录或登录已过期，请刷新页面或重新登录'
    if (response.status === 403) return '权限不足'
    return `请求失败 (HTTP ${response.status})`
  }

  useEffect(() => {
    if (!searchParams) return

    const oauthSuccess = searchParams.get('oauth_success')
    if (oauthSuccess === 'true') {
      setSuccess('OAuth 授权成功！')
      setTimeout(() => setSuccess(''), 5000)
      router.replace('/google-ads')
    }

    const oauthError = searchParams.get('error')
    if (oauthError) {
      setError(`OAuth 授权失败: ${decodeURIComponent(oauthError)}`)
    }

    fetchCredentials()
  }, [searchParams, router])

  useEffect(() => {
    return () => {
      if (accountsPollTimerRef.current) {
        clearTimeout(accountsPollTimerRef.current)
        accountsPollTimerRef.current = null
      }
    }
  }, [])

  const fetchCredentials = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/google-ads/credentials', {
        credentials: 'include',
      })

      if (!response.ok) {
        const errorData = await safeReadJson(response)
        throw new Error(buildApiErrorMessage(response, errorData) || '获取凭证状态失败')
      }

      const data = await response.json()

      if (data.success && data.data) {
        setCredentials(data.data)

        if (data.data.hasRefreshToken) {
          fetchAccounts()
        } else {
          // 检查是否有服务账号配置
          fetchServiceAccounts()
        }
      }
    } catch (err: any) {
      console.error('获取凭证状态失败:', err)
      setError(formatErrorMessage(err) || '获取凭证状态失败')
    } finally {
      setLoading(false)
    }
  }

  const scheduleAccountsPoll = (mode: 'oauth' | 'service_account', serviceAccountId?: string | null) => {
    if (accountsPollTimerRef.current) clearTimeout(accountsPollTimerRef.current)
    accountsPollTimerRef.current = setTimeout(() => {
      if (mode === 'service_account') {
        if (serviceAccountId) fetchAccountsWithServiceAccount(serviceAccountId, false, true)
      } else {
        fetchAccounts(false, true)
      }
    }, 2000)
  }

  // 获取服务账号配置
  const fetchServiceAccounts = async () => {
    try {
      const response = await fetch('/api/google-ads/service-account', {
        credentials: 'include',
      })

      if (response.ok) {
        const data = await response.json()
        const accounts = data.accounts || []
        if (accounts.length > 0) {
          // 有服务账号配置，使用服务账号获取账户
          setCurrentAuthType('service_account')
          setCurrentServiceAccountId(accounts[0].id)
          fetchAccountsWithServiceAccount(accounts[0].id)
        }
      }
    } catch (err: any) {
      console.error('获取服务账号配置失败:', err)
    }
  }

  // 使用服务账号获取账户
  const fetchAccountsWithServiceAccount = async (serviceAccountId: string, forceRefresh = false, isPoll = false) => {
    try {
      if (!isPoll && !forceRefresh) setAccountsLoading(true)
      if (forceRefresh) setAccountsSyncing(true)
      if (forceRefresh) setAccountsSyncError(null)
      const url = forceRefresh
        ? `/api/google-ads/credentials/accounts?refresh=true&async=true&auth_type=service_account&service_account_id=${serviceAccountId}`
        : `/api/google-ads/credentials/accounts?auth_type=service_account&service_account_id=${serviceAccountId}`
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
      })

      if (!response.ok) {
        const errorData = await safeReadJson(response)

        // 检测OAuth授权过期错误
        if (errorData?.needsReauth || errorData?.code === 'OAUTH_TOKEN_EXPIRED') {
          setNeedsReauth(true)
          throw new Error('OAuth授权已过期')
        }

        throw new Error(buildApiErrorMessage(response, errorData) || '获取账户列表失败')
      }

      const data = await response.json()

      if (data.success && data.data) {
        setAccountsSyncError(formatNullableErrorMessage(data.data.refreshError))
        setAccountsSyncing(Boolean(data.data.refreshInProgress))
        // 处理账号数据，添加 parentMccName
        const allAccounts = data.data.accounts || []
        const mccMap = new Map<string, string>()

        // 先建立 MCC ID -> 名称的映射
        allAccounts.forEach((acc: GoogleAdsAccount) => {
          if (acc.manager) {
            mccMap.set(acc.customerId, acc.descriptiveName)
          }
        })

        // 为每个账号添加 parentMccName
        const enrichedAccounts = allAccounts.map((acc: GoogleAdsAccount) => ({
          ...acc,
          parentMccName: acc.parentMcc ? mccMap.get(acc.parentMcc) : undefined
        }))

        setAccounts(enrichedAccounts)
        setIsCached(data.data.cached || false)

        // 获取最新同步时间
        if (allAccounts.length > 0 && allAccounts[0].lastSyncAt) {
          setLastSyncAt(allAccounts[0].lastSyncAt)
        }

        if (forceRefresh || isPoll) {
          if (data.data.refreshInProgress) {
            scheduleAccountsPoll('service_account', serviceAccountId)
          } else {
            setAccountsSyncing(false)
          }
        }
      }
    } catch (err: any) {
      console.error('获取账户列表失败:', err)
      setError(formatErrorMessage(err) || '获取账户列表失败')
      setAccountsSyncing(false)
      setAccountsSyncError(null)
    } finally {
      if (!isPoll && !forceRefresh) setAccountsLoading(false)
    }
  }

  // OAuth模式获取账户列表
  const fetchAccounts = async (forceRefresh = false, isPoll = false) => {
    try {
      if (!isPoll && !forceRefresh) setAccountsLoading(true)
      if (forceRefresh) setAccountsSyncing(true)
      if (forceRefresh) setAccountsSyncError(null)
      const url = forceRefresh
        ? '/api/google-ads/credentials/accounts?refresh=true&async=true'
        : '/api/google-ads/credentials/accounts'
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
      })

      if (!response.ok) {
        const errorData = await safeReadJson(response)

        // 检测OAuth授权过期错误
        if (errorData?.needsReauth || errorData?.code === 'OAUTH_TOKEN_EXPIRED') {
          setNeedsReauth(true)
          throw new Error('OAuth授权已过期')
        }

        throw new Error(buildApiErrorMessage(response, errorData) || '获取账户列表失败')
      }

      const data = await response.json()

      if (data.success && data.data) {
        setAccountsSyncError(formatNullableErrorMessage(data.data.refreshError))
        setAccountsSyncing(Boolean(data.data.refreshInProgress))
        // 处理账号数据，添加 parentMccName
        const allAccounts = data.data.accounts || []
        const mccMap = new Map<string, string>()

        // 先建立 MCC ID -> 名称的映射
        allAccounts.forEach((acc: GoogleAdsAccount) => {
          if (acc.manager) {
            mccMap.set(acc.customerId, acc.descriptiveName)
          }
        })

        // 为每个账号添加 parentMccName
        const enrichedAccounts = allAccounts.map((acc: GoogleAdsAccount) => ({
          ...acc,
          parentMccName: acc.parentMcc ? mccMap.get(acc.parentMcc) : undefined
        }))

        setAccounts(enrichedAccounts)
        setIsCached(data.data.cached || false)

        // 获取最新同步时间
        if (allAccounts.length > 0 && allAccounts[0].lastSyncAt) {
          setLastSyncAt(allAccounts[0].lastSyncAt)
        }

        if (forceRefresh || isPoll) {
          if (data.data.refreshInProgress) {
            scheduleAccountsPoll('oauth')
          } else {
            setAccountsSyncing(false)
          }
        }
      }
    } catch (err: any) {
      console.error('获取账户列表失败:', err)
      setError(formatErrorMessage(err) || '获取账户列表失败')
      setAccountsSyncing(false)
      setAccountsSyncError(null)
    } finally {
      if (!isPoll && !forceRefresh) setAccountsLoading(false)
    }
  }

  // 刷新账户列表（服务账号模式下会重新获取最新的服务账号配置）
  const handleRefreshAccounts = async () => {
    setError('')
    setAccountsSyncError(null)

    // 🔧 优化：服务账号模式下每次刷新都重新获取最新的服务账号配置
    if (currentAuthType === 'service_account') {
      try {
        setAccountsSyncing(true)
        // 重新获取最新的服务账号
        const saResponse = await fetch('/api/google-ads/service-account', {
          credentials: 'include',
        })

        if (saResponse.ok) {
          const saData = await saResponse.json()
          const accounts = saData.accounts || []

          if (accounts.length > 0) {
            const latestServiceAccountId = accounts[0].id
            setCurrentServiceAccountId(latestServiceAccountId)
            await fetchAccountsWithServiceAccount(latestServiceAccountId, true)
          } else {
            // 没有服务账号配置，切换到OAuth模式或提示
            setError('未找到服务账号配置，请前往设置页面配置')
          }
        } else {
          throw new Error('获取服务账号配置失败')
        }
      } catch (err: any) {
        console.error('刷新账户列表失败:', err)
        setError(formatErrorMessage(err) || '刷新账户列表失败')
        setAccountsSyncing(false)
      }
    } else {
      // OAuth模式
      fetchAccounts(true)
    }
  }

  const toggleOffers = (customerId: string) => {
    const newExpanded = new Set(expandedOffers)
    if (newExpanded.has(customerId)) {
      newExpanded.delete(customerId)
    } else {
      newExpanded.add(customerId)
    }
    setExpandedOffers(newExpanded)
  }

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // 同一列，切换排序方向
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // 新列，默认升序
      setSortColumn(column)
      setSortDirection('asc')
    }
    setCurrentPage(1) // 重置到第一页
  }

  const getStatusConfig = (account: GoogleAdsAccount) => {
    const status = String(account.status || '').toUpperCase()

    // 广告主身份验证导致的暂停/限制（customer.status 可能仍为 ENABLED）
    if (account.identityVerification?.overdue) {
      return { key: 'VERIFICATION_OVERDUE', label: '验证暂停', color: 'bg-red-100 text-red-800' }
    }
    if (
      account.identityVerification?.programStatus &&
      account.identityVerification.programStatus !== 'SUCCESS' &&
      status === 'ENABLED'
    ) {
      return { key: 'VERIFICATION_REQUIRED', label: '需验证', color: 'bg-orange-100 text-orange-800' }
    }

    switch (status) {
      case 'ENABLED':
        return { key: 'ENABLED', label: '启用', color: 'bg-green-100 text-green-800' }
      case 'DISABLED':
        return { key: 'DISABLED', label: '已禁用', color: 'bg-red-100 text-red-800' }
      case 'REMOVED':
        return { key: 'REMOVED', label: '已删除', color: 'bg-gray-100 text-gray-800' }
      case 'UNKNOWN':
        return { key: 'UNKNOWN', label: '未知', color: 'bg-gray-100 text-gray-600' }
      case 'UNSPECIFIED':
        return { key: 'UNSPECIFIED', label: '未指定', color: 'bg-gray-50 text-gray-500' }
      // 兼容旧状态
      case 'SUSPENDED':
        return { key: 'SUSPENDED', label: '已暂停', color: 'bg-red-100 text-red-800' }
      case 'CANCELLED':
      case 'CANCELED':
        return { key: 'CANCELLED', label: '已取消', color: 'bg-orange-100 text-orange-800' }
      case 'CLOSED':
        return { key: 'CLOSED', label: '已关闭', color: 'bg-gray-100 text-gray-800' }
      default:
        return { key: status || 'UNKNOWN', label: status || '未知', color: 'bg-gray-100 text-gray-600' }
    }
  }

  const normalizedSearchKeyword = searchKeyword.trim().toLowerCase()
  const normalizedSearchDigits = searchKeyword.replace(/\D/g, '')
  const searchMatchedAccounts = accounts.filter((account) => {
    if (!normalizedSearchKeyword) return true

    const accountNameText = String(account.descriptiveName || '').toLowerCase()
    const customerIdText = String(account.customerId || '')
    const normalizedCustomerIdDigits = customerIdText.replace(/\D/g, '')
    const customerIdTextLower = customerIdText.toLowerCase()

    const matchedByName = accountNameText.includes(normalizedSearchKeyword)
    const matchedByCustomerIdText = customerIdTextLower.includes(normalizedSearchKeyword)
    const matchedByCustomerIdDigits = normalizedSearchDigits
      ? normalizedCustomerIdDigits.includes(normalizedSearchDigits)
      : false

    return matchedByName || matchedByCustomerIdText || matchedByCustomerIdDigits
  })

  const filteredAccounts = searchMatchedAccounts.filter((account) => {
    if (statusFilter === 'ALL') return true
    return getStatusConfig(account).key === statusFilter
  })

  const statusOptionsMap = searchMatchedAccounts.reduce<Map<string, string>>((map, account) => {
    const { key, label } = getStatusConfig(account)
    if (!map.has(key)) {
      map.set(key, label)
    }
    return map
  }, new Map())

  if (statusFilter !== 'ALL' && !statusOptionsMap.has(statusFilter)) {
    const selectedStatusAccount = accounts.find((account) => getStatusConfig(account).key === statusFilter)
    const selectedStatusLabel = selectedStatusAccount
      ? getStatusConfig(selectedStatusAccount).label
      : statusFilter
    statusOptionsMap.set(statusFilter, selectedStatusLabel)
  }

  const statusSortOrder: Record<string, number> = {
    VERIFICATION_OVERDUE: 0,
    VERIFICATION_REQUIRED: 1,
    ENABLED: 2,
    DISABLED: 3,
    SUSPENDED: 4,
    CANCELLED: 5,
    CLOSED: 6,
    REMOVED: 7,
    UNKNOWN: 8,
    UNSPECIFIED: 9,
  }

  const statusOptions = Array.from(statusOptionsMap.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => {
      const aOrder = statusSortOrder[a.value] ?? 99
      const bOrder = statusSortOrder[b.value] ?? 99
      if (aOrder !== bOrder) return aOrder - bOrder
      return a.label.localeCompare(b.label, 'zh-CN')
    })

  // 排序逻辑
  const sortedAccounts = [...filteredAccounts].sort((a, b) => {
    if (!sortColumn) return 0

    let aValue: any
    let bValue: any

    switch (sortColumn) {
      case 'name':
        aValue = a.descriptiveName.toLowerCase()
        bValue = b.descriptiveName.toLowerCase()
        break
      case 'customerId':
        aValue = a.customerId
        bValue = b.customerId
        break
      case 'mcc':
        aValue = a.parentMccName?.toLowerCase() || ''
        bValue = b.parentMccName?.toLowerCase() || ''
        break
      case 'type':
        aValue = a.manager ? 'mcc' : a.testAccount ? 'test' : 'normal'
        bValue = b.manager ? 'mcc' : b.testAccount ? 'test' : 'normal'
        break
      case 'balance':
        aValue = a.accountBalance ?? 0
        bValue = b.accountBalance ?? 0
        break
      case 'status':
        aValue = a.status.toLowerCase()
        bValue = b.status.toLowerCase()
        break
      case 'offers':
        aValue = a.linkedOffers?.length || 0
        bValue = b.linkedOffers?.length || 0
        break
      default:
        return 0
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
    return 0
  })

  // 分页计算
  const publishableAccountsCount = sortedAccounts.filter((account) => {
    if (account.manager) return false
    const status = String(account.status || '').toUpperCase()
    return status !== 'CANCELED' && status !== 'CANCELLED' && status !== 'CLOSED'
  }).length

  const totalPages = Math.ceil(sortedAccounts.length / pageSize)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedAccounts = sortedAccounts.slice(startIndex, endIndex)

  useEffect(() => {
    const safeTotalPages = Math.max(1, totalPages || 1)
    if (currentPage > safeTotalPages) {
      setCurrentPage(safeTotalPages)
    }
  }, [currentPage, totalPages])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchKeyword, statusFilter])

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }

  // 排序指示器
  const SortIndicator = ({ column }: { column: string }) => {
    if (sortColumn !== column) {
      return <span className="ml-1 text-gray-400">⇅</span>
    }
    return sortDirection === 'asc' ? (
      <span className="ml-1 text-indigo-600">↑</span>
    ) : (
      <span className="ml-1 text-indigo-600">↓</span>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  // 🔧 修复(2025-12-12): 独立账号模式 - 用户必须配置完整的 Google Ads API 凭证并完成 OAuth 授权
  // 🔧 修复(2025-12-24): 服务账号模式也支持
  const hasRefreshToken = credentials?.hasRefreshToken || false
  const hasServiceAccount = credentials?.hasServiceAccount || false
  const isConfigured = hasRefreshToken || hasServiceAccount

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">Google Ads 账号管理</h1>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefreshAccounts}
                disabled={accountsLoading || accountsSyncing || !isConfigured}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {accountsSyncing ? '同步中...' : accountsLoading ? '加载中...' : '刷新账户列表'}
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* OAuth 授权过期提示 - 优先显示 */}
          {needsReauth && (
            <div className="mb-4 bg-red-50 border-2 border-red-500 rounded-lg p-6">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="ml-3 flex-1">
                  <h3 className="text-lg font-bold text-red-800 mb-2">
                    ⚠️ Google OAuth 授权已过期
                  </h3>
                  <p className="text-sm text-red-700 mb-4">
                    您的 Google Ads API 授权已失效。这通常是因为 OAuth refresh token 已过期、被撤销或 Google 账号密码已修改。
                  </p>
                  <div className="bg-white border border-red-200 rounded p-4 mb-4">
                    <p className="text-sm font-semibold text-gray-800 mb-2">解决方法：</p>
                    <ol className="text-sm text-gray-700 list-decimal list-inside space-y-1.5">
                      <li>点击下方"重新授权"按钮</li>
                      <li>在设置页面向下滚动到"Google Ads OAuth 授权"部分</li>
                      <li>点击"开始 OAuth 授权"按钮</li>
                      <li>按照提示完成 Google 账号授权流程</li>
                      <li>授权成功后返回此页面刷新账户列表</li>
                    </ol>
                  </div>
                  <div className="flex gap-3">
                    <a
                      href="/settings"
                      className="inline-flex items-center px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                    >
                      <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                      立即重新授权
                    </a>
                    <button
                      onClick={() => {
                        setNeedsReauth(false)
                        setError('')
                      }}
                      className="inline-flex items-center px-4 py-2 bg-white border border-red-300 text-red-700 text-sm font-medium rounded-md hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                    >
                      暂时关闭此提示
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded whitespace-pre-line">
              {error}
            </div>
          )}

          {accountsSyncError && (
            <div className="mb-4 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded whitespace-pre-line">
              同步失败：{accountsSyncError}
            </div>
          )}

          {success && (
            <div className="mb-4 bg-green-50 border border-green-400 text-green-700 px-4 py-3 rounded">
              {success}
            </div>
          )}

          {!isConfigured && (
            <div className="mb-6 bg-amber-50 border border-amber-200 rounded-md p-4">
              <p className="text-sm text-amber-800 font-semibold mb-2">⚠️ 未完成 Google Ads API 配置</p>
              <p className="text-sm text-amber-700 mb-3">
                使用 Google Ads 功能前，需要完成以下配置之一：
              </p>
              <ol className="text-sm text-amber-700 list-decimal list-inside space-y-1 mb-3">
                <li><strong>OAuth 模式</strong>: 在系统设置中填写所有 Google Ads API 必填参数，并完成 OAuth 授权</li>
                <li><strong>服务账号模式</strong>: 在服务账号配置中添加有效的服务账号凭证</li>
              </ol>
              <div className="flex gap-3">
                <a
                  href="/settings"
                  className="inline-block px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded hover:bg-amber-700"
                >
                  前往 OAuth 配置 →
                </a>
                <a
                  href="/settings?tab=service-account"
                  className="inline-block px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700"
                >
                  前往服务账号配置 →
                </a>
              </div>
            </div>
          )}

          {(hasRefreshToken || hasServiceAccount) && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">可访问的账户</h2>
                  {lastSyncAt && (
                    <p className="text-sm text-gray-500 mt-1">
                      {isCached ? '缓存数据' : '已刷新'} · 同步时间: {new Date(lastSyncAt).toLocaleString('zh-CN')}
                    </p>
                  )}
                </div>
                {accounts.length > 0 && (
                  <span className="text-base text-gray-600 font-medium">
                    显示 {sortedAccounts.length} / {accounts.length} 个账户（可发布 {publishableAccountsCount} 个）
                  </span>
                )}
              </div>

              {accounts.length > 0 && (
                <div className="mb-4 bg-white shadow rounded-lg p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end">
                    <div className="w-full md:flex-1">
                      <label htmlFor="ads-account-search" className="block text-sm font-medium text-gray-700 mb-1">
                        搜索账号
                      </label>
                        <input
                          id="ads-account-search"
                          type="text"
                          value={searchKeyword}
                          onChange={(e) => setSearchKeyword(e.target.value)}
                          placeholder="按账户名称 / Customer ID 搜索"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <div className="w-full md:w-56">
                      <label htmlFor="ads-account-status-filter" className="block text-sm font-medium text-gray-700 mb-1">
                        状态筛选
                      </label>
                      <select
                        id="ads-account-status-filter"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="ALL">全部状态</option>
                        {statusOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {accountsLoading && accounts.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-lg shadow">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
                  <p className="mt-4 text-gray-600">加载账户列表...</p>
                </div>
              ) : accounts.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-lg shadow">
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                    />
                  </svg>
                  <h3 className="mt-2 text-sm font-medium text-gray-900">未找到可访问的账户</h3>
                  <p className="mt-1 text-sm text-gray-500">您的 Google 账号可能没有关联任何 Google Ads 账户</p>
                </div>
              ) : sortedAccounts.length === 0 ? (
                <div className="bg-white shadow rounded-lg p-8 text-center">
                  <h3 className="text-base font-medium text-gray-900">没有匹配的账户</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    请调整搜索关键词或状态筛选条件后重试
                  </p>
                  <button
                    onClick={() => {
                      setSearchKeyword('')
                      setStatusFilter('ALL')
                    }}
                    className="mt-4 px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    清空筛选
                  </button>
                </div>
              ) : (
                <>
                  {/* 账户列表 - 表格形式 */}
                  <div className="bg-white shadow rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th
                            className="px-6 py-3 text-left text-sm font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                            onClick={() => handleSort('name')}
                          >
                            <div className="flex items-center">
                              账户名称
                              <SortIndicator column="name" />
                            </div>
                          </th>
                          <th
                            className="px-6 py-3 text-left text-sm font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                            onClick={() => handleSort('customerId')}
                          >
                            <div className="flex items-center">
                              Customer ID
                              <SortIndicator column="customerId" />
                            </div>
                          </th>
                          <th
                            className="px-6 py-3 text-left text-sm font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                            onClick={() => handleSort('mcc')}
                          >
                            <div className="flex items-center">
                              所属 MCC
                              <SortIndicator column="mcc" />
                            </div>
                          </th>
                          <th
                            className="px-6 py-3 text-left text-sm font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                            onClick={() => handleSort('type')}
                          >
                            <div className="flex items-center">
                              类型
                              <SortIndicator column="type" />
                            </div>
                          </th>
                          <th
                            className="px-6 py-3 text-left text-sm font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                            onClick={() => handleSort('balance')}
                          >
                            <div className="flex items-center">
                              预算余额
                              <SortIndicator column="balance" />
                            </div>
                          </th>
                          <th
                            className="px-6 py-3 text-left text-sm font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                            onClick={() => handleSort('status')}
                          >
                            <div className="flex items-center">
                              状态
                              <SortIndicator column="status" />
                            </div>
                          </th>
                          <th
                            className="px-6 py-3 text-left text-sm font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                            onClick={() => handleSort('offers')}
                          >
                            <div className="flex items-center">
                              关联 Offer
                              <SortIndicator column="offers" />
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {paginatedAccounts.map((account) => (
                          <tr key={account.customerId} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center">
                                <div>
                                  <div className="text-base font-medium text-gray-900">
                                    {account.descriptiveName}
                                  </div>
                                  <div className="text-sm text-gray-500">
                                    {account.currencyCode} · {account.timeZone}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-sm font-mono text-gray-700">
                                {account.customerId}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {account.parentMcc ? (
                                <div>
                                  <div className="text-sm text-gray-900">
                                    {account.parentMccName || '未知 MCC'}
                                  </div>
                                  <div className="text-sm text-gray-500 font-mono">
                                    {account.parentMcc}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-sm text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex flex-wrap gap-1">
                                {account.manager && (
                                  <span className="px-2 py-1 text-sm font-semibold rounded-full bg-blue-100 text-blue-800">
                                    MCC
                                  </span>
                                )}
                                {account.testAccount && (
                                  <span className="px-2 py-1 text-sm font-semibold rounded-full bg-yellow-100 text-yellow-800">
                                    测试
                                  </span>
                                )}
                                {!account.manager && !account.testAccount && (
                                  <span className="text-sm text-gray-600">普通账户</span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {account.accountBalance !== null && account.accountBalance !== undefined ? (
                                <div className="text-sm">
                                  <div className="font-medium text-gray-900">
                                    {account.currencyCode} {(account.accountBalance / 1000000).toLocaleString('zh-CN', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2
                                    })}
                                  </div>
                                  <div className="text-xs text-gray-500">预算余额</div>
                                </div>
                              ) : (
                                <span className="text-sm text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {(() => {
                                const config = getStatusConfig(account)
                                return (
                                  <span className={`px-2 py-1 text-sm font-semibold rounded-full ${config.color}`}>
                                    {config.label}
                                  </span>
                                )
                              })()}
                            </td>
                            <td className="px-6 py-4">
                              {account.linkedOffers && account.linkedOffers.length > 0 ? (
                                <div>
                                  <button
                                    onClick={() => toggleOffers(account.customerId)}
                                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                                  >
                                    {account.linkedOffers.length} 个 Offer
                                    <span className="ml-1">
                                      {expandedOffers.has(account.customerId) ? '▼' : '▶'}
                                    </span>
                                  </button>
                                  {expandedOffers.has(account.customerId) && (
                                    <div className="mt-2 space-y-1">
                                      {account.linkedOffers.map((offer) => (
                                        <div
                                          key={offer.id}
                                          className="text-sm bg-gray-50 px-2 py-1.5 rounded"
                                        >
                                          <a
                                            href={`/offers/${offer.id}`}
                                            className="text-indigo-600 hover:underline font-medium"
                                          >
                                            {offer.offerName || offer.brand}
                                          </a>
                                          <span className="text-gray-600 ml-1">
                                            · {offer.targetCountry} · {offer.campaignCount} 系列
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-sm text-gray-400">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 分页控件 - Updated with page size selector */}
                  {totalPages > 1 && (
                    <div className="mt-4 flex items-center justify-between bg-white px-4 py-3 rounded-lg shadow">
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-2">
                          <span>每页显示</span>
                          <select
                            value={pageSize}
                            onChange={(e) => {
                              const newSize = Number(e.target.value)
                              setPageSize(newSize)
                              setCurrentPage(1) // 重置到第一页
                            }}
                            className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                          </select>
                          <span>条</span>
                        </div>
                        <div>
                          显示第 {startIndex + 1} - {Math.min(endIndex, sortedAccounts.length)} 条，共 {sortedAccounts.length} 条
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => goToPage(1)}
                          disabled={currentPage === 1}
                          className="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          首页
                        </button>
                        <button
                          onClick={() => goToPage(currentPage - 1)}
                          disabled={currentPage === 1}
                          className="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          上一页
                        </button>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            let pageNum: number
                            if (totalPages <= 5) {
                              pageNum = i + 1
                            } else if (currentPage <= 3) {
                              pageNum = i + 1
                            } else if (currentPage >= totalPages - 2) {
                              pageNum = totalPages - 4 + i
                            } else {
                              pageNum = currentPage - 2 + i
                            }
                            return (
                              <button
                                key={pageNum}
                                onClick={() => goToPage(pageNum)}
                                className={`px-3 py-1 text-sm border rounded ${
                                  currentPage === pageNum
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'hover:bg-gray-50'
                                }`}
                              >
                                {pageNum}
                              </button>
                            )
                          })}
                        </div>
                        <button
                          onClick={() => goToPage(currentPage + 1)}
                          disabled={currentPage === totalPages}
                          className="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          下一页
                        </button>
                        <button
                          onClick={() => goToPage(totalPages)}
                          disabled={currentPage === totalPages}
                          className="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          末页
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div className="mt-6 bg-gray-50 border border-gray-300 text-gray-700 px-4 py-3 rounded">
            <p className="font-semibold">使用说明：</p>
            <ul className="mt-2 text-sm space-y-1">
              <li>
                • <strong>配置要求</strong>: 在 <a href="/settings" className="underline text-indigo-600 hover:text-indigo-800">系统设置</a> 中完成 Google Ads API 所有必填参数配置，并完成 OAuth 授权
              </li>
              <li>
                • <strong>MCC 账户</strong>: 配置您的 MCC（Manager Account）ID，系统将自动获取您管理的所有子账户
              </li>
              <li>
                • <strong>所属 MCC</strong>: 显示该账户归属的 MCC 管理账户名称和 ID
              </li>
              <li>
                • <strong>关联 Offer</strong>: 点击可展开查看该账户关联的所有 Offer 及广告系列数量
              </li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  )
}
