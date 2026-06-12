'use client'

import { useEffect, useState } from 'react'
import { showSuccess, showError, showWarning } from '@/lib/toast-utils'
import { buildDeleteAccountRemoteMessage } from '@/lib/google-ads/account-delete-messages'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Edit,
  Trash2,
  Key,
  AlertTriangle,
} from 'lucide-react'

interface GoogleAdsAccount {
  id: number
  customerId: string
  accountName: string | null
  currency: string
  timezone: string
  isManagerAccount: boolean
  isActive: boolean
  hasToken: boolean
  tokenExpiresAt: string | null
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
}

interface DeleteAccountFeedback {
  localDeleted: boolean
  googleAds?: {
    planned: number
    attempted: number
    removed: number
    pausedFallback: number
    failed: number
    truncated: number
    maxCampaigns: number
    timedOut: boolean
    failures: Array<{ campaignId: string; reason: string }>
  }
  warnings?: string[]
}

export default function GoogleAdsAccountsPage() {
  const [accounts, setAccounts] = useState<GoogleAdsAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState<GoogleAdsAccount | null>(null)
  const [removeGoogleAdsCampaignsOnDelete, setRemoveGoogleAdsCampaignsOnDelete] = useState(false)
  const [deletableRemoteCampaignCount, setDeletableRemoteCampaignCount] = useState<number | null>(
    null
  )
  const [remoteDeleteMaxCampaigns, setRemoteDeleteMaxCampaigns] = useState<number | null>(null)
  const [remoteDeleteWillTruncate, setRemoteDeleteWillTruncate] = useState(false)
  const [loadingDeletableCount, setLoadingDeletableCount] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteFeedback, setDeleteFeedback] = useState<DeleteAccountFeedback | null>(null)
  const [editingAccount, setEditingAccount] = useState<GoogleAdsAccount | null>(null)
  const [formData, setFormData] = useState({
    customerId: '',
    accountName: '',
    currency: 'USD',
    timezone: 'America/New_York',
    isManagerAccount: false,
  })

  useEffect(() => {
    fetchAccounts()
  }, [])

  const fetchAccounts = async () => {
    try {
      setLoading(true)
      // 🔧 添加 filterByUserMcc=true 参数，让后端根据用户 MCC 分配过滤账号
      const response = await fetch('/api/google-ads-accounts?filterByUserMcc=true', {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('获取账号列表失败')
      }

      const data = await response.json()
      setAccounts(data.accounts)
    } catch (err: any) {
      console.error('Fetch accounts error:', err)
      showError('加载失败', err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = async () => {
    try {
      const response = await fetch('/api/google-ads-accounts', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '添加账号失败')
      }

      showSuccess('添加成功', '已成功添加Google Ads账号')
      setShowAddDialog(false)
      setFormData({
        customerId: '',
        accountName: '',
        currency: 'USD',
        timezone: 'America/New_York',
        isManagerAccount: false,
      })
      fetchAccounts()
    } catch (err: any) {
      showError('添加失败', err.message)
    }
  }

  const handleEdit = async () => {
    if (!editingAccount) return

    try {
      const response = await fetch(`/api/google-ads-accounts/${editingAccount.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accountName: formData.accountName,
          currency: formData.currency,
          timezone: formData.timezone,
          isActive: formData.isManagerAccount, // Using same field for now
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '更新账号失败')
      }

      showSuccess('更新成功', '已成功更新账号信息')
      setShowEditDialog(false)
      setEditingAccount(null)
      fetchAccounts()
    } catch (err: any) {
      showError('更新失败', err.message)
    }
  }

  const closeDeleteDialog = () => {
    setShowDeleteDialog(false)
    setDeletingAccount(null)
    setDeleteFeedback(null)
    setRemoveGoogleAdsCampaignsOnDelete(false)
  }

  const openDeleteDialog = async (account: GoogleAdsAccount) => {
    setDeletingAccount(account)
    setRemoveGoogleAdsCampaignsOnDelete(false)
    setDeletableRemoteCampaignCount(null)
    setRemoteDeleteMaxCampaigns(null)
    setRemoteDeleteWillTruncate(false)
    setDeleteFeedback(null)
    setShowDeleteDialog(true)

    try {
      setLoadingDeletableCount(true)
      const response = await fetch(
        `/api/google-ads-accounts/${account.id}?deletableCampaignCount=true`,
        { credentials: 'include' }
      )
      const data = await response.json()
      if (response.ok) {
        setDeletableRemoteCampaignCount(Number(data.deletableRemoteCampaignCount ?? 0))
        setRemoteDeleteMaxCampaigns(
          Number.isFinite(Number(data.remoteDeleteMaxCampaigns))
            ? Number(data.remoteDeleteMaxCampaigns)
            : null
        )
        setRemoteDeleteWillTruncate(Boolean(data.remoteDeleteWillTruncate))
      }
    } catch {
      setDeletableRemoteCampaignCount(null)
    } finally {
      setLoadingDeletableCount(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingAccount) return

    try {
      setDeleting(true)
      const response = await fetch(`/api/google-ads-accounts/${deletingAccount.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          removeGoogleAdsCampaigns: removeGoogleAdsCampaignsOnDelete,
        }),
      })

      const data = await response.json()

      const googleAds = data?.data?.googleAds
      const apiWarnings = Array.isArray(data?.data?.warnings) ? data.data.warnings : []
      const localDeleted = response.ok && data?.data?.localDeleted !== false
      const feedback: DeleteAccountFeedback = {
        localDeleted,
        googleAds,
        warnings: apiWarnings,
      }
      setDeleteFeedback(feedback)

      const remoteResult = buildDeleteAccountRemoteMessage(
        removeGoogleAdsCampaignsOnDelete,
        googleAds
      )
      const detailMessage = [remoteResult.message, ...apiWarnings]
        .filter((item, index, arr) => item && arr.indexOf(item) === index)
        .join('；')
      const hasFailures = (googleAds?.failures?.length ?? 0) > 0
      const hasIssues =
        !localDeleted || hasFailures || apiWarnings.length > 0 || remoteResult.tone === 'warning'

      if (!response.ok) {
        if (googleAds || apiWarnings.length > 0) {
          showWarning(
            data.error || '删除账号失败',
            detailMessage || '远端可能已部分处理，请查看下方 failures 列表'
          )
        } else {
          showError('删除失败', data.error || '删除账号失败')
          closeDeleteDialog()
        }
        return
      }

      if (hasIssues) {
        showWarning('删除完成（请关注远端结果）', detailMessage)
      } else {
        showSuccess('删除成功', detailMessage)
        closeDeleteDialog()
        fetchAccounts()
      }

      if (localDeleted && !hasIssues) {
        return
      }
      if (localDeleted) {
        fetchAccounts()
      }
    } catch (err: any) {
      showError('删除失败', err.message)
    } finally {
      setDeleting(false)
    }
  }

  const handleToggleActive = async (account: GoogleAdsAccount) => {
    try {
      const response = await fetch(`/api/google-ads-accounts/${account.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isActive: !account.isActive,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '更新状态失败')
      }

      showSuccess('更新成功', `账号已${!account.isActive ? '激活' : '停用'}`)
      fetchAccounts()
    } catch (err: any) {
      showError('更新失败', err.message)
    }
  }

  const openEditDialog = (account: GoogleAdsAccount) => {
    setEditingAccount(account)
    setFormData({
      customerId: account.customerId,
      accountName: account.accountName || '',
      currency: account.currency,
      timezone: account.timezone,
      isManagerAccount: account.isManagerAccount,
    })
    setShowEditDialog(true)
  }

  const getStatusBadge = (account: GoogleAdsAccount) => {
    if (!account.isActive) {
      return (
        <Badge variant="secondary" className="flex items-center gap-1 w-fit">
          <XCircle className="w-3 h-3" />
          已停用
        </Badge>
      )
    }

    if (!account.hasToken) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1 w-fit">
          <Key className="w-3 h-3" />
          未授权
        </Badge>
      )
    }

    const isExpired = account.tokenExpiresAt && new Date(account.tokenExpiresAt) < new Date()
    if (isExpired) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1 w-fit">
          <Clock className="w-3 h-3" />
          凭证过期
        </Badge>
      )
    }

    return (
      <Badge
        variant="default"
        className="bg-green-600 hover:bg-green-700 flex items-center gap-1 w-fit"
      >
        <CheckCircle2 className="w-3 h-3" />
        正常
      </Badge>
    )
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
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
              <h1 className="text-2xl font-bold text-gray-900">Google Ads账号管理</h1>
              <Badge variant="secondary" className="text-sm">
                {accounts.length} 个账号
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={fetchAccounts}>
                <RefreshCw className="w-4 h-4 mr-1" />
                刷新
              </Button>
              <Button onClick={() => setShowAddDialog(true)} className="flex items-center gap-2">
                <Plus className="w-4 h-4" />
                添加账号
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {accounts.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center py-12">
              <Key className="w-12 h-12 mx-auto mb-4 opacity-50 text-gray-400" />
              <p className="text-gray-500 mb-4">暂无Google Ads账号</p>
              <Button onClick={() => setShowAddDialog(true)} variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                添加第一个账号
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="overflow-x-auto">
                <Table className="[&_thead_th]:bg-white">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer ID</TableHead>
                      <TableHead>账号名称</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>货币/时区</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>最后同步</TableHead>
                      <TableHead>创建时间</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((account) => (
                      <TableRow key={account.id}>
                        <TableCell className="font-mono text-sm">{account.customerId}</TableCell>
                        <TableCell>
                          {account.accountName || <span className="text-gray-400">未命名</span>}
                        </TableCell>
                        <TableCell>
                          {account.isManagerAccount ? (
                            <Badge variant="secondary">管理账号</Badge>
                          ) : (
                            <Badge variant="outline">普通账号</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {account.currency} / {account.timezone}
                        </TableCell>
                        <TableCell>{getStatusBadge(account)}</TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {formatDate(account.lastSyncAt)}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {formatDate(account.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(account)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleActive(account)}
                            >
                              {account.isActive ? '停用' : '激活'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openDeleteDialog(account)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Add Account Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>添加Google Ads账号</DialogTitle>
            <DialogDescription>输入您的Google Ads账号信息进行绑定</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="customerId">Customer ID *</Label>
              <Input
                id="customerId"
                placeholder="123-456-7890"
                value={formData.customerId}
                onChange={(e) => setFormData({ ...formData, customerId: e.target.value })}
              />
              <p className="text-xs text-gray-500">10位数字的Google Ads客户ID</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="accountName">账号名称</Label>
              <Input
                id="accountName"
                placeholder="My Google Ads Account"
                value={formData.accountName}
                onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="currency">货币</Label>
                <Select
                  value={formData.currency}
                  onValueChange={(value) => setFormData({ ...formData, currency: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD - 美元</SelectItem>
                    <SelectItem value="CNY">CNY - 人民币</SelectItem>
                    <SelectItem value="EUR">EUR - 欧元</SelectItem>
                    <SelectItem value="GBP">GBP - 英镑</SelectItem>
                    <SelectItem value="JPY">JPY - 日元</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="timezone">时区</Label>
                <Select
                  value={formData.timezone}
                  onValueChange={(value) => setFormData({ ...formData, timezone: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/New_York">美东时间</SelectItem>
                    <SelectItem value="America/Los_Angeles">美西时间</SelectItem>
                    <SelectItem value="Asia/Shanghai">北京时间</SelectItem>
                    <SelectItem value="Europe/London">伦敦时间</SelectItem>
                    <SelectItem value="Asia/Tokyo">东京时间</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              取消
            </Button>
            <Button onClick={handleAdd} disabled={!formData.customerId}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          if (!open) closeDeleteDialog()
          else setShowDeleteDialog(true)
        }}
      >
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
              确认删除 Google Ads 账号
            </DialogTitle>
            <DialogDescription>
              {deletingAccount
                ? `将删除账号 ${deletingAccount.accountName || deletingAccount.customerId}。本地会软删该账号下全部广告系列，并按 Offer 暂停补点击/换链任务。${
                    loadingDeletableCount
                      ? '正在统计可远端删除的广告系列…'
                      : deletableRemoteCampaignCount !== null
                        ? `当前有 ${deletableRemoteCampaignCount} 个已同步、可远端删除的广告系列。${
                            remoteDeleteWillTruncate && remoteDeleteMaxCampaigns
                              ? `单次远端最多处理 ${remoteDeleteMaxCampaigns} 个，超出部分仅本地删除。`
                              : ''
                          }`
                        : ''
                  }`
                : '确认删除该账号？'}
            </DialogDescription>
          </DialogHeader>

          <Alert className="bg-orange-50 border-orange-200">
            <AlertTriangle className="h-4 w-4 text-orange-600" />
            <AlertDescription className="text-orange-900">
              <div className="mt-3 flex items-start gap-3 rounded-md border border-orange-200 bg-white p-3">
                <Checkbox
                  id="delete-account-remove-ads"
                  checked={removeGoogleAdsCampaignsOnDelete}
                  onCheckedChange={(checked) =>
                    setRemoveGoogleAdsCampaignsOnDelete(checked === true)
                  }
                  disabled={deletableRemoteCampaignCount === 0}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <Label
                    htmlFor="delete-account-remove-ads"
                    className="text-sm font-medium cursor-pointer text-orange-900"
                  >
                    同时在 Google Ads 远端删除该账号下已同步的广告系列（不可恢复）
                  </Label>
                  <p className="text-xs text-orange-700 mt-1">
                    {deletableRemoteCampaignCount === 0
                      ? '该账号下没有可远端删除的已同步广告系列。'
                      : '勾选后将先删除远端广告系列再删本地（可能耗时），结果会在完成后展示；失败项会尝试降级为暂停。'}
                  </p>
                </div>
              </div>
            </AlertDescription>
          </Alert>

          {deleteFeedback && (
            <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
              <div className="font-medium text-gray-900">
                {deleteFeedback.localDeleted ? '删除结果' : '删除未完成'}
              </div>
              {deleteFeedback.googleAds && removeGoogleAdsCampaignsOnDelete && (
                <p className="text-gray-700">
                  远端：计划 {deleteFeedback.googleAds.planned}，成功删除{' '}
                  {deleteFeedback.googleAds.removed}， 降级暂停{' '}
                  {deleteFeedback.googleAds.pausedFallback}，失败 {deleteFeedback.googleAds.failed}
                  {deleteFeedback.googleAds.truncated > 0
                    ? `；另有 ${deleteFeedback.googleAds.truncated} 个仅本地删除`
                    : ''}
                  {deleteFeedback.googleAds.timedOut ? '（已触发整体超时）' : ''}
                </p>
              )}
              {deleteFeedback.warnings && deleteFeedback.warnings.length > 0 && (
                <ul className="list-disc list-inside text-amber-800 space-y-1">
                  {deleteFeedback.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              {(deleteFeedback.googleAds?.failures?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-2">失败明细（failures）</p>
                  <div className="max-h-48 overflow-y-auto rounded border border-gray-200 bg-white">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-100 sticky top-0">
                        <tr>
                          <th className="text-left p-2 font-medium">Campaign ID</th>
                          <th className="text-left p-2 font-medium">原因</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deleteFeedback.googleAds!.failures.map((item) => (
                          <tr
                            key={`${item.campaignId}-${item.reason}`}
                            className="border-t border-gray-100"
                          >
                            <td className="p-2 align-top font-mono">{item.campaignId}</td>
                            <td className="p-2 align-top text-red-700 break-all">{item.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {deleteFeedback ? (
              <Button onClick={closeDeleteDialog}>关闭</Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeDeleteDialog} disabled={deleting}>
                  取消
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? '删除中...' : '确认删除'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Account Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>编辑账号信息</DialogTitle>
            <DialogDescription>更新您的Google Ads账号配置</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Customer ID</Label>
              <Input value={formData.customerId} disabled className="bg-gray-100" />
              <p className="text-xs text-gray-500">Customer ID不可修改</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-accountName">账号名称</Label>
              <Input
                id="edit-accountName"
                placeholder="My Google Ads Account"
                value={formData.accountName}
                onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-currency">货币</Label>
                <Select
                  value={formData.currency}
                  onValueChange={(value) => setFormData({ ...formData, currency: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD - 美元</SelectItem>
                    <SelectItem value="CNY">CNY - 人民币</SelectItem>
                    <SelectItem value="EUR">EUR - 欧元</SelectItem>
                    <SelectItem value="GBP">GBP - 英镑</SelectItem>
                    <SelectItem value="JPY">JPY - 日元</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-timezone">时区</Label>
                <Select
                  value={formData.timezone}
                  onValueChange={(value) => setFormData({ ...formData, timezone: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/New_York">美东时间</SelectItem>
                    <SelectItem value="America/Los_Angeles">美西时间</SelectItem>
                    <SelectItem value="Asia/Shanghai">北京时间</SelectItem>
                    <SelectItem value="Europe/London">伦敦时间</SelectItem>
                    <SelectItem value="Asia/Tokyo">东京时间</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              取消
            </Button>
            <Button onClick={handleEdit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
