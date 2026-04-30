'use client'

import { useState, useEffect } from 'react'
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

  useEffect(() => {
    fetchUsers()
    fetchMccAccounts()
    fetchAllAssignments()  // 🔧 获取所有 MCC 的分配情况
  }, [])

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
      const response = await fetch('/api/google-ads-accounts?manager=true&activeOnly=true', {
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json()
        setMccAccounts(data?.accounts || [])
      }
    } catch (error: any) {
      console.error('获取 MCC 账号失败:', error)
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
    }
  }

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
            .map((c: any) => `${c.mccCustomerId} (已绑定给：${c.assignedToUsername})`)
            .join('\n')
          throw new Error(`${error.error}\n\n${conflictList}`)
        }
        throw new Error(error.error || '分配失败')
      }

      const result = await response.json()
      toast.success(result.message)
      
      // 刷新分配列表
      fetchUserAssignments(selectedUserId)
      setIsAssignDialogOpen(false)
      setSelectedMccIds([])
    } catch (error: any) {
      console.error('分配 MCC 失败:', error)
      toast.error('分配失败', { description: error.message })
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
        throw new Error(error.error || '移除失败')
      }

      const result = await response.json()
      toast.success(result.message)
      
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

  const filteredMccAccounts = mccAccounts.filter(mcc =>
    mcc.accountName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    mcc.customerId.includes(searchTerm)
  )

  const assignedMccIds = userAssignments.map(a => a.mcc_customer_id)
  // 🔧 可用 MCC = 未分配给任何用户的 MCC
  const availableMccAccounts = filteredMccAccounts.filter(
    mcc => !allAssignments.has(mcc.customerId)
  )

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
            <Button
              onClick={() => setIsAssignDialogOpen(true)}
              disabled={!selectedUserId}
            >
              <Plus className="w-4 h-4 mr-2" />
              分配 MCC 账号
            </Button>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
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
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin" />
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
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                MCC 账号分配
              </CardTitle>
              <CardDescription>
                {selectedUserId
                  ? `用户 ${users.find(u => u.id.toString() === selectedUserId)?.username} 已分配的 MCC 账号`
                  : '请先选择用户'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              ) : !selectedUserId ? (
                <div className="text-center py-8 text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>请选择用户查看 MCC 分配</p>
                </div>
              ) : userAssignments.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>该用户暂无分配的 MCC 账号</p>
                  <Button
                    variant="link"
                    onClick={() => setIsAssignDialogOpen(true)}
                    className="mt-2"
                  >
                    分配 MCC 账号
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>MCC 账号</TableHead>
                      <TableHead>账号名称</TableHead>
                      <TableHead>分配时间</TableHead>
                      <TableHead>分配人</TableHead>
                      <TableHead className="w-[100px]">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {userAssignments.map(assignment => (
                      <TableRow key={assignment.id}>
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
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => confirmDelete(assignment.mcc_customer_id)}
                            disabled={!selectedUserId || removingMccId === assignment.mcc_customer_id}
                          >
                            {removingMccId === assignment.mcc_customer_id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-red-600" />
                            ) : (
                              <Trash2 className="w-4 h-4 text-red-600" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 分配对话框 */}
      <Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>分配 MCC 账号</DialogTitle>
            <DialogDescription>
              为用户 {users.find(u => u.id.toString() === selectedUserId)?.username} 分配 MCC 账号（支持多选）
              <br />
              <span className="text-xs text-green-600">💡 提示：仅显示未分配的 MCC 账号，一个 MCC 账号只能与一个用户绑定</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>MCC 账号（多选）</Label>
              
              {/* 自定义多选 Select */}
              <div className="relative">
                <button
                  type="button"
                  className="w-full min-h-[40px] px-3 py-2 border border-input rounded-md bg-background text-left text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  onClick={() => setIsMccSelectOpen(!isMccSelectOpen)}
                >
                  {selectedMccIds.length === 0 ? (
                    <span className="text-muted-foreground">选择 MCC 账号</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {selectedMccIds.slice(0, 3).map(id => {
                        const mcc = mccAccounts.find(m => m.customerId === id)
                        return (
                          <Badge key={id} variant="secondary" className="text-xs">
                            {mcc?.accountName || id}
                          </Badge>
                        )
                      })}
                      {selectedMccIds.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{selectedMccIds.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}
                  <ChevronDown className={cn(
                    "absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-50 transition-transform",
                    isMccSelectOpen && "rotate-180"
                  )} />
                </button>

                {/* 下拉选项 */}
                {isMccSelectOpen && (
                  <div className="absolute z-50 w-full mt-1 border border-input rounded-md bg-popover shadow-md max-h-[300px] overflow-y-auto">
                    {/* 搜索框 */}
                    <div className="sticky top-0 bg-popover border-b p-2">
                      <Input
                        placeholder="搜索 MCC 账号"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-8"
                      />
                    </div>

                    {/* 选项列表 - 仅显示未分配的 MCC */}
                    <div className="py-2">
                      {availableMccAccounts.length === 0 ? (
                        <div className="px-4 py-2 text-sm text-muted-foreground text-center">
                          {searchTerm 
                            ? '没有匹配的未分配 MCC 账号' 
                            : '所有 MCC 账号都已分配给其他用户'}
                        </div>
                      ) : (
                        availableMccAccounts.map(mcc => (
                          <div
                            key={mcc.id}
                            className="flex items-center gap-2 px-4 py-2 hover:bg-accent cursor-pointer"
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
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-mono text-sm">{mcc.customerId}</div>
                              <div className="text-xs text-muted-foreground truncate">
                                {mcc.accountName || '未命名'}
                              </div>
                            </div>
                            {selectedMccIds.includes(mcc.customerId) && (
                              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {selectedMccIds.length > 0 && (
                <Alert className="bg-blue-50 border-blue-200">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  <AlertDescription className="text-sm text-blue-900">
                    已选择 {selectedMccIds.length} 个 MCC 账号
                  </AlertDescription>
                </Alert>
              )}
              
              {/* 统计信息 */}
              <div className="text-xs text-gray-500">
                可用 MCC：{availableMccAccounts.length} / 总 MCC：{mccAccounts.length}
              </div>
            </div>

            {/* 点击外部关闭 */}
            {isMccSelectOpen && (
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setIsMccSelectOpen(false)}
              />
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsAssignDialogOpen(false)
                setSelectedMccIds([])
                setSearchTerm('')
                setIsMccSelectOpen(false)
              }}
              disabled={assigning}
            >
              取消
            </Button>
            <Button
              onClick={handleAssign}
              disabled={assigning || selectedMccIds.length === 0}
            >
              {assigning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  分配中...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  分配 {selectedMccIds.length} 个账号
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
            <DialogTitle>确认删除</DialogTitle>
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
    </div>
  )
}
