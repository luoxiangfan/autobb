'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2, CheckCircle2, XCircle, Users, Building2, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface User {
  id: number
  username: string
  email: string
  role: string
}

interface MCCAccount {
  id: number
  customerId: string
  accountName: string | null
  isManagerAccount: boolean
}

interface MCCAssignmentWithUser extends MCCAssignment {
  assigned_to_user_id?: number
  assigned_to_username?: string
}

interface MCCAssignment {
  id: number
  mcc_customer_id: string
  assigned_at: string
  assigned_by: number | null
  assigned_by_username: string | null
  mcc_account_name: string | null
}

// 🔧 用于取消未完成的请求
let fetchAssignmentsAbortController: AbortController | null = null

export default function MCCAssignmentClientPage() {
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<User[]>([])
  const [mccAccounts, setMccAccounts] = useState<MCCAccount[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [selectedMccIds, setSelectedMccIds] = useState<string[]>([])
  const [userAssignments, setUserAssignments] = useState<MCCAssignment[]>([])
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [isMccSelectOpen, setIsMccSelectOpen] = useState(false)
  const [removingMccId, setRemovingMccId] = useState<string | null>(null)  // 🔧 删除中的 MCC ID
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)  // 🔧 删除确认对话框
  const [mccToDelete, setMccToDelete] = useState<string | null>(null)  // 🔧 待删除的 MCC ID
  const [allAssignments, setAllAssignments] = useState<Map<string, { userId: number, username: string }>>(new Map())  // 🔧 所有 MCC 的分配情况
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)  // 🔧 转移对话框
  const [mccToTransfer, setMccToTransfer] = useState<{ mccId: string, fromUserId: number, fromUsername: string } | null>(null)
  const [transferTargetUserId, setTransferTargetUserId] = useState<string>('')
  const [transferring, setTransferring] = useState(false)
  const [selectedAssignments, setSelectedAssignments] = useState<string[]>([])  // 🔧 批量操作选中的 MCC
  const [bulkActionDialogOpen, setBulkActionDialogOpen] = useState(false)  // 🔧 批量操作对话框
  const [bulkActionType, setBulkActionType] = useState<'remove' | 'transfer'>('remove')
  const [tableSearchTerm, setTableSearchTerm] = useState('')  // 🔧 表格搜索
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')  // 🔧 防抖后的搜索词
  const [sortBy, setSortBy] = useState<'assigned_at' | 'mcc_customer_id' | 'account_name'>('assigned_at')  // 🔧 排序
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')  // 🔧 排序方向
  const [isRefreshing, setIsRefreshing] = useState(false)  // 🔧 刷新状态
  const [cache, setCache] = useState<{  // 🔧 数据缓存
    mccAccounts: MCCAccount[]
    allAssignments: Map<string, { userId: number, username: string }>
    timestamp: number
  } | null>(null)
  const CACHE_DURATION = 5 * 60 * 1000 // 5 分钟缓存

  useEffect(() => {
    fetchUsers()
    fetchMccAccounts()
    fetchAllAssignments()  // 🔧 获取所有 MCC 的分配情况
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 🔧 搜索防抖 - 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(tableSearchTerm)
    }, 300)

    return () => clearTimeout(timer)
  }, [tableSearchTerm])

  // 🔧 缓存清理 - 组件卸载时清理过期缓存
  useEffect(() => {
    const cleanup = setInterval(() => {
      if (cache && Date.now() - cache.timestamp > CACHE_DURATION) {
        setCache(null)
      }
    }, 60000) // 每分钟检查一次

    return () => clearInterval(cleanup)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache])

  useEffect(() => {
    if (selectedUserId) {
      // 🔧 切换用户时先清除旧数据
      setUserAssignments([])
      fetchUserAssignments(selectedUserId)
    }
  }, [selectedUserId])

  const fetchUsers = async () => {
    try {
      const params = new URLSearchParams({
        role: 'user',
        status: 'active',
        limit: '10'
      })
      const response = await fetch(`/api/admin/users?${params}`, {
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json()
        setUsers(data.users || [])
      }
    } catch (error: any) {
      console.error('获取用户列表失败:', error)
    }
  }

  const fetchMccAccounts = async () => {
    try {
      // 🔧 检查缓存
      if (cache && Date.now() - cache.timestamp < CACHE_DURATION) {
        setMccAccounts(cache.mccAccounts)
        setAllAssignments(cache.allAssignments)
        return
      }

      const response = await fetch('/api/google-ads-accounts?manager=true&activeOnly=true', {
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json()
        const accounts = data?.accounts || []
        setMccAccounts(accounts)
        
        // 🔧 更新缓存
        setCache({
          mccAccounts: accounts,
          allAssignments: new Map(), // 会被 fetchAllAssignments 更新
          timestamp: Date.now(),
        })
      }
    } catch (error: any) {
      console.error('获取 MCC 账号失败:', error)
      toast.error('加载 MCC 账号失败', {
        description: '请刷新页面重试',
        duration: 5000,
      })
    } finally {
      setLoading(false)
    }
  }

  // 🔧 获取所有 MCC 的分配情况（用于显示哪些 MCC 已被其他用户绑定）
  const fetchAllAssignments = async () => {
    try {
      const response = await fetch('/api/admin/user-mcc/all', {
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json()
        const assignmentMap = new Map<string, { userId: number, username: string }>()
        data.assignments?.forEach((a: any) => {
          assignmentMap.set(a.mcc_customer_id, {
            userId: a.user_id,
            username: a.username || `用户${a.user_id}`,
          })
        })
        setAllAssignments(assignmentMap)
        
        // 🔧 更新缓存中的分配数据
        if (cache) {
          setCache({
            ...cache,
            allAssignments: assignmentMap,
          })
        }
      }
    } catch (error: any) {
      console.error('获取所有 MCC 分配失败:', error)
    }
  }

  const fetchUserAssignments = async (userId: string) => {
    // 🔧 取消未完成的请求
    if (fetchAssignmentsAbortController) {
      fetchAssignmentsAbortController.abort()
    }
    fetchAssignmentsAbortController = new AbortController()

    try {
      const response = await fetch(`/api/admin/user-mcc?userId=${userId}`, {
        credentials: 'include',
        signal: fetchAssignmentsAbortController.signal,
      })
      if (response.ok) {
        const data = await response.json()
        // 🔧 直接替换数据，不追加
        setUserAssignments(data.assignments || [])
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // 🔧 请求被取消，不处理
        return
      }
      console.error('获取用户 MCC 分配失败:', error)
      toast.error('加载分配列表失败', {
        description: '请刷新页面重试',
        duration: 5000,
      })
    }
  }

  // 🔧 刷新功能
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return
    
    setIsRefreshing(true)
    try {
      // 🔧 清除缓存，强制重新加载
      setCache(null)
      await Promise.all([
        fetchUsers(),
        fetchMccAccounts(),
        fetchAllAssignments(),
      ])
      
      if (selectedUserId) {
        await fetchUserAssignments(selectedUserId)
      }
      
      toast.success('刷新成功', {
        description: '数据已更新到最新',
        duration: 2000,
      })
    } catch (error: any) {
      console.error('刷新失败:', error)
      toast.error('刷新失败', {
        description: error.message || '请稍后重试',
        duration: 5000,
      })
    } finally {
      setIsRefreshing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRefreshing, selectedUserId])

  const handleAssign = async () => {
    if (!selectedUserId || selectedMccIds.length === 0) {
      toast.error('请选择用户和 MCC 账号')
      return
    }

    setAssigning(true)
    try {
      const response = await fetch('/api/admin/user-mcc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: parseInt(selectedUserId),
          mccCustomerIds: selectedMccIds,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        // 🔧 特殊处理 MCC 冲突错误
        if (response.status === 409 && error.conflicts) {
          const conflictList = error.conflicts
            .map((c: any) => `• ${c.mccCustomerId} - 已绑定给：${c.assignedToUsername}`)
            .join('\n')
          toast.error('分配失败', {
            description: (
              <div className="space-y-2">
                <p className="font-medium">{error.error}</p>
                <div className="bg-red-50 p-3 rounded-md text-sm">
                  <pre className="whitespace-pre-wrap text-red-800">{conflictList}</pre>
                </div>
              </div>
            ),
            duration: 8000,
          })
          return
        }
        toast.error('分配失败', {
          description: error.message || error.error,
        })
        return
      }

      const result = await response.json()
      toast.success('分配成功', {
        description: (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span>成功分配 <span className="font-medium">{result.assignedCount}</span> 个 MCC 账号</span>
            </div>
            <div className="text-xs text-gray-600 pl-6">
              数据已自动刷新
            </div>
          </div>
        ),
        duration: 4000,
      })
      
      // 🔧 自动刷新分配列表
      fetchUserAssignments(selectedUserId)
      fetchAllAssignments()
      setIsAssignDialogOpen(false)
      setSelectedMccIds([])
    } catch (error: any) {
      console.error('分配 MCC 失败:', error)
      
      // 🔧 详细的错误说明
      let errorTitle = '分配失败'
      let errorDescription = error.message || '未知错误'
      let errorDuration = 6000
      
      if (error.message?.includes('MCC 账号已被其他用户绑定')) {
        errorTitle = 'MCC 账号冲突'
        errorDescription = (
          <div className="space-y-2">
            <p className="text-sm">以下 MCC 账号已被其他用户绑定：</p>
            <ul className="text-sm bg-red-50 p-2 rounded-md text-red-800">
              {error.conflicts?.map((c: any, i: number) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="font-mono">{c.mccCustomerId}</span>
                  <span>→ 已绑定给：</span>
                  <span className="font-medium">{c.assignedToUsername}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-600">
              💡 提示：一个 MCC 账号只能与一个用户绑定。如需重新分配，请先移除原用户的绑定。
            </p>
          </div>
        )
        errorDuration = 10000 // 更长的显示时间
      } else if (error.message?.includes('MCC 账号不存在')) {
        errorTitle = 'MCC 账号无效'
        errorDescription = (
          <div className="space-y-1">
            <p className="text-sm">请检查 MCC 账号是否正确</p>
            <p className="text-xs text-gray-600">
              💡 提示：MCC 账号必须是有效的经理账号（is_manager_account = TRUE）
            </p>
          </div>
        )
      } else if (error.message?.includes('目标用户不存在')) {
        errorTitle = '用户不存在'
        errorDescription = '请刷新页面后重试'
      }
      
      toast.error(errorTitle, {
        description: errorDescription,
        duration: errorDuration,
      })
    } finally {
      setAssigning(false)
    }
  }

  const handleRemove = async (mccCustomerId: string) => {
    if (!selectedUserId || !mccCustomerId) return

    setRemovingMccId(mccCustomerId)
    try {
      const response = await fetch('/api/admin/user-mcc', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: parseInt(selectedUserId),
          mccCustomerIds: [mccCustomerId],
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        toast.error('移除失败', {
          description: error.message || error.error,
        })
        return
      }

      const result = await response.json()
      toast.success('移除成功', {
        description: (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span>成功移除 <span className="font-medium">{result.removedCount}</span> 个 MCC 分配</span>
            </div>
            <div className="text-xs text-gray-600 pl-6">
              数据已自动刷新
            </div>
          </div>
        ),
        duration: 4000,
      })
      
      // 🔧 自动刷新分配列表
      fetchUserAssignments(selectedUserId)
      fetchAllAssignments()
      
      // 刷新分配列表
      fetchUserAssignments(selectedUserId)
      setDeleteConfirmOpen(false)
      setMccToDelete(null)
    } catch (error: any) {
      console.error('移除 MCC 失败:', error)
      toast.error('移除失败', { description: error.message })
    } finally {
      setRemovingMccId(null)
    }
  }

  // 🔧 打开删除确认对话框
  const confirmDelete = (mccCustomerId: string) => {
    setMccToDelete(mccCustomerId)
    setDeleteConfirmOpen(true)
  }

  // 🔧 确认删除
  const handleConfirmDelete = () => {
    if (mccToDelete) {
      handleRemove(mccToDelete)
    }
  }

  // 🔧 打开转移对话框
  const handleTransfer = (assignment: MCCAssignment) => {
    const assignmentWithUser = assignment as MCCAssignmentWithUser
    setMccToTransfer({
      mccId: assignment.mcc_customer_id,
      fromUserId: assignmentWithUser.assigned_to_user_id || 0,
      fromUsername: users.find(u => u.id === assignmentWithUser.assigned_to_user_id)?.username || '未知用户',
    })
    setTransferTargetUserId('')
    setTransferDialogOpen(true)
  }

  // 🔧 批量操作处理
  const handleBulkAction = async () => {
    if (selectedAssignments.length === 0) {
      toast.error('请选择要操作的 MCC')
      return
    }

    setTransferring(true)
    try {
      if (bulkActionType === 'remove') {
        // 批量删除
        const response = await fetch('/api/admin/user-mcc', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            userId: parseInt(selectedUserId),
            mccCustomerIds: selectedAssignments,
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || '批量删除失败')
        }

        toast.success('批量移除成功', {
          description: (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <span>成功移除 <span className="font-medium">{selectedAssignments.length}</span> 个 MCC 分配</span>
              </div>
              <div className="text-xs text-gray-600 pl-6">
                数据已自动刷新
              </div>
            </div>
          ),
          duration: 4000,
        })
      }

      setSelectedAssignments([])
      setBulkActionDialogOpen(false)
      
      // 🔧 自动刷新分配列表
      fetchUserAssignments(selectedUserId)
      fetchAllAssignments()
    } catch (error: any) {
      console.error('批量操作失败:', error)
      toast.error('批量操作失败', {
        description: (
          <div className="space-y-1">
            <p>{error.message || '未知错误'}</p>
            <p className="text-xs text-gray-600">
              💡 提示：如果问题持续，请尝试逐个移除或刷新页面
            </p>
          </div>
        ),
        duration: 7000,
      })
    } finally {
      setTransferring(false)
    }
  }

  // 🔧 确认转移
  const handleConfirmTransfer = async () => {
    if (!mccToTransfer || !transferTargetUserId) {
      toast.error('请选择目标用户')
      return
    }

    setTransferring(true)
    try {
      // 先移除原用户的分配
      await fetch('/api/admin/user-mcc', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: mccToTransfer.fromUserId,
          mccCustomerIds: [mccToTransfer.mccId],
        }),
      })

      // 再分配给新用户
      const response = await fetch('/api/admin/user-mcc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: parseInt(transferTargetUserId),
          mccCustomerIds: [mccToTransfer.mccId],
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '转移失败')
      }

      const targetUsername = users.find(u => u.id.toString() === transferTargetUserId)?.username
      toast.success('转移成功', {
        description: (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span>MCC <span className="font-mono font-medium">{mccToTransfer.mccId}</span> 已转移给 <span className="font-medium">{targetUsername}</span></span>
            </div>
            <div className="text-xs text-gray-600 pl-6">
              原用户已失去访问权限，目标用户已获得访问权限
            </div>
          </div>
        ),
        duration: 5000,
      })
      
      setTransferDialogOpen(false)
      setMccToTransfer(null)
      setTransferTargetUserId('')
      
      // 🔧 自动刷新分配列表
      if (selectedUserId) {
        fetchUserAssignments(selectedUserId)
      }
      fetchAllAssignments()
    } catch (error: any) {
      console.error('转移 MCC 失败:', error)
      
      // 🔧 详细的错误说明
      let errorDescription = error.message || '未知错误'
      if (error.message?.includes('目标用户不存在')) {
        errorDescription = '请刷新页面后重试'
      }
      
      toast.error('转移失败', {
        description: errorDescription,
        duration: 6000,
      })
    } finally {
      setTransferring(false)
    }
  }

  // 🔧 使用 useMemo 优化过滤和排序
  const filteredMccAccounts = useMemo(() => {
    return mccAccounts.filter(mcc =>
      mcc.accountName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mcc.customerId.includes(searchTerm)
    )
  }, [mccAccounts, searchTerm])

  const assignedMccIds = userAssignments.map(a => a.mcc_customer_id)
  
  // 🔧 可用 MCC = 未分配给任何用户的 MCC
  const availableMccAccounts = useMemo(() => {
    return filteredMccAccounts.filter(
      mcc => !allAssignments.has(mcc.customerId)
    )
  }, [filteredMccAccounts, allAssignments])

  // 🔧 表格数据筛选和排序（使用防抖后的搜索词 + useMemo）
  const sortedAndFilteredAssignments = useMemo(() => {
    return [...userAssignments]
      .filter(assignment => {
        if (!debouncedSearchTerm) return true
        const term = debouncedSearchTerm.toLowerCase()
        return (
          assignment.mcc_customer_id.toLowerCase().includes(term) ||
          assignment.mcc_account_name?.toLowerCase().includes(term) ||
          assignment.assigned_by_username?.toLowerCase().includes(term)
        )
      })
      .sort((a, b) => {
        let comparison = 0
        switch (sortBy) {
          case 'mcc_customer_id':
            comparison = a.mcc_customer_id.localeCompare(b.mcc_customer_id)
            break
          case 'account_name':
            comparison = (a.mcc_account_name || '').localeCompare(b.mcc_account_name || '')
            break
          case 'assigned_at':
          default:
            comparison = new Date(a.assigned_at).getTime() - new Date(b.assigned_at).getTime()
            break
        }
        return sortOrder === 'asc' ? comparison : -comparison
      })
  }, [userAssignments, debouncedSearchTerm, sortBy, sortOrder])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">MCC 账号分配</h1>
              <p className="text-sm text-gray-500 mt-1">
                为用户分配 MCC 账号，控制用户可同步的广告系列范围
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing || loading}
                title="刷新数据"
                className="h-9 px-3"
              >
                {isRefreshing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                <span className="hidden sm:inline">刷新</span>
              </Button>
              <Button
                onClick={() => setIsAssignDialogOpen(true)}
                disabled={!selectedUserId}
                className="h-9"
              >
                <Plus className="w-4 h-4 mr-2" />
                分配 MCC 账号
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* 总 MCC 数 */}
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-600 font-medium">总 MCC 账号数</p>
                  <p className="text-3xl font-bold text-blue-900 mt-1">{mccAccounts.length}</p>
                </div>
                <Building2 className="w-12 h-12 text-blue-400 opacity-50" />
              </div>
            </CardContent>
          </Card>

          {/* 已分配 MCC 数 */}
          <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-green-600 font-medium">已分配 MCC</p>
                  <p className="text-3xl font-bold text-green-900 mt-1">{allAssignments.size}</p>
                </div>
                <CheckCircle2 className="w-12 h-12 text-green-400 opacity-50" />
              </div>
            </CardContent>
          </Card>

          {/* 可用 MCC 数 */}
          <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-amber-600 font-medium">可用 MCC</p>
                  <p className="text-3xl font-bold text-amber-900 mt-1">{mccAccounts.length - allAssignments.size}</p>
                </div>
                <Plus className="w-12 h-12 text-amber-400 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 内容区域 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：用户选择 */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                选择用户
              </CardTitle>
              <CardDescription>
                选择要分配 MCC 账号的用户
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  <div className="h-10 bg-gray-200 rounded animate-pulse" />
                  <div className="h-20 bg-gray-100 rounded animate-pulse" />
                </div>
              ) : (
                <div className="space-y-2">
                  <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择用户" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map(user => (
                        <SelectItem key={user.id} value={user.id.toString()}>
                          {user.username || user.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedUserId && (
                    <Alert className="mt-4">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <AlertDescription className="text-sm">
                        已选择用户：{users.find(u => u.id.toString() === selectedUserId)?.username}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 右侧：MCC 分配列表 */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="w-5 h-5" />
                    MCC 账号分配
                  </CardTitle>
                  <CardDescription>
                    {selectedUserId
                      ? `用户 ${users.find(u => u.id.toString() === selectedUserId)?.username} 已分配的 MCC 账号`
                      : '请先选择用户'}
                  </CardDescription>
                </div>
                {selectedUserId && userAssignments.length > 0 && (
                  <div className="flex items-center gap-2">
                    {/* 搜索框 */}
                    <div className="relative">
                      <Input
                        placeholder="搜索 MCC..."
                        value={tableSearchTerm}
                        onChange={(e) => setTableSearchTerm(e.target.value)}
                        className="w-[200px] h-9 pl-3 pr-8"
                      />
                      <svg
                        className="absolute right-2.5 top-2.5 h-4 w-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    
                    {/* 排序按钮 */}
                    <Select value={sortBy} onValueChange={(val: any) => setSortBy(val)}>
                      <SelectTrigger className="w-[130px] h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="assigned_at">分配时间</SelectItem>
                        <SelectItem value="mcc_customer_id">MCC ID</SelectItem>
                        <SelectItem value="account_name">账号名称</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                      className="h-9 w-9 p-0"
                      title={sortOrder === 'asc' ? '升序' : '降序'}
                    >
                      {sortOrder === 'asc' ? (
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
                  ))}
                </div>
              ) : !selectedUserId ? (
                <div className="text-center py-8 text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>请选择用户查看 MCC 分配</p>
                </div>
              ) : userAssignments.length === 0 ? (
                <div className="text-center py-12">
                  <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                    <Building2 className="w-10 h-10 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    暂无 MCC 分配
                  </h3>
                  <p className="text-gray-500 mb-6 max-w-sm mx-auto">
                    该用户还没有分配任何 MCC 账号，点击上方按钮开始分配
                  </p>
                  <Button
                    onClick={() => setIsAssignDialogOpen(true)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    分配 MCC 账号
                  </Button>
                </div>
              ) : sortedAndFilteredAssignments.length === 0 && userAssignments.length > 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>没有匹配的搜索结果</p>
                  <Button
                    variant="link"
                    onClick={() => setTableSearchTerm('')}
                    className="mt-2"
                  >
                    清除搜索
                  </Button>
                </div>
              ) : (
                <>
                <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={selectedAssignments.length === sortedAndFilteredAssignments.length && sortedAndFilteredAssignments.length > 0}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedAssignments(sortedAndFilteredAssignments.map(a => a.mcc_customer_id))
                            } else {
                              setSelectedAssignments([])
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead>MCC 账号</TableHead>
                      <TableHead>账号名称</TableHead>
                      <TableHead>分配时间</TableHead>
                      <TableHead>分配人</TableHead>
                      <TableHead className="w-[140px]">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedAndFilteredAssignments.map(assignment => (
                      <TableRow 
                        key={assignment.id}
                        className={cn(
                          selectedAssignments.includes(assignment.mcc_customer_id) && "bg-blue-50"
                        )}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedAssignments.includes(assignment.mcc_customer_id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedAssignments([...selectedAssignments, assignment.mcc_customer_id])
                              } else {
                                setSelectedAssignments(selectedAssignments.filter(id => id !== assignment.mcc_customer_id))
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {assignment.mcc_customer_id}
                        </TableCell>
                        <TableCell>
                          {assignment.mcc_account_name || '-'}
                        </TableCell>
                        <TableCell>
                          {new Date(assignment.assigned_at).toLocaleString('zh-CN')}
                        </TableCell>
                        <TableCell>
                          {assignment.assigned_by_username || '系统'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleTransfer(assignment)}
                              disabled={!selectedUserId || removingMccId === assignment.mcc_customer_id}
                              className="h-8 px-2 text-xs"
                              title="转移给其他用户"
                            >
                              <Users className="w-3.5 h-3.5 text-blue-600" />
                              <span className="ml-1">转移</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => confirmDelete(assignment.mcc_customer_id)}
                              disabled={!selectedUserId || removingMccId === assignment.mcc_customer_id}
                              className="h-8 w-8 p-0"
                              title="删除分配"
                            >
                              {removingMccId === assignment.mcc_customer_id ? (
                                <Loader2 className="w-4 h-4 animate-spin text-red-600" />
                              ) : (
                                <Trash2 className="w-4 h-4 text-red-600" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>

                {/* 批量操作工具栏 */}
                {selectedAssignments.length > 0 && (
                  <div className="flex items-center justify-between mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-medium text-blue-900">
                        已选择 {selectedAssignments.length} 个 MCC
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setBulkActionType('remove')
                          setBulkActionDialogOpen(true)
                        }}
                        className="text-xs h-8"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1 text-red-600" />
                        批量移除
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setBulkActionType('transfer')
                          setBulkActionDialogOpen(true)
                        }}
                        className="text-xs h-8"
                        disabled={selectedAssignments.length > 1}
                      >
                        <Users className="w-3.5 h-3.5 mr-1 text-blue-600" />
                        批量转移
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedAssignments([])}
                        className="text-xs h-8"
                      >
                        取消选择
                      </Button>
                    </div>
                  </div>
                )}
              </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 分配对话框 */}
      <Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              分配 MCC 账号
            </DialogTitle>
            <DialogDescription className="space-y-1">
              <p>
                为用户 <span className="font-medium text-blue-600">{users.find(u => u.id.toString() === selectedUserId)?.username}</span> 分配 MCC 账号
              </p>
              <div className="flex items-center gap-2 text-xs bg-green-50 text-green-700 px-3 py-2 rounded-md">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>仅显示未分配的 MCC 账号，一个 MCC 账号只能与一个用户绑定</span>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>MCC 账号（多选）</Label>
              
              {/* 自定义多选 Select - 优化样式 */}
              <div className="relative">
                <button
                  type="button"
                  className={cn(
                    "w-full min-h-[44px] px-4 py-2.5 border rounded-lg bg-background text-left text-sm",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                    "transition-all duration-200",
                    isMccSelectOpen ? "border-blue-500 ring-2 ring-blue-500 ring-offset-2" : "border-input hover:border-gray-400"
                  )}
                  onClick={() => setIsMccSelectOpen(!isMccSelectOpen)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      {selectedMccIds.length === 0 ? (
                        <span className="text-muted-foreground">选择 MCC 账号</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedMccIds.slice(0, 3).map(id => {
                            const mcc = mccAccounts.find(m => m.customerId === id)
                            return (
                              <Badge 
                                key={id} 
                                variant="secondary" 
                                className="text-xs bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors"
                              >
                                {mcc?.accountName || id}
                              </Badge>
                            )
                          })}
                          {selectedMccIds.length > 3 && (
                            <Badge 
                              variant="outline" 
                              className="text-xs bg-gray-100"
                            >
                              +{selectedMccIds.length - 3}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                    <ChevronDown className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      isMccSelectOpen && "rotate-180"
                    )} />
                  </div>
                </button>

                {/* 下拉选项 - 优化样式 */}
                {isMccSelectOpen && (
                  <>
                    <div className="absolute z-50 w-full mt-1 border border-gray-200 rounded-lg bg-white shadow-lg max-h-[320px] overflow-hidden">
                      {/* 搜索框 - 优化样式 */}
                      <div className="sticky top-0 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200 p-3">
                        <div className="relative">
                          <Input
                            placeholder="🔍 搜索 MCC 账号或 ID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-9 pl-3 pr-3 bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      {/* 选项列表 - 优化样式 */}
                      <div className="overflow-y-auto max-h-[240px]">
                        {availableMccAccounts.length === 0 ? (
                          <div className="px-6 py-8 text-center">
                            <Building2 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                            <p className="text-sm text-gray-500 font-medium">
                              {searchTerm 
                                ? '没有匹配的未分配 MCC 账号' 
                                : '所有 MCC 账号都已分配给其他用户'}
                            </p>
                            {!searchTerm && (
                              <p className="text-xs text-gray-400 mt-1">
                                请先移除其他用户的分配或添加新的 MCC 账号
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="divide-y divide-gray-100">
                            {availableMccAccounts.map((mcc, index) => (
                              <div
                                key={mcc.id}
                                className={cn(
                                  "flex items-center gap-3 px-4 py-3 cursor-pointer transition-all duration-150",
                                  selectedMccIds.includes(mcc.customerId)
                                    ? "bg-blue-50 hover:bg-blue-100"
                                    : "hover:bg-gray-50"
                                )}
                                onClick={() => {
                                  if (selectedMccIds.includes(mcc.customerId)) {
                                    setSelectedMccIds(selectedMccIds.filter(id => id !== mcc.customerId))
                                  } else {
                                    setSelectedMccIds([...selectedMccIds, mcc.customerId])
                                  }
                                }}
                              >
                                <Checkbox
                                  checked={selectedMccIds.includes(mcc.customerId)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setSelectedMccIds([...selectedMccIds, mcc.customerId])
                                    } else {
                                      setSelectedMccIds(selectedMccIds.filter(id => id !== mcc.customerId))
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-sm font-medium text-gray-900">
                                      {mcc.customerId}
                                    </span>
                                    {selectedMccIds.includes(mcc.customerId) && (
                                      <Badge variant="default" className="text-xs bg-blue-600">
                                        已选择
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-500 truncate mt-0.5">
                                    {mcc.accountName || '未命名'}
                                  </div>
                                </div>
                                {selectedMccIds.includes(mcc.customerId) && (
                                  <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 底部统计 - 优化样式 */}
                      {availableMccAccounts.length > 0 && (
                        <div className="sticky bottom-0 bg-gradient-to-r from-gray-50 to-gray-100 border-t border-gray-200 px-4 py-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-600">
                              已选择 <span className="font-medium text-blue-600">{selectedMccIds.length}</span> 个
                            </span>
                            <span className="text-gray-500">
                              可用 <span className="font-medium">{availableMccAccounts.length}</span> / 总计 <span className="font-medium">{mccAccounts.length}</span>
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* 点击外部关闭 */}
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setIsMccSelectOpen(false)}
                    />
                  </>
                )}
              </div>

              {/* 已选择 MCC 预览 - 优化显示 */}
              {selectedMccIds.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-900">
                      已选择 {selectedMccIds.length} 个 MCC 账号
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedMccIds.slice(0, 5).map(id => {
                      const mcc = mccAccounts.find(m => m.customerId === id)
                      return (
                        <Badge 
                          key={id} 
                          variant="secondary" 
                          className="text-xs bg-white text-blue-700 border border-blue-200"
                        >
                          {mcc?.accountName || id}
                        </Badge>
                      )
                    })}
                    {selectedMccIds.length > 5 && (
                      <Badge variant="outline" className="text-xs">
                        +{selectedMccIds.length - 5}
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-3 border-t pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setIsAssignDialogOpen(false)
                setSelectedMccIds([])
                setSearchTerm('')
                setIsMccSelectOpen(false)
              }}
              disabled={assigning}
              className="min-w-[100px]"
            >
              取消
            </Button>
            <Button
              onClick={handleAssign}
              disabled={assigning || selectedMccIds.length === 0}
              className={cn(
                "min-w-[140px] transition-all duration-200",
                selectedMccIds.length > 0 && !assigning && "hover:shadow-md"
              )}
            >
              {assigning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  分配中...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  确认分配 {selectedMccIds.length} 个账号
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 🔧 删除确认对话框 */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-600" />
              确认删除
            </DialogTitle>
            <DialogDescription>
              确定要删除这个 MCC 账号分配吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteConfirmOpen(false)
                setMccToDelete(null)
              }}
              disabled={!!removingMccId}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={!!removingMccId}
            >
              {removingMccId ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  删除中...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  确认删除
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 🔧 批量操作对话框 */}
      <Dialog open={bulkActionDialogOpen} onOpenChange={setBulkActionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {bulkActionType === 'remove' ? (
                <>
                  <Trash2 className="w-5 h-5 text-red-600" />
                  批量移除 MCC
                </>
              ) : (
                <>
                  <Users className="w-5 h-5 text-blue-600" />
                  批量转移 MCC
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {bulkActionType === 'remove' ? (
                <>
                  确定要移除选中的 <span className="font-medium text-blue-600">{selectedAssignments.length}</span> 个 MCC 分配吗？
                </>
              ) : (
                <>
                  批量转移功能仅支持单个 MCC 操作
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {bulkActionType === 'remove' ? (
            <Alert className="bg-amber-50 border-amber-200">
              <Trash2 className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-sm text-amber-900">
                此操作不可撤销，移除后用户将失去这些 MCC 的访问权限
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="bulk-transfer-target">目标用户</Label>
                <Select value={transferTargetUserId} onValueChange={setTransferTargetUserId}>
                  <SelectTrigger id="bulk-transfer-target">
                    <SelectValue placeholder="选择目标用户" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map(user => (
                      <SelectItem key={user.id} value={user.id.toString()}>
                        {user.username || user.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setBulkActionDialogOpen(false)
                setSelectedAssignments([])
                setTransferTargetUserId('')
              }}
              disabled={transferring}
            >
              取消
            </Button>
            <Button
              onClick={handleBulkAction}
              disabled={transferring || (bulkActionType === 'transfer' && !transferTargetUserId)}
              variant={bulkActionType === 'remove' ? 'destructive' : 'default'}
            >
              {transferring ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  {bulkActionType === 'remove' ? (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      确认移除
                    </>
                  ) : (
                    <>
                      <Users className="w-4 h-4 mr-2" />
                      确认转移
                    </>
                  )}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 🔧 MCC 转移对话框 */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              转移 MCC 账号
            </DialogTitle>
            <DialogDescription>
              将 MCC <span className="font-mono font-medium">{mccToTransfer?.mccId}</span> 从 
              <span className="text-blue-600 font-medium"> {mccToTransfer?.fromUsername}</span> 
              转移给其他用户
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="transfer-target">目标用户</Label>
              <Select value={transferTargetUserId} onValueChange={setTransferTargetUserId}>
                <SelectTrigger id="transfer-target">
                  <SelectValue placeholder="选择目标用户" />
                </SelectTrigger>
                <SelectContent>
                  {users
                    .filter(u => u.id.toString() !== mccToTransfer?.fromUserId.toString())
                    .map(user => (
                      <SelectItem key={user.id} value={user.id.toString()}>
                        {user.username || user.email}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {transferTargetUserId && (
                <div className="text-xs text-green-600 flex items-center gap-1 mt-2">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  将转移给：<span className="font-medium">{users.find(u => u.id.toString() === transferTargetUserId)?.username}</span>
                </div>
              )}
            </div>

            <Alert className="bg-amber-50 border-amber-200">
              <CheckCircle2 className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-sm text-amber-900">
                转移后，原用户将失去该 MCC 的访问权限，目标用户将获得访问权限
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setTransferDialogOpen(false)
                setMccToTransfer(null)
                setTransferTargetUserId('')
              }}
              disabled={transferring}
            >
              取消
            </Button>
            <Button
              onClick={handleConfirmTransfer}
              disabled={transferring || !transferTargetUserId}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {transferring ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  转移中...
                </>
              ) : (
                <>
                  <Users className="w-4 h-4 mr-2" />
                  确认转移
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
