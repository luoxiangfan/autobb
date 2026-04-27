'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Package, Calendar, RotateCcw, Loader2, ExternalLink, FileText, CheckCircle2, XCircle } from 'lucide-react'

interface CampaignBackup {
  id: number
  user_id: number
  offer_id: number
  ad_creative_id: number | null
  campaign_data: any
  campaign_config: any
  backup_type: string
  backup_source: string
  backup_version: number
  custom_name: string | null
  campaign_name: string
  budget_amount: number
  budget_type: string
  created_at: string
  updated_at: string
  offer_name?: string
  brand?: string
  creative_name?: string
}

export default function CampaignBackupsClientPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [backups, setBackups] = useState<CampaignBackup[]>([])
  const [selectedBackupIds, setSelectedBackupIds] = useState<number[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [backupSource, setBackupSource] = useState<string>('all')
  
  // 批量创建对话框
  const [isBatchCreateOpen, setIsBatchCreateOpen] = useState(false)
  const [batchCreating, setBatchCreating] = useState(false)
  const [createToGoogle, setCreateToGoogle] = useState(true)
  const [googleAdsAccounts, setGoogleAdsAccounts] = useState<Array<{
    id: number
    customer_id: string
    account_name: string | null
  }>>([])
  const [selectedGoogleAdsAccountId, setSelectedGoogleAdsAccountId] = useState<number | null>(null)
  
  // 分页状态
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    fetchBackups()
    fetchGoogleAdsAccounts()
  }, [startDate, endDate, backupSource, currentPage, pageSize])

  const fetchGoogleAdsAccounts = async () => {
    try {
      const response = await fetch('/api/google-ads-accounts', {
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json()
        setGoogleAdsAccounts(data.accounts || [])
      }
    } catch (error: any) {
      console.error('获取 Google Ads 账号失败:', error)
    }
  }

  const fetchBackups = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      if (backupSource !== 'all') params.set('backupSource', backupSource)
      params.set('limit', pageSize.toString())
      params.set('offset', ((currentPage - 1) * pageSize).toString())

      const response = await fetch(`/api/campaign-backups?${params.toString()}`, {
        credentials: 'include',
      })

      if (!response.ok) throw new Error('获取数据失败')

      const data = await response.json()
      setBackups(data.backups || [])
      setTotal(data.total || 0)
    } catch (error: any) {
      console.error('获取备份列表失败:', error)
      toast.error('获取数据失败', { description: error.message })
    } finally {
      setLoading(false)
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedBackupIds(backups.map(b => b.id))
    } else {
      setSelectedBackupIds([])
    }
  }

  const handleSelectBackup = (checked: boolean, backupId: number) => {
    if (checked) {
      setSelectedBackupIds([...new Set([...selectedBackupIds, backupId])])
    } else {
      setSelectedBackupIds(selectedBackupIds.filter(id => id !== backupId))
    }
  }

  const handleBatchCreate = async () => {
    if (selectedBackupIds.length === 0) {
      toast.error('请选择至少一个备份')
      return
    }

    setBatchCreating(true)
    try {
      const response = await fetch('/api/campaign-backups/create-from-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          backupIds: selectedBackupIds,
          createToGoogle,
          googleAdsAccountId: selectedGoogleAdsAccountId || undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '批量创建失败')
      }

      const result = await response.json()
      toast.success(result.message)
      
      // 刷新列表
      fetchBackups()
      setSelectedBackupIds([])
      setIsBatchCreateOpen(false)
    } catch (error: any) {
      console.error('批量创建失败:', error)
      toast.error('批量创建失败', { description: error.message })
    } finally {
      setBatchCreating(false)
    }
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  const allSelected = backups.length > 0 && selectedBackupIds.length === backups.length
  const someSelected = selectedBackupIds.length > 0 && !allSelected

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">广告系列备份</h1>
              <p className="text-sm text-gray-500 mt-1">
                管理广告系列备份，支持批量重新创建广告系列
              </p>
            </div>
            <div className="flex items-center gap-3">
              {selectedBackupIds.length > 0 && (
                <Button
                  variant="default"
                  onClick={() => setIsBatchCreateOpen(true)}
                  disabled={batchCreating}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  批量创建 ({selectedBackupIds.length})
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 筛选器 */}
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label>开始日期</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <Label>结束日期</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setStartDate('')
                    setEndDate('')
                    setBackupSource('all')
                    setSelectedBackupIds([])
                    setCurrentPage(1)
                    setPageSize(20)
                  }}
                >
                  重置筛选
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 统计信息 */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Package className="w-4 h-4" />
            <span>共 {total} 条记录，第 {currentPage} 页，共 {Math.ceil(total / pageSize) || 1} 页</span>
            {selectedBackupIds.length > 0 && (
              <Badge variant="secondary">已选择 {selectedBackupIds.length} 个</Badge>
            )}
          </div>
        </div>

        {/* 表格 */}
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead>广告系列名称</TableHead>
                  <TableHead>Offer</TableHead>
                  <TableHead>预算</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto" />
                      <p className="text-sm text-gray-500 mt-2">加载中...</p>
                    </TableCell>
                  </TableRow>
                ) : backups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12">
                      <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="text-gray-500">暂无备份</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  backups.map((backup) => (
                    <TableRow key={backup.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedBackupIds.includes(backup.id)}
                          onCheckedChange={(checked) => handleSelectBackup(checked as boolean, backup.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{backup.campaign_name}</div>
                        {backup.custom_name && (
                          <div className="text-xs text-gray-500">{backup.custom_name}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="text-sm">{backup.offer_name || backup.brand || '-'}</div>
                          <div className="text-xs text-gray-500">ID: {backup.offer_id}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          ${backup.budget_amount}
                        </div>
                        <div className="text-xs text-gray-500">
                          {backup.budget_type}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <Calendar className="w-3 h-3 inline mr-1" />
                          {formatDate(backup.created_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <Calendar className="w-3 h-3 inline mr-1" />
                          {formatDate(backup.updated_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedBackupIds([backup.id])
                              setIsBatchCreateOpen(true)
                            }}
                          >
                            <RotateCcw className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* 分页 */}
        {total > 0 && (
          <div className="flex items-center justify-between mt-6">
            <div className="text-sm text-gray-600">
              显示 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, total)} 条，共 {total} 条
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label className="text-sm">每页显示</Label>
                <Select value={pageSize.toString()} onValueChange={(value) => {
                  setPageSize(Number(value))
                  setCurrentPage(1)
                }}>
                  <SelectTrigger className="w-[100px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 条</SelectItem>
                    <SelectItem value="20">20 条</SelectItem>
                    <SelectItem value="50">50 条</SelectItem>
                    <SelectItem value="100">100 条</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                >
                  首页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(currentPage + 1)}
                  disabled={currentPage >= Math.ceil(total / pageSize)}
                >
                  下一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.ceil(total / pageSize))}
                  disabled={currentPage >= Math.ceil(total / pageSize)}
                >
                  末页
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 批量创建对话框 */}
      <Dialog open={isBatchCreateOpen} onOpenChange={setIsBatchCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>批量创建广告系列</DialogTitle>
            <DialogDescription>
              为选中的 {selectedBackupIds.length} 个备份批量创建广告系列
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Alert className="bg-blue-50 border-blue-200">
              <div className="text-sm text-blue-900">
                <strong>📋 创建步骤：</strong>
                <ol className="list-decimal list-inside mt-2 space-y-1">
                  <li>在数据库中创建广告系列</li>
                  <li>发布到 Google Ads</li>
                </ol>
              </div>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="googleAdsAccount">选择 Google Ads 账号</Label>
              <select
                id="googleAdsAccount"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedGoogleAdsAccountId || ''}
                onChange={(e) => setSelectedGoogleAdsAccountId(Number(e.target.value))}
              >
                <option value="">请选择账号</option>
                {googleAdsAccounts.map(account => (
                  <option key={account.id} value={account.id}>
                    {account.account_name || account.customer_id}
                  </option>
                ))}
              </select>
              {googleAdsAccounts.length === 0 && (
                <p className="text-xs text-gray-500">
                  暂无可用的 Google Ads 账号，请先创建账号
                </p>
              )}
            </div>

            {selectedBackupIds.length > 10 && (
              <Alert variant="destructive">
                <div className="text-sm">
                  ⚠️ 选中项目较多（{selectedBackupIds.length}个），建议分批操作（每批 10 个以内）
                </div>
              </Alert>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setIsBatchCreateOpen(false)
                setSelectedBackupIds([])
              }} 
              disabled={batchCreating}
            >
              取消
            </Button>
            <Button 
              onClick={handleBatchCreate} 
              disabled={batchCreating || selectedBackupIds.length === 0 || (createToGoogle && !selectedGoogleAdsAccountId)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {batchCreating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  创建中...
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  批量创建
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
