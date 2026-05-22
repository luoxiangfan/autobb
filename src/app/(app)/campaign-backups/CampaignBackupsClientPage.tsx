'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
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
import {
  BatchProgressIndicator,
  type BatchProgressErrorDetail,
} from '@/components/BatchProgressIndicator'

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
  const [loading, setLoading] = useState(true)
  const [backups, setBackups] = useState<CampaignBackup[]>([])
  const [selectedBackupIds, setSelectedBackupIds] = useState<number[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [backupSource, setBackupSource] = useState<string>('all')
  
  // 批量创建对话框
  const [isBatchCreateOpen, setIsBatchCreateOpen] = useState(false)
  const [googleAdsAccounts, setGoogleAdsAccounts] = useState<Array<{
    id: number
    customerId: string
    accountName: string | null
  }>>([])
  const [selectedGoogleAdsAccountId, setSelectedGoogleAdsAccountId] = useState<number | null>(null)
  
  // 🔧 重新生成广告创意选项 - 每条记录独立选择
  const [regenerateCreativeMap, setRegenerateCreativeMap] = useState<Map<number, boolean>>(new Map())
  
  // 🔥 异步批量创建状态
  const [showProgressDialog, setShowProgressDialog] = useState(false)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [batchStatus, setBatchStatus] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState(0)
  const [batchTotalCount, setBatchTotalCount] = useState(0)
  const [batchCompletedCount, setBatchCompletedCount] = useState(0)
  const [batchFailedCount, setBatchFailedCount] = useState(0)
  const [isBatchProcessing, setIsBatchProcessing] = useState(false)
  const [batchErrorDetails, setBatchErrorDetails] = useState<BatchProgressErrorDetail[]>([])
  const [batchWarningDetails, setBatchWarningDetails] = useState<
    Array<{ backupId: number; message: string }>
  >([])
  
  // 分页状态
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sseAbortRef = useRef<AbortController | null>(null)
  const batchFinalizeKeyRef = useRef<string | null>(null)
  const [selectedBackupMeta, setSelectedBackupMeta] = useState<
    Map<
      number,
      {
        offerId: number
        hasConfig: boolean
        campaignName: string
        adCreativeId: number | null
      }
    >
  >(new Map())

  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearPolling()
      sseAbortRef.current?.abort()
    }
  }, [clearPolling])

  useEffect(() => {
    setCurrentPage(1)
    setSelectedBackupIds([])
    setSelectedBackupMeta(new Map())
  }, [startDate, endDate, backupSource])

  useEffect(() => {
    fetchBackups()
    fetchGoogleAdsAccounts()
  }, [startDate, endDate, backupSource, currentPage, pageSize])

  const fetchGoogleAdsAccounts = async () => {
    try {
      // 🔧 添加 filterByUserMcc=true，只获取用户 MCC 下的 Google Ads 账号（非 MCC 账号）
      const response = await fetch('/api/google-ads-accounts?filterByUserMcc=true', {
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

  const backupHasConfig = (config: unknown): boolean => {
    if (config == null) return false
    if (typeof config === 'string') {
      const trimmed = config.trim()
      if (!trimmed) return false
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>
        return typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0
      } catch {
        return false
      }
    }
    return typeof config === 'object' && Object.keys(config as object).length > 0
  }

  const selectableBackups = backups.filter((b) => backupHasConfig(b.campaign_config))

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const nextMeta = new Map(selectedBackupMeta)
      const ids: number[] = []
      for (const backup of selectableBackups) {
        ids.push(backup.id)
        nextMeta.set(backup.id, {
          offerId: backup.offer_id,
          hasConfig: true,
          campaignName: backup.campaign_name,
          adCreativeId: backup.ad_creative_id,
        })
      }
      setSelectedBackupMeta(nextMeta)
      setSelectedBackupIds([...new Set([...selectedBackupIds, ...ids])])
    } else {
      const pageIds = new Set(backups.map((b) => b.id))
      setSelectedBackupIds(selectedBackupIds.filter((id) => !pageIds.has(id)))
      setSelectedBackupMeta((prev) => {
        const next = new Map(prev)
        for (const id of pageIds) {
          next.delete(id)
        }
        return next
      })
    }
  }

  const handleSelectBackup = (checked: boolean, backup: CampaignBackup) => {
    if (!backupHasConfig(backup.campaign_config)) {
      return
    }
    if (checked) {
      setSelectedBackupIds([...new Set([...selectedBackupIds, backup.id])])
      setSelectedBackupMeta((prev) => {
        const next = new Map(prev)
        next.set(backup.id, {
          offerId: backup.offer_id,
          hasConfig: true,
          campaignName: backup.campaign_name,
          adCreativeId: backup.ad_creative_id,
        })
        return next
      })
    } else {
      setSelectedBackupIds(selectedBackupIds.filter((id) => id !== backup.id))
      setSelectedBackupMeta((prev) => {
        const next = new Map(prev)
        next.delete(backup.id)
        return next
      })
    }
  }

  const validateBatchSelection = (): string | null => {
    const offerToIds = new Map<number, number[]>()
    for (const backupId of selectedBackupIds) {
      const meta = selectedBackupMeta.get(backupId)
      if (!meta) {
        return `备份 #${backupId} 不在当前列表中，请取消选择后重试`
      }
      const ids = offerToIds.get(meta.offerId) ?? []
      ids.push(backupId)
      offerToIds.set(meta.offerId, ids)
    }
    const duplicateOffers = [...offerToIds.entries()].filter(([, ids]) => ids.length > 1)
    if (duplicateOffers.length > 0) {
      const detail = duplicateOffers
        .map(([offerId, ids]) => `Offer ${offerId}（备份 ${ids.join(', ')}）`)
        .join('；')
      return `同一 Offer 不能选择多条备份：${detail}`
    }
    const missingConfig = selectedBackupIds.filter(
      (id) => selectedBackupMeta.get(id)?.hasConfig === false
    )
    if (missingConfig.length > 0) {
      const names = missingConfig
        .map((id) => {
          const meta = selectedBackupMeta.get(id)
          return `${meta?.campaignName || '备份'} (#${id})`
        })
        .join('、')
      return `以下备份缺少广告系列配置：${names}`
    }
    return null
  }

  const extractBatchErrors = (metadata: unknown): BatchProgressErrorDetail[] => {
    if (!metadata || typeof metadata !== 'object') return []
    const errors = (metadata as { errors?: Array<{ backupId: number; error: string }> }).errors
    if (!Array.isArray(errors)) return []
    return errors
      .filter((e) => typeof e.backupId === 'number' && typeof e.error === 'string')
      .map((e) => ({ backupId: e.backupId, error: e.error }))
  }

  const extractBatchWarnings = (
    metadata: unknown
  ): Array<{ backupId: number; message: string }> => {
    if (!metadata || typeof metadata !== 'object') return []
    const warnings = (metadata as { warnings?: Array<{ backupId: number; message: string }> })
      .warnings
    if (!Array.isArray(warnings)) return []
    return warnings.filter(
      (w) => typeof w.backupId === 'number' && typeof w.message === 'string'
    )
  }

  const applyBatchStatusFromApi = (data: {
    status: string
    completed: number
    failed: number
    progress: number
    metadata?: unknown
  }) => {
    setBatchStatus(data.status)
    setBatchCompletedCount(data.completed)
    setBatchFailedCount(data.failed)
    setBatchProgress(data.progress)
    setBatchErrorDetails(extractBatchErrors(data.metadata))
    setBatchWarningDetails(extractBatchWarnings(data.metadata))
  }

  const handleOpenBatchCreateDialog = () => {
    // 🔧 初始化每条记录的选择状态
    const newMap = new Map<number, boolean>()
    selectedBackupIds.forEach((id) => {
      const backup = backups.find((b) => b.id === id)
      const meta = selectedBackupMeta.get(id)
      const adCreativeId = backup?.ad_creative_id ?? meta?.adCreativeId
      const offerId = backup?.offer_id ?? meta?.offerId
      if (adCreativeId && offerId) {
        newMap.set(id, false)
      }
    })
    setRegenerateCreativeMap(newMap)
    setIsBatchCreateOpen(true)
  }

  const handleBatchCreate = async () => {
    if (selectedBackupIds.length === 0) {
      toast.error('请选择至少一个备份')
      return
    }

    if (!selectedGoogleAdsAccountId) {
      toast.error('请选择 Google Ads 账号')
      return
    }

    const validationError = validateBatchSelection()
    if (validationError) {
      toast.error('无法批量创建', { description: validationError })
      return
    }

    setIsBatchProcessing(true)
    setBatchErrorDetails([])
    setBatchWarningDetails([])
    try {
      // 调用新的异步 API
      const response = await fetch('/api/campaign-backups/batch-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          backupIds: selectedBackupIds,
          googleAdsAccountId: selectedGoogleAdsAccountId,
          regenerateCreativeMap: Object.fromEntries(regenerateCreativeMap),
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '批量创建失败')
      }

      const result = await response.json()
      
      // 设置任务状态
      setBatchId(result.batchId)
      batchFinalizeKeyRef.current = null
      setBatchTotalCount(result.total_count)
      setBatchCompletedCount(0)
      setBatchFailedCount(0)
      setBatchProgress(0)
      setBatchStatus('pending')
      setShowProgressDialog(true)
      
      // 关闭选择对话框
      setIsBatchCreateOpen(false)
      
      toast.success('批量创建任务已启动', {
        description: '任务正在后台执行，请查看进度对话框',
        duration: 5000,
      })

      // 订阅 SSE 进度
      subscribeToProgress(result.batchId)
      
    } catch (error: any) {
      console.error('批量创建失败:', error)
      toast.error('批量创建失败', { description: error.message })
      setIsBatchProcessing(false)
    }
  }

  const finalizeBatchFromStatus = async (bid: string) => {
    try {
      const response = await fetch(`/api/campaign-backups/batch-create/status/${bid}`, {
        credentials: 'include',
      })
      if (!response.ok) return

      const data = await response.json()
      applyBatchStatusFromApi(data)

      if (['completed', 'partial', 'failed'].includes(data.status)) {
        setIsBatchProcessing(false)
        handleBatchComplete(data.status, data.completed, data.failed, data.metadata)
      }
    } catch (err) {
      console.error('Failed to finalize batch status:', err)
    }
  }

  // 订阅 SSE 进度
  const subscribeToProgress = async (bid: string) => {
    sseAbortRef.current?.abort()
    const abortController = new AbortController()
    sseAbortRef.current = abortController

    try {
      const response = await fetch(`/api/campaign-backups/batch-create/stream/${bid}`, {
        credentials: 'include',
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      if (!response.body) {
        throw new Error('Response body is null')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          console.log('✅ SSE stream completed')
          await finalizeBatchFromStatus(bid)
          break
        }

        buffer += decoder.decode(value, { stream: true })

        // 处理完整消息（由\n\n分隔）
        const messages = buffer.split('\n\n')
        buffer = messages.pop() || ''

        for (const message of messages) {
          if (!message.trim() || !message.startsWith('data: ')) continue

          try {
            const jsonStr = message.substring(6)
            const data = JSON.parse(jsonStr)

            console.log('📨 SSE Message:', data)

            if (data.type === 'progress') {
              applyBatchStatusFromApi({
                status: data.status,
                completed: data.completed,
                failed: data.failed,
                progress: data.progress,
                metadata: data.metadata,
              })
            } else if (data.type === 'complete') {
              applyBatchStatusFromApi({
                status: data.status,
                completed: data.completed,
                failed: data.failed,
                progress: 100,
                metadata: data.metadata,
              })
              setIsBatchProcessing(false)
              handleBatchComplete(data.status, data.completed, data.failed, data.metadata)
              return
            } else if (data.type === 'error') {
              setBatchStatus('failed')
              setIsBatchProcessing(false)
              toast.error('批量创建任务出错', {
                description: data.error?.message || '未知错误',
              })
              return
            }
          } catch (parseError) {
            console.error('Failed to parse SSE message:', parseError, message)
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error('SSE subscription failed, falling back to polling:', err)
      startPolling(bid)
    }
  }

  const startPolling = (bid: string) => {
    clearPolling()
    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/campaign-backups/batch-create/status/${bid}`, {
          credentials: 'include',
        })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json()
        applyBatchStatusFromApi(data)

        if (data.status === 'completed' || data.status === 'partial' || data.status === 'failed') {
          clearPolling()
          setIsBatchProcessing(false)
          handleBatchComplete(data.status, data.completed, data.failed, data.metadata)
        }
      } catch (err) {
        console.error('Polling error:', err)
      }
    }, 2000)
  }

  const handleBatchComplete = (
    status: string,
    completed: number,
    failed: number,
    metadata?: unknown
  ) => {
    const finalizeKey = `${batchId ?? 'unknown'}:${status}:${completed}:${failed}`
    if (batchFinalizeKeyRef.current === finalizeKey) {
      return
    }
    batchFinalizeKeyRef.current = finalizeKey

    const errors = extractBatchErrors(metadata)
    const warnings = extractBatchWarnings(metadata)
    setBatchErrorDetails(errors)
    setBatchWarningDetails(warnings)

    const message = status === 'completed'
      ? `已成功创建 ${completed} 个广告系列，发布任务已入队`
      : status === 'partial'
      ? `部分完成：入队成功 ${completed} 个，失败 ${failed} 个`
      : `批量创建失败`

    if (status === 'failed') {
      toast.error(message, { duration: 10000 })
    } else if (status === 'partial') {
      toast.warning(message, { duration: 10000 })
    } else {
      toast.success(message, { duration: 10000 })
    }

    if (warnings.length > 0) {
      const preview = warnings
        .slice(0, 3)
        .map((w) => `备份 #${w.backupId}：${w.message}`)
        .join('\n')
      toast.warning(
        warnings.length === 1 ? '部分项有警告' : `${warnings.length} 项有警告`,
        {
          description:
            preview + (warnings.length > 3 ? `\n…另有 ${warnings.length - 3} 项` : ''),
          duration: 12000,
        }
      )
    }

    // 刷新列表
    fetchBackups()
    
    // 清空选择
    setSelectedBackupIds([])
    setSelectedBackupMeta(new Map())
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  const pageSelectedCount = backups.filter((b) => selectedBackupIds.includes(b.id)).length
  const allSelected =
    selectableBackups.length > 0 && pageSelectedCount === selectableBackups.length
  const someSelected = pageSelectedCount > 0 && !allSelected

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
                  onClick={handleOpenBatchCreateDialog}
                  disabled={isBatchProcessing || selectedBackupIds.length === 0}
                >
                  {isBatchProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      创建中...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4 mr-2" />
                      批量创建 ({selectedBackupIds.length})
                    </>
                  )}
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
              <div className='flex items-center gap-x-2 whitespace-nowrap'>
                <Label>开始日期</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className='flex items-center gap-x-2 whitespace-nowrap'>
                <Label>结束日期</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-x-2">
                <Label>备份来源</Label>
                <Select value={backupSource} onValueChange={setBackupSource}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="autoads">AutoAds</SelectItem>
                    <SelectItem value="google_ads">Google Ads</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setStartDate('')
                    setEndDate('')
                    setBackupSource('all')
                    setSelectedBackupIds([])
                    setSelectedBackupMeta(new Map())
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
            <span className="text-xs text-gray-400">可跨页选择，筛选变更会清空已选</span>
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
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead>广告系列名称</TableHead>
                  <TableHead>Offer</TableHead>
                  <TableHead>来源</TableHead>
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
                  backups.map((backup) => {
                    const canSelect = backupHasConfig(backup.campaign_config)
                    return (
                    <TableRow
                      key={backup.id}
                      className={canSelect ? undefined : 'opacity-60'}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedBackupIds.includes(backup.id)}
                          disabled={!canSelect}
                          onCheckedChange={(checked) =>
                            handleSelectBackup(checked as boolean, backup)
                          }
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
                        <Badge variant="outline" className="text-xs">
                          {backup.backup_source === 'google_ads' ? 'Google Ads' : 'AutoAds'}
                        </Badge>
                        {backup.backup_version > 1 && (
                          <span className="text-xs text-gray-500 ml-1">v{backup.backup_version}</span>
                        )}
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
                            disabled={!canSelect}
                            title={canSelect ? '从该备份创建' : '缺少 campaign_config，无法恢复'}
                            onClick={() => {
                              setSelectedBackupIds([backup.id])
                              setSelectedBackupMeta(
                                new Map([
                                  [
                                    backup.id,
                                    {
                                      offerId: backup.offer_id,
                                      hasConfig: true,
                                      campaignName: backup.campaign_name,
                                      adCreativeId: backup.ad_creative_id,
                                    },
                                  ],
                                ])
                              )
                              handleOpenBatchCreateDialog()
                            }}
                          >
                            <RotateCcw className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )})
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
                <Label className="text-sm whitespace-nowrap">每页显示</Label>
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
                  <li>将发布任务加入队列，同步到 Google Ads</li>
                </ol>
              </div>
            </Alert>

            {/* 🔧 显示每条记录的选择状态 */}
            <div className="space-y-2 max-h-60 overflow-y-auto">
              <Label className="text-sm font-medium">重新生成广告创意设置</Label>
              {selectedBackupIds.length === 0 ? (
                <p className="text-xs text-gray-500">请选择要创建的备份</p>
              ) : (
                selectedBackupIds.map(id => {
                  const backup = backups.find(b => b.id === id)
                  const meta = selectedBackupMeta.get(id)
                  const canRegenerate =
                    (backup?.ad_creative_id ?? meta?.adCreativeId) &&
                    (backup?.offer_id ?? meta?.offerId)
                  const shouldRegenerate = regenerateCreativeMap.get(id) || false
                  
                  return (
                    <div key={id} className={`flex items-center justify-between p-2 rounded-md border ${
                      canRegenerate ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100'
                    }`}>
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {backup?.campaign_name || meta?.campaignName || `备份 #${id}`}
                        </div>
                        <div className="text-xs text-gray-500">
                          {canRegenerate ? (
                            <span>✅ 支持重新生成</span>
                          ) : (
                            <span>ℹ️ 不支持（缺少 ad_creative_id 或 offer_id）</span>
                          )}
                        </div>
                      </div>
                      {canRegenerate ? (
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`dialog-regenerate-${id}`}
                            checked={shouldRegenerate}
                            onCheckedChange={(checked) => {
                              const newMap = new Map(regenerateCreativeMap)
                              newMap.set(id, checked)
                              setRegenerateCreativeMap(newMap)
                            }}
                            disabled={isBatchProcessing}
                          />
                          <Label htmlFor={`dialog-regenerate-${id}`} className="text-xs cursor-pointer">
                            {shouldRegenerate ? '🤖 重新生成' : '📦 使用备份'}
                          </Label>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">📦 使用备份</span>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {isBatchProcessing && (
              <Alert className="bg-yellow-50 border-yellow-200">
                <div className="text-sm text-yellow-900">
                  ⚠️ 当前有批量创建任务正在进行中，请等待完成后再操作
                </div>
              </Alert>
            )}

            <Alert className="bg-blue-50 border-blue-200">
              <div className="text-sm text-blue-900">
                <strong>💡 说明：</strong>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>开启"重新生成"：使用 AI 基于 Offer 重新生成广告创意，成功后使用新创意发布</li>
                  <li>关闭"重新生成"：直接使用备份中的广告创意数据发布</li>
                  <li>不支持的备份：缺少 ad_creative_id 或 offer_id，只能使用备份数据</li>
                </ul>
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
                    {account.accountName || account.customerId}
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
              onClick={() => setIsBatchCreateOpen(false)}
              disabled={isBatchProcessing}
            >
              取消
            </Button>
            <Button 
              onClick={handleBatchCreate} 
              disabled={isBatchProcessing || selectedBackupIds.length === 0 || !selectedGoogleAdsAccountId}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isBatchProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  提交中...
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  开始创建
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 🔥 进度指示器 */}
      <BatchProgressIndicator
        open={showProgressDialog}
        onOpenChange={setShowProgressDialog}
        batchId={batchId}
        status={batchStatus}
        progress={batchProgress}
        totalCount={batchTotalCount}
        completedCount={batchCompletedCount}
        failedCount={batchFailedCount}
        errorDetails={batchErrorDetails}
        warningDetails={batchWarningDetails}
      />
    </div>
  )
}
