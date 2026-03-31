'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Edit, Trash, ChevronLeft, ChevronRight, Wand2, XCircle, CheckCircle, Search, Key, Copy, Check, History, Unlock, ShieldAlert, ArrowUpDown, ArrowUp, ArrowDown, Zap, ZapOff, MoreHorizontal, Boxes, TrendingUp } from 'lucide-react'
import { toast } from "sonner"
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// 动物名列表用于生成用户名
const ANIMAL_NAMES = [
    'wolf', 'eagle', 'tiger', 'lion', 'bear', 'fox', 'hawk', 'deer', 'owl', 'swan',
    'panda', 'koala', 'lynx', 'otter', 'raven', 'falcon', 'cobra', 'whale', 'shark', 'phoenix',
    'dragon', 'panther', 'jaguar', 'leopard', 'cheetah', 'gazelle', 'antelope', 'buffalo', 'bison', 'moose',
    'elk', 'zebra', 'giraffe', 'hippo', 'rhino', 'camel', 'llama', 'alpaca', 'rabbit', 'squirrel'
]

const ADJECTIVES = [
    'bold', 'swift', 'wise', 'brave', 'calm', 'keen', 'noble', 'proud', 'quick', 'sharp',
    'agile', 'clever', 'mighty', 'silent', 'steady', 'fierce', 'gentle', 'loyal', 'cosmic', 'stellar'
]

interface User {
    id: number
    username: string
    email: string
    role: string
    packageType: string
    packageExpiresAt: string | null
    // 🔧 修复(2025-12-30): API统一返回boolean类型
    isActive: boolean
    openclawEnabled: boolean
    productManagementEnabled: boolean
    strategyCenterEnabled: boolean
    disableSuggested?: boolean
    disableSuggestedReason?: 'expired_over_30d' | null
    createdAt: string
    lockedUntil: string | null
    failedLoginCount: number
    lastLoginAt: string | null
}

interface Pagination {
    total: number
    page: number
    limit: number
    totalPages: number
}

interface LoginRecord {
    type: 'login_attempt' | 'audit_log'
    id: number
    success?: boolean
    ipAddress: string
    userAgent: string
    failureReason?: string
    eventType?: string
    details?: any
    timestamp: string
}

export default function UserManagementPage() {
    const [users, setUsers] = useState<User[]>([])
    const [loading, setLoading] = useState(true)
    const skipNextPageFetchRef = useRef(false)
    const [pagination, setPagination] = useState<Pagination>({
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0
    })

    type SortField = 'id' | 'username' | 'role' | 'packageType' | 'packageExpiresAt' | 'createdAt' | 'lastLoginAt' | 'status'
    type SortDirection = 'asc' | 'desc'
    const [sortField, setSortField] = useState<SortField>('createdAt')
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

    // Filters
    const [searchQuery, setSearchQuery] = useState('')
    const [roleFilter, setRoleFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')
    const [packageFilter, setPackageFilter] = useState('all')

    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [isEditOpen, setIsEditOpen] = useState(false)
    const [selectedUser, setSelectedUser] = useState<User | null>(null)

    // 🔧 新增(2025-12-30): loading状态管理，防止重复提交
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Create Form State
    const [createUsername, setCreateUsername] = useState('')
    const [createEmail, setCreateEmail] = useState('')
    const [createPackage, setCreatePackage] = useState('trial')
    const [createExpiry, setCreateExpiry] = useState('')

    // 根据套餐类型计算过期时间
    const calculateExpiryDate = (packageType: string): string => {
        const today = new Date()
        let expiryDate: Date

        switch (packageType) {
            case 'trial':
                expiryDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) // +7天
                break
            case 'annual':
                expiryDate = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000) // +365天
                break
            case 'lifetime':
            case 'enterprise':
                expiryDate = new Date('2099-12-31')
                break
            default:
                expiryDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
        }

        return expiryDate.toISOString().split('T')[0]
    }

    // 自动生成唯一用户名
    const generateUsername = async () => {
        const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
        const animal = ANIMAL_NAMES[Math.floor(Math.random() * ANIMAL_NAMES.length)]
        const number = Math.floor(Math.random() * 900) + 100 // 100-999
        const username = `${adjective}${animal}${number}`

        // 检查用户名是否已存在
        try {
            const res = await fetch(`/api/admin/users?search=${username}`)
            const data = await res.json()
            const exists = data.users?.some((u: User) => u.username === username)

            if (exists) {
                // 🔧 修复(2025-12-30): 添加return，避免设置冲突的用户名
                return generateUsername()
            } else {
                setCreateUsername(username)
            }
        } catch {
            // 如果检查失败，仍然设置用户名
            setCreateUsername(username)
        }
    }

    // 当套餐类型改变时自动更新过期时间
    const handlePackageChange = (value: string) => {
        setCreatePackage(value)
        setCreateExpiry(calculateExpiryDate(value))
    }

    // 初始化时设置默认过期时间
    useEffect(() => {
        if (isCreateOpen && !createExpiry) {
            setCreateExpiry(calculateExpiryDate(createPackage))
        }
    }, [isCreateOpen])

    // Edit Form State
    const [editEmail, setEditEmail] = useState('')
    const [editPackage, setEditPackage] = useState('')
    const [editExpiry, setEditExpiry] = useState('')
    // 🔧 修复(2025-12-30): 改为boolean类型匹配API
    const [editStatus, setEditStatus] = useState(true)

    // Reset password dialog
    const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false)
    const [resetPasswordData, setResetPasswordData] = useState<{username: string, password: string} | null>(null)
    const [copied, setCopied] = useState(false)

    // Login history dialog
    const [isLoginHistoryOpen, setIsLoginHistoryOpen] = useState(false)
    const [loginHistoryUser, setLoginHistoryUser] = useState<User | null>(null)
    const [loginRecords, setLoginRecords] = useState<LoginRecord[]>([])
    const [loadingHistory, setLoadingHistory] = useState(false)

    // Security alerts dialog
    const [isAlertsOpen, setIsAlertsOpen] = useState(false)
    const [alertsUser, setAlertsUser] = useState<User | null>(null)
    const [alerts, setAlerts] = useState<any[]>([])
    const [loadingAlerts, setLoadingAlerts] = useState(false)

    // Confirmation dialogs
    const [confirmDialog, setConfirmDialog] = useState<{
        open: boolean
        title: string
        description: string
        onConfirm: () => void
        confirmText?: string
        variant?: 'default' | 'destructive'
    }>({
        open: false,
        title: '',
        description: '',
        onConfirm: () => {},
        confirmText: '确认',
        variant: 'default'
    })

    useEffect(() => {
        const timer = setTimeout(() => {
            skipNextPageFetchRef.current = true
            fetchUsers(1)
        }, 300)
        return () => clearTimeout(timer)
    }, [searchQuery, roleFilter, statusFilter, packageFilter, sortField, sortDirection])

    useEffect(() => {
        if (skipNextPageFetchRef.current) {
            skipNextPageFetchRef.current = false
            return
        }
        fetchUsers(pagination.page)
    }, [pagination.page])

    const handleSort = (field: SortField) => {
        const defaultDirection: SortDirection =
            field === 'createdAt' || field === 'lastLoginAt' || field === 'id' ? 'desc' : 'asc'

        if (sortField === field) {
            setSortDirection((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'))
            return
        }

        setSortField(field)
        setSortDirection(defaultDirection)
    }

    const renderSortIcon = (field: SortField) => {
        if (sortField !== field) {
            return <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
        }
        return sortDirection === 'asc'
            ? <ArrowUp className="w-3.5 h-3.5" />
            : <ArrowDown className="w-3.5 h-3.5" />
    }

    const fetchUsers = async (page: number = 1, limit?: number) => {
        try {
            setLoading(true)
            const params = new URLSearchParams({
                page: page.toString(),
                limit: (limit || pagination.limit).toString(),
                search: searchQuery,
                role: roleFilter,
                status: statusFilter,
                package: packageFilter,
                sortBy: sortField,
                sortOrder: sortDirection
            })

            const res = await fetch(`/api/admin/users?${params}`)
            if (!res.ok) throw new Error('Failed to fetch users')
            const data = await res.json()
            setUsers(data.users)
            setPagination(data.pagination)
        } catch (error) {
            toast.error('加载用户列表失败')
        } finally {
            setLoading(false)
        }
    }

    const handleCreateUser = async () => {
        if (!createUsername) {
            toast.error('请先生成用户名')
            return
        }
        if (!createExpiry) {
            toast.error('请选择过期时间')
            return
        }

        // 🔧 修复(2025-12-30): 防止重复提交
        if (isSubmitting) return
        setIsSubmitting(true)

        try {
            const res = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: createUsername,
                    email: createEmail || null,
                    packageType: createPackage,
                    packageExpiresAt: createExpiry
                })
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error)

            // API返回格式: { success: true, data: { user: {...}, defaultPassword: "..." } }
            const userData = data.data || data  // 兼容新旧格式
            const username = userData.user?.username || data.username
            const password = userData.defaultPassword || data.defaultPassword

            toast.success(`用户创建成功! 用户名: ${username}, 默认密码: ${password}`)
            setIsCreateOpen(false)
            fetchUsers(pagination.page)
            // Reset form
            setCreateUsername('')
            setCreateEmail('')
            setCreatePackage('trial')
            setCreateExpiry('')
        } catch (error: any) {
            toast.error(error.message)
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleEditUser = async () => {
        if (!selectedUser) return

        // 🔧 修复(2025-12-30): 防止重复提交
        if (isSubmitting) return
        setIsSubmitting(true)

        try {
            const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: editEmail || null,
                    packageType: editPackage,
                    packageExpiresAt: editExpiry || null,
                    isActive: editStatus
                })
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error)

            toast.success('用户信息更新成功')
            setIsEditOpen(false)
            fetchUsers(pagination.page)
        } catch (error: any) {
            toast.error(error.message)
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleDisableUser = (userId: number, username: string, currentStatus: boolean) => {
        // 🔧 修复(2025-12-30): 改为boolean判断
        const action = currentStatus ? '禁用' : '启用'
        const confirmButtonText = currentStatus ? '禁用用户' : '启用用户'
        setConfirmDialog({
            open: true,
            title: `${action}用户`,
            description: `确定要${action}用户 "${username}" 吗？`,
            confirmText: confirmButtonText,
            variant: currentStatus ? 'destructive' : 'default',
            onConfirm: async () => {
                try {
                    const res = await fetch(`/api/admin/users/${userId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            isActive: !currentStatus
                        })
                    })

                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error)

                    toast.success(`用户已${action}`)
                    fetchUsers(pagination.page)
                } catch (error: any) {
                    toast.error(error.message)
                }
                setConfirmDialog(prev => ({ ...prev, open: false }))
            }
        })
    }

    const handleToggleOpenclaw = async (userId: number, username: string, currentEnabled: boolean) => {
        const action = currentEnabled ? '关闭' : '开启'
        try {
            const res = await fetch(`/api/admin/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ openclawEnabled: !currentEnabled })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            toast.success(`已${action}用户 "${username}" 的 OpenClaw 访问`)
            fetchUsers(pagination.page)
        } catch (error: any) {
            toast.error(error.message)
        }
    }

    const handleToggleProductManagement = async (userId: number, username: string, currentEnabled: boolean) => {
        const action = currentEnabled ? '关闭' : '开启'
        try {
            const res = await fetch(`/api/admin/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productManagementEnabled: !currentEnabled })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            toast.success(`已${action}用户 "${username}" 的 商品管理权限`)
            fetchUsers(pagination.page)
        } catch (error: any) {
            toast.error(error.message)
        }
    }

    const handleToggleStrategyCenter = async (userId: number, username: string, currentEnabled: boolean) => {
        const action = currentEnabled ? '关闭' : '开启'
        try {
            const res = await fetch(`/api/admin/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strategyCenterEnabled: !currentEnabled })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            toast.success(`已${action}用户 "${username}" 的 策略中心权限`)
            fetchUsers(pagination.page)
        } catch (error: any) {
            toast.error(error.message)
        }
    }

    const handleDeleteUser = (userId: number, username: string, isActive: boolean) => {
        // 检查用户是否处于启用状态
        // 🔧 修复(2025-12-30): 改为boolean判断
        if (isActive) {
            toast.error('无法删除启用状态的用户，请先禁用该用户')
            return
        }

        setConfirmDialog({
            open: true,
            title: '⚠️ 删除用户',
            description: `确定要永久删除用户 "${username}" 吗？\n\n此操作不可恢复！所有相关数据将被删除。`,
            confirmText: '永久删除',
            variant: 'destructive',
            onConfirm: async () => {
                try {
                    const res = await fetch(`/api/admin/users/${userId}`, {
                        method: 'DELETE'
                    })

                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error)

                    toast.success('用户已永久删除')
                    fetchUsers(pagination.page)
                } catch (error: any) {
                    toast.error(error.message)
                }
                setConfirmDialog(prev => ({ ...prev, open: false }))
            }
        })
    }

    const handleResetPassword = (userId: number, username: string) => {
        setConfirmDialog({
            open: true,
            title: '重置密码',
            description: `确定要重置用户 "${username}" 的密码吗？\n\n用户下次登录时需要修改密码。`,
            confirmText: '重置密码',
            variant: 'default',
            onConfirm: async () => {
                try {
                    const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
                        method: 'POST'
                    })

                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error)

                    setResetPasswordData({
                        username: data.username,
                        password: data.newPassword
                    })
                    setIsResetPasswordOpen(true)
                    setCopied(false)

                } catch (error: any) {
                    toast.error(error.message || '密码重置失败')
                }
                setConfirmDialog(prev => ({ ...prev, open: false }))
            }
        })
    }

    const handleUnlockAccount = (userId: number, username: string) => {
        setConfirmDialog({
            open: true,
            title: '解锁账户',
            description: `确定要立即解锁用户 "${username}" 吗？\n\n解锁后用户可以立即登录。`,
            confirmText: '立即解锁',
            variant: 'default',
            onConfirm: async () => {
                try {
                    const res = await fetch(`/api/admin/users/${userId}/unlock`, {
                        method: 'POST'
                    })

                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error)

                    toast.success(`用户 "${username}" 已解锁`)
                    fetchUsers(pagination.page)
                } catch (error: any) {
                    toast.error(error.message || '解锁失败')
                }
                setConfirmDialog(prev => ({ ...prev, open: false }))
            }
        })
    }

    const copyToClipboard = () => {
        if (!resetPasswordData) return

        const domain = window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://www.autoads.dev'
        const text = `【AutoAds登录信息】
访问地址: ${domain}
登录用户名: ${resetPasswordData.username}
登录密码: ${resetPasswordData.password}

首次登录需要修改密码。`

        navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            toast.success('已复制到剪贴板')
            setTimeout(() => setCopied(false), 2000)
        }).catch(() => {
            toast.error('复制失败')
        })
    }

    const openEditModal = (user: User) => {
        setSelectedUser(user)
        setEditEmail(user.email || '')
        setEditPackage(user.packageType)
        setEditExpiry(user.packageExpiresAt ? new Date(user.packageExpiresAt).toISOString().split('T')[0] : '')
        setEditStatus(user.isActive)
        setIsEditOpen(true)
    }

    const handleViewLoginHistory = async (user: User) => {
        setLoginHistoryUser(user)
        setIsLoginHistoryOpen(true)
        setLoadingHistory(true)
        setLoginRecords([])

        try {
            const res = await fetch(`/api/admin/users/${user.id}/login-history?limit=50`)
            if (!res.ok) throw new Error('获取登录记录失败')

            const data = await res.json()
            setLoginRecords(data.records)
        } catch (error: any) {
            toast.error(error.message || '获取登录记录失败')
        } finally {
            setLoadingHistory(false)
        }
    }

    const handleViewSecurityAlerts = async (user: User) => {
        setAlertsUser(user)
        setIsAlertsOpen(true)
        setLoadingAlerts(true)
        setAlerts([])

        try {
            const res = await fetch(`/api/admin/users/${user.id}/alerts`)
            if (!res.ok) throw new Error('获取安全告警失败')

            const data = await res.json()
            setAlerts(data.alerts || [])
        } catch (error: any) {
            toast.error(error.message || '获取安全告警失败')
        } finally {
            setLoadingAlerts(false)
        }
    }

    const formatTimestamp = (timestamp: string) => {
        const date = new Date(timestamp)
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        })
    }

    const getBrowserFromUserAgent = (userAgent: string) => {
        if (userAgent.includes('Chrome')) return 'Chrome'
        if (userAgent.includes('Firefox')) return 'Firefox'
        if (userAgent.includes('Safari')) return 'Safari'
        if (userAgent.includes('Edge')) return 'Edge'
        return 'Unknown'
    }

    const isUserLocked = (user: User) => {
        if (!user.lockedUntil) return false
        return new Date(user.lockedUntil) > new Date()
    }

    const calculateRemainingMinutes = (lockedUntil: string) => {
        const now = new Date()
        const lockEnd = new Date(lockedUntil)
        const diffMs = lockEnd.getTime() - now.getTime()
        const diffMinutes = Math.ceil(diffMs / 60000)
        return diffMinutes > 0 ? diffMinutes : 0
    }

    return (
        <div className="p-8 space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="page-title">用户管理</h1>
                    <p className="page-subtitle">管理系统用户、套餐和权限</p>
                </div>
                <Button onClick={() => setIsCreateOpen(true)} className="bg-indigo-600 hover:bg-indigo-700" aria-label="新建用户">
                    <Plus className="w-4 h-4 mr-2" />
                    新建用户
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-row flex-wrap items-center gap-3">
                        {/* Search */}
                        <div className="flex-1 min-w-[280px] relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="搜索用户名或邮箱..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10"
                            />
                        </div>

                        {/* Role Filter */}
                        <div className="shrink-0">
                            <Select value={roleFilter} onValueChange={setRoleFilter}>
                                <SelectTrigger className="w-[150px]">
                                    <SelectValue placeholder="角色" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">所有角色</SelectItem>
                                    <SelectItem value="admin">管理员</SelectItem>
                                    <SelectItem value="user">普通用户</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Package Filter */}
                        <div className="shrink-0">
                            <Select value={packageFilter} onValueChange={setPackageFilter}>
                                <SelectTrigger className="w-[150px]">
                                    <SelectValue placeholder="套餐" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">所有套餐</SelectItem>
                                    <SelectItem value="trial">试用版</SelectItem>
                                    <SelectItem value="annual">年度会员</SelectItem>
                                    <SelectItem value="lifetime">长期会员</SelectItem>
                                    <SelectItem value="enterprise">私有化部署</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Status Filter */}
                        <div className="shrink-0">
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-[150px]">
                                    <SelectValue placeholder="状态" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">所有状态</SelectItem>
                                    <SelectItem value="active">正常</SelectItem>
                                    <SelectItem value="disabled">禁用</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table className="w-max min-w-[1040px] table-fixed text-sm [&_th]:h-9 [&_th]:px-2 [&_td]:px-2 [&_td]:py-2">
                            <TableHeader>
                                <TableRow>
                                    <TableHead
                                        className="hidden w-[64px] whitespace-nowrap sm:table-cell"
                                        aria-sort={sortField === 'id' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => handleSort('id')}
                                            className="flex items-center gap-1 whitespace-nowrap hover:text-foreground select-none"
                                        >
                                            用户ID
                                            {renderSortIcon('id')}
                                        </button>
                                    </TableHead>
                                    <TableHead
                                        className="w-[132px] whitespace-nowrap sm:w-[184px]"
                                        aria-sort={sortField === 'username' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => handleSort('username')}
                                            className="flex items-center gap-1 whitespace-nowrap hover:text-foreground select-none"
                                        >
                                            用户
                                            {renderSortIcon('username')}
                                        </button>
                                    </TableHead>
                                    <TableHead
                                        className="hidden w-[64px] whitespace-nowrap lg:table-cell"
                                        aria-sort={sortField === 'role' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => handleSort('role')}
                                            className="flex items-center gap-1 whitespace-nowrap hover:text-foreground select-none"
                                        >
                                            角色
                                            {renderSortIcon('role')}
                                        </button>
                                    </TableHead>
                                    <TableHead
                                        className="hidden w-[92px] whitespace-nowrap md:table-cell"
                                        aria-sort={sortField === 'packageType' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => handleSort('packageType')}
                                            className="flex items-center gap-1 whitespace-nowrap hover:text-foreground select-none"
                                        >
                                            套餐
                                            {renderSortIcon('packageType')}
                                        </button>
                                    </TableHead>
                                    <TableHead
                                        className="hidden w-[88px] whitespace-nowrap lg:table-cell"
                                        aria-sort={sortField === 'packageExpiresAt' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => handleSort('packageExpiresAt')}
                                            className="flex items-center gap-1 whitespace-nowrap hover:text-foreground select-none"
                                        >
                                            有效期
                                            {renderSortIcon('packageExpiresAt')}
                                        </button>
                                    </TableHead>
                                    <TableHead
                                        className="hidden w-[84px] whitespace-nowrap xl:table-cell"
                                        aria-sort={sortField === 'createdAt' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => handleSort('createdAt')}
                                            className="flex items-center gap-1 whitespace-nowrap hover:text-foreground select-none"
                                        >
                                            创建时间
                                            {renderSortIcon('createdAt')}
                                        </button>
                                    </TableHead>
                                    <TableHead
                                        className="hidden w-[108px] whitespace-nowrap xl:table-cell"
                                        aria-sort={sortField === 'lastLoginAt' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => handleSort('lastLoginAt')}
                                            className="flex items-center gap-1 whitespace-nowrap hover:text-foreground select-none"
                                        >
                                            上次登录
                                            {renderSortIcon('lastLoginAt')}
                                        </button>
                                    </TableHead>
                                    <TableHead
                                        className="w-[78px] whitespace-nowrap sm:w-[110px]"
                                        aria-sort={sortField === 'status' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => handleSort('status')}
                                            className="flex items-center gap-1 whitespace-nowrap hover:text-foreground select-none"
                                        >
                                            状态
                                            {renderSortIcon('status')}
                                        </button>
                                    </TableHead>
                                    <TableHead className="w-[96px] text-center whitespace-nowrap sm:w-[136px]">操作</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {users.length === 0 && !loading ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                                            未找到用户
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    users.map((user) => (
                                        <TableRow key={user.id}>
                                            <TableCell className="hidden font-mono text-sm text-muted-foreground whitespace-nowrap sm:table-cell">
                                                {user.id}
                                            </TableCell>
                                            <TableCell className="min-w-0">
                                                <div className="flex min-w-0 items-center gap-1.5">
                                                    <Avatar className="h-8 w-8 shrink-0">
                                                        <AvatarFallback className="bg-indigo-100 text-indigo-600">
                                                            {user.username.substring(0, 2).toUpperCase()}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <div className="truncate font-medium leading-5">{user.username}</div>
                                                        <div className="hidden truncate text-xs text-muted-foreground 2xl:block">{user.email || '无邮箱'}</div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="hidden whitespace-nowrap lg:table-cell">
                                                <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="h-6 px-2 text-xs">
                                                    {user.role === 'admin' ? '管理员' : '用户'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="hidden whitespace-nowrap md:table-cell">
                                                <Badge variant="outline" className="h-6 px-2 text-xs capitalize whitespace-nowrap">
                                                    {user.packageType === 'trial' ? '试用版' :
                                                     user.packageType === 'annual' ? '年度会员' :
                                                     user.packageType === 'lifetime' ? '长期会员' : '私有化部署'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="hidden text-muted-foreground whitespace-nowrap lg:table-cell">
                                                {user.packageExpiresAt ? new Date(user.packageExpiresAt).toLocaleDateString('zh-CN') : '长期'}
                                            </TableCell>
                                            <TableCell className="hidden text-muted-foreground whitespace-nowrap xl:table-cell">
                                                {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                                            </TableCell>
                                            <TableCell className="hidden text-muted-foreground whitespace-nowrap xl:table-cell">
                                                {user.lastLoginAt ? (
                                                    <span className="text-xs">
                                                        {new Date(user.lastLoginAt).toLocaleDateString('zh-CN')} {new Date(user.lastLoginAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground">未登录</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap">
                                                <div className="flex flex-col gap-1">
                                                    {/* 🔧 修复(2025-12-30): 改为boolean判断 */}
                                                    {!user.isActive ? (
                                                        <Badge variant="destructive" className="h-6 px-2 text-xs whitespace-nowrap">
                                                            <span className="sm:hidden">禁用</span>
                                                            <span className="hidden sm:inline">🚫 已禁用</span>
                                                        </Badge>
                                                    ) : isUserLocked(user) ? (
                                                        <Badge variant="outline" className="h-6 px-2 text-xs text-yellow-600 border-yellow-600 whitespace-nowrap">
                                                            <span className="2xl:hidden">⏳ 已锁定</span>
                                                            <span className="hidden 2xl:inline">⏳ 已锁定（还剩{calculateRemainingMinutes(user.lockedUntil!)}分钟）</span>
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="outline" className="h-6 px-2 text-xs text-green-600 border-green-600 whitespace-nowrap">
                                                            <span className="sm:hidden">正常</span>
                                                            <span className="hidden sm:inline">✅ 正常</span>
                                                        </Badge>
                                                    )}
                                                    {user.isActive && user.disableSuggested ? (
                                                        <span className="text-[11px] leading-4 text-amber-600">
                                                            可禁用（已过期30天+）
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </TableCell>
                                            <TableCell className="px-1">
                                                <div className="flex items-center justify-center gap-0">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="hidden h-8 w-8 lg:inline-flex"
                                                        onClick={() => openEditModal(user)}
                                                        title="编辑"
                                                    >
                                                        <Edit className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="hidden h-8 w-8 lg:inline-flex"
                                                        onClick={() => handleResetPassword(user.id, user.username)}
                                                        title="重置密码"
                                                    >
                                                        <Key className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="hidden h-8 w-8 lg:inline-flex"
                                                        onClick={() => handleDisableUser(user.id, user.username, user.isActive)}
                                                        title={user.isActive ? '禁用账户' : '启用账户'}
                                                    >
                                                        {user.isActive ? (
                                                            <XCircle className="w-4 h-4 text-orange-600" />
                                                        ) : (
                                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                                        )}
                                                    </Button>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8" title="更多操作">
                                                                <MoreHorizontal className="w-4 h-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="w-72">
                                                            <DropdownMenuItem
                                                                onClick={() => handleViewLoginHistory(user)}
                                                                className="items-start gap-2 py-2"
                                                                title="查看最近登录历史和失败记录"
                                                            >
                                                                <History className="w-4 h-4 mt-0.5 shrink-0" />
                                                                <div>
                                                                    <div className="font-medium">查看登录记录</div>
                                                                    <div className="text-xs text-muted-foreground">查看最近登录历史和失败记录</div>
                                                                </div>
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => handleViewSecurityAlerts(user)}
                                                                className="items-start gap-2 py-2"
                                                                title="查看账户共享安全告警"
                                                            >
                                                                <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                                                                <div>
                                                                    <div className="font-medium">查看安全告警</div>
                                                                    <div className="text-xs text-muted-foreground">查看账户共享和异常使用风险</div>
                                                                </div>
                                                            </DropdownMenuItem>
                                                            {isUserLocked(user) && (
                                                                <DropdownMenuItem
                                                                    onClick={() => handleUnlockAccount(user.id, user.username)}
                                                                    className="items-start gap-2 py-2"
                                                                    title="解除当前登录锁定状态"
                                                                >
                                                                    <Unlock className="w-4 h-4 mt-0.5 shrink-0 text-blue-600" />
                                                                    <div>
                                                                        <div className="font-medium">立即解锁账户</div>
                                                                        <div className="text-xs text-muted-foreground">解除当前登录锁定状态</div>
                                                                    </div>
                                                                </DropdownMenuItem>
                                                            )}
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem
                                                                onClick={() => handleToggleProductManagement(user.id, user.username, user.productManagementEnabled)}
                                                                className="items-start gap-2 py-2"
                                                                title={user.productManagementEnabled ? '关闭用户 商品管理 权限' : '开启用户 商品管理 权限'}
                                                            >
                                                                <Boxes className={`w-4 h-4 mt-0.5 shrink-0 ${user.productManagementEnabled ? 'text-emerald-600' : 'text-gray-500'}`} />
                                                                <div>
                                                                    <div className="font-medium">{user.productManagementEnabled ? '关闭 商品管理 权限' : '开启 商品管理 权限'}</div>
                                                                    <div className="text-xs text-muted-foreground">切换该用户的商品管理访问权限</div>
                                                                </div>
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => handleToggleStrategyCenter(user.id, user.username, user.strategyCenterEnabled)}
                                                                className="items-start gap-2 py-2"
                                                                title={user.strategyCenterEnabled ? '关闭用户 策略中心 权限' : '开启用户 策略中心 权限'}
                                                            >
                                                                <TrendingUp className={`w-4 h-4 mt-0.5 shrink-0 ${user.strategyCenterEnabled ? 'text-blue-600' : 'text-gray-500'}`} />
                                                                <div>
                                                                    <div className="font-medium">{user.strategyCenterEnabled ? '关闭 策略中心 权限' : '开启 策略中心 权限'}</div>
                                                                    <div className="text-xs text-muted-foreground">切换该用户的策略中心访问权限</div>
                                                                </div>
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => handleToggleOpenclaw(user.id, user.username, user.openclawEnabled)}
                                                                className="items-start gap-2 py-2"
                                                                title={user.openclawEnabled ? '关闭用户 OpenClaw 访问' : '开启用户 OpenClaw 访问'}
                                                            >
                                                                {user.openclawEnabled ? (
                                                                    <Zap className="w-4 h-4 mt-0.5 shrink-0 text-violet-600" />
                                                                ) : (
                                                                    <ZapOff className="w-4 h-4 mt-0.5 shrink-0 text-gray-500" />
                                                                )}
                                                                <div>
                                                                    <div className="font-medium">{user.openclawEnabled ? '关闭 OpenClaw 访问' : '开启 OpenClaw 访问'}</div>
                                                                    <div className="text-xs text-muted-foreground">切换该用户的 OpenClaw 使用权限</div>
                                                                </div>
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => handleDisableUser(user.id, user.username, user.isActive)}
                                                                className="items-start gap-2 py-2 lg:hidden"
                                                                title={user.isActive ? '禁用此账号登录能力' : '恢复此账号登录能力'}
                                                            >
                                                                {user.isActive ? (
                                                                    <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-orange-600" />
                                                                ) : (
                                                                    <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-green-600" />
                                                                )}
                                                                <div>
                                                                    <div className="font-medium">{user.isActive ? '禁用账户' : '启用账户'}</div>
                                                                    <div className="text-xs text-muted-foreground">{user.isActive ? '禁用后该用户无法登录系统' : '恢复该用户的登录能力'}</div>
                                                                </div>
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem
                                                                onClick={() => handleDeleteUser(user.id, user.username, user.isActive)}
                                                                className="items-start gap-2 py-2 text-red-600 focus:text-red-600"
                                                                title="永久删除该用户及其相关数据"
                                                            >
                                                                <Trash className="w-4 h-4 mt-0.5 shrink-0" />
                                                                <div>
                                                                    <div className="font-medium">删除用户</div>
                                                                    <div className="text-xs text-red-500/80">永久删除用户（需先禁用）</div>
                                                                </div>
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    {pagination.total > 0 && (
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-4">
                            <div className="flex items-center flex-wrap gap-3">
                                <div className="flex items-center gap-1.5 flex-nowrap">
                                    <span className="text-sm text-muted-foreground whitespace-nowrap">每页显示</span>
                                    <Select
                                        value={String(pagination.limit)}
                                        onValueChange={(value) => {
                                            const newLimit = Number(value)
                                            setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }))
                                            fetchUsers(1, newLimit)
                                        }}
                                    >
                                        <SelectTrigger className="w-[70px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="10">10</SelectItem>
                                            <SelectItem value="20">20</SelectItem>
                                            <SelectItem value="50">50</SelectItem>
                                            <SelectItem value="100">100</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <span className="text-sm text-muted-foreground whitespace-nowrap">条</span>
                                </div>
                                <div className="text-sm text-muted-foreground whitespace-nowrap">
                                    显示 {(pagination.page - 1) * pagination.limit + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} 条，共 {pagination.total} 条
                                </div>
                            </div>
                            <div className="flex items-center gap-2 flex-nowrap">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                                    disabled={pagination.page === 1 || loading}
                                >
                                    <ChevronLeft className="w-4 h-4 mr-1" />
                                    上一页
                                </Button>
                                <div className="text-sm text-muted-foreground whitespace-nowrap">
                                    第 {pagination.page} / {pagination.totalPages} 页
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                                    disabled={pagination.page === pagination.totalPages || loading}
                                >
                                    下一页
                                    <ChevronRight className="w-4 h-4 ml-1" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Create User Modal */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>新建用户</DialogTitle>
                        <DialogDescription>
                            创建一个新用户账号。默认密码为 auto11@20ads
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>用户名 <span className="text-red-500">*</span></Label>
                            <div className="flex gap-2">
                                <Input
                                    placeholder="点击自动生成按钮生成用户名"
                                    value={createUsername}
                                    onChange={(e) => setCreateUsername(e.target.value)}
                                    className="flex-1"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={generateUsername}
                                    className="shrink-0"
                                >
                                    <Wand2 className="w-4 h-4 mr-2" />
                                    自动生成
                                </Button>
                            </div>
                            {createUsername && (
                                <p className="text-caption text-muted-foreground">
                                    生成的用户名: <span className="font-medium text-foreground">{createUsername}</span>
                                </p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>套餐类型 <span className="text-red-500">*</span></Label>
                            <Select value={createPackage} onValueChange={handlePackageChange}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="trial">试用版 (Trial)</SelectItem>
                                    <SelectItem value="annual">年度会员 (Annual)</SelectItem>
                                    <SelectItem value="lifetime">长期会员</SelectItem>
                                    <SelectItem value="enterprise">私有化部署 (Enterprise)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>过期时间 <span className="text-red-500">*</span></Label>
                            <Input
                                type="date"
                                value={createExpiry}
                                onChange={(e) => setCreateExpiry(e.target.value)}
                            />
                            <p className="text-caption text-muted-foreground">
                                {createPackage === 'trial' && '试用版: 当前日期 + 7天'}
                                {createPackage === 'annual' && '年度会员: 当前日期 + 365天'}
                                {(createPackage === 'lifetime' || createPackage === 'enterprise') && '长期会员/企业版: 2099-12-31'}
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>邮箱地址 <span className="text-caption text-muted-foreground">(可选)</span></Label>
                            <Input
                                placeholder="user@example.com"
                                value={createEmail}
                                onChange={(e) => setCreateEmail(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isSubmitting}>取消</Button>
                        <Button onClick={handleCreateUser} disabled={!createUsername || !createExpiry || isSubmitting}>
                            {isSubmitting ? '创建中...' : '创建用户'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit User Modal */}
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>编辑用户</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>用户名</Label>
                            <Input
                                value={selectedUser?.username || ''}
                                disabled
                                className="bg-muted cursor-not-allowed"
                            />
                            <p className="text-caption text-muted-foreground">用户名不可修改</p>
                        </div>
                        <div className="space-y-2">
                            <Label>邮箱地址 <span className="text-caption text-muted-foreground">(可选)</span></Label>
                            <Input
                                type="email"
                                placeholder="user@example.com"
                                value={editEmail}
                                onChange={(e) => setEditEmail(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>套餐类型</Label>
                            <Select value={editPackage} onValueChange={setEditPackage}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="trial">试用版 (Trial)</SelectItem>
                                    <SelectItem value="annual">年度会员 (Annual)</SelectItem>
                                    <SelectItem value="lifetime">长期会员</SelectItem>
                                    <SelectItem value="enterprise">私有化部署 (Enterprise)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>过期时间</Label>
                            <Input
                                type="date"
                                value={editExpiry}
                                onChange={(e) => setEditExpiry(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>账号状态</Label>
                            {/* 🔧 修复(2025-12-30): 改为boolean值 */}
                            <Select value={String(editStatus)} onValueChange={(v) => setEditStatus(v === 'true')}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="true">正常</SelectItem>
                                    <SelectItem value="false">禁用</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditOpen(false)} disabled={isSubmitting}>取消</Button>
                        <Button onClick={handleEditUser} disabled={isSubmitting}>
                            {isSubmitting ? '保存中...' : '保存更改'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Reset Password Modal */}
            <Dialog open={isResetPasswordOpen} onOpenChange={setIsResetPasswordOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>密码重置成功</DialogTitle>
                        <DialogDescription>
                            请将以下登录信息发送给用户，用户首次登录需修改密码。
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="p-4 bg-muted rounded-lg space-y-2 font-mono text-sm">
                            <div>【AutoAds登录信息】</div>
                            <div>访问地址: {typeof window !== 'undefined' && (window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://www.autoads.dev')}</div>
                            <div>登录用户名: {resetPasswordData?.username}</div>
                            <div>登录密码: <span className="font-bold text-indigo-600">{resetPasswordData?.password}</span></div>
                            <div className="text-muted-foreground text-xs">首次登录需要修改密码。</div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsResetPasswordOpen(false)}>关闭</Button>
                        <Button onClick={copyToClipboard}>
                            {copied ? (
                                <>
                                    <Check className="w-4 h-4 mr-2" />
                                    已复制
                                </>
                            ) : (
                                <>
                                    <Copy className="w-4 h-4 mr-2" />
                                    复制
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Confirmation Dialog */}
            <Dialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{confirmDialog.title}</DialogTitle>
                        <DialogDescription className="whitespace-pre-line">
                            {confirmDialog.description}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
                        >
                            取消
                        </Button>
                        <Button
                            variant={confirmDialog.variant}
                            onClick={confirmDialog.onConfirm}
                        >
                            {confirmDialog.confirmText}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Login History Dialog */}
            <Dialog open={isLoginHistoryOpen} onOpenChange={setIsLoginHistoryOpen}>
                <DialogContent className="max-w-4xl max-h-[80vh]">
                    <DialogHeader>
                        <DialogTitle>登录记录</DialogTitle>
                        <DialogDescription>
                            {loginHistoryUser?.username} ({loginHistoryUser?.email || '无邮箱'}) 的登录历史
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4 overflow-y-auto max-h-[60vh]">
                        {loadingHistory ? (
                            <div className="text-center py-8 text-muted-foreground">
                                加载中...
                            </div>
                        ) : loginRecords.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                暂无登录记录
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {loginRecords.map((record) => (
                                    <div
                                        key={`${record.type}-${record.id}`}
                                        className={`p-4 rounded-lg border ${
                                            record.success === true || record.eventType === 'login_success'
                                                ? 'bg-green-50 border-green-200'
                                                : record.eventType === 'account_locked'
                                                ? 'bg-red-50 border-red-200'
                                                : 'bg-orange-50 border-orange-200'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <Badge
                                                        variant={
                                                            record.success === true || record.eventType === 'login_success'
                                                                ? 'default'
                                                                : 'destructive'
                                                        }
                                                    >
                                                        {record.success === true || record.eventType === 'login_success'
                                                            ? '✅ 登录成功'
                                                            : record.eventType === 'account_locked'
                                                            ? '🔒 账户被锁定'
                                                            : '❌ 登录失败'}
                                                    </Badge>
                                                    {record.failureReason && (
                                                        <span className="text-sm text-muted-foreground">
                                                            原因: {record.failureReason}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                                                    <div>
                                                        <span className="text-muted-foreground">时间: </span>
                                                        <span className="font-mono">{formatTimestamp(record.timestamp)}</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-muted-foreground">IP: </span>
                                                        <span className="font-mono">{record.ipAddress}</span>
                                                    </div>
                                                    <div className="col-span-2">
                                                        <span className="text-muted-foreground">浏览器: </span>
                                                        <span className="text-xs font-mono text-muted-foreground">
                                                            {getBrowserFromUserAgent(record.userAgent)} - {record.userAgent.substring(0, 80)}
                                                            {record.userAgent.length > 80 ? '...' : ''}
                                                        </span>
                                                    </div>
                                                    {record.details && (
                                                        <div className="col-span-2">
                                                            <span className="text-muted-foreground">详情: </span>
                                                            <span className="text-xs">
                                                                {JSON.stringify(record.details)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsLoginHistoryOpen(false)}>
                            关闭
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Security Alerts Dialog */}
            <Dialog open={isAlertsOpen} onOpenChange={setIsAlertsOpen}>
                <DialogContent className="max-w-4xl max-h-[80vh]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ShieldAlert className="w-5 h-5 text-amber-600" />
                            安全告警列表
                        </DialogTitle>
                        <DialogDescription>
                            {alertsUser?.username} ({alertsUser?.email || '无邮箱'}) 的账户共享安全告警
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4 overflow-y-auto max-h-[60vh]">
                        {loadingAlerts ? (
                            <div className="text-center py-8 text-muted-foreground">
                                加载中...
                            </div>
                        ) : alerts.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                <ShieldAlert className="w-12 h-12 mx-auto mb-3 text-green-400" />
                                <div className="text-lg font-medium">暂无安全告警</div>
                                <div className="text-sm">该用户账户使用正常，未检测到可疑活动</div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {alerts.map((alert) => (
                                    <div
                                        key={alert.id}
                                        className={`p-4 rounded-lg border ${
                                            alert.severity === 'critical'
                                                ? 'bg-red-50 border-red-200'
                                                : alert.severity === 'warning'
                                                ? 'bg-amber-50 border-amber-200'
                                                : 'bg-blue-50 border-blue-200'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Badge
                                                        variant={
                                                            alert.severity === 'critical'
                                                                ? 'destructive'
                                                                : alert.severity === 'warning'
                                                                ? 'outline'
                                                                : 'secondary'
                                                        }
                                                        className={
                                                            alert.severity === 'warning'
                                                                ? 'border-amber-500 text-amber-700 bg-amber-100'
                                                                : ''
                                                        }
                                                    >
                                                        {alert.severity === 'critical' && '🚨 严重'}
                                                        {alert.severity === 'warning' && '⚠️ 警告'}
                                                        {alert.severity === 'info' && 'ℹ️ 信息'}
                                                        {alert.alertType === 'MULTI_IP_LOGIN' && ' 多IP登录'}
                                                        {alert.alertType === 'NEW_DEVICE' && ' 新设备'}
                                                    </Badge>
                                                    <span className="text-xs text-muted-foreground">
                                                        {new Date(alert.createdAt).toLocaleString('zh-CN')}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-foreground mb-3">
                                                    {alert.description}
                                                </div>
                                                {alert.ipAddresses && alert.ipAddresses.length > 0 && (
                                                    <div className="text-xs text-muted-foreground">
                                                        <span className="font-medium">涉及IP: </span>
                                                        {Array.isArray(alert.ipAddresses)
                                                            ? alert.ipAddresses.join(', ')
                                                            : alert.ipAddresses}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAlertsOpen(false)}>
                            关闭
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
