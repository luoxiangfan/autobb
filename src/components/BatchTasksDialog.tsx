'use client'

import { useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'
import { toast } from 'sonner'
import { Loader2, PlayCircle } from 'lucide-react'

function countDedupedPositiveIds(ids?: number[]): number {
  if (!ids?.length) return 0
  return new Set(
    ids
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
  ).size
}

interface BatchTasksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  campaignIds?: number[]  // 广告系列页面使用
  offerIds?: number[]     // Offer 页面使用
  onSuccess?: () => void
}

export default function BatchTasksDialog({
  open,
  onOpenChange,
  campaignIds,
  offerIds,
  onSuccess,
}: BatchTasksDialogProps) {
  const [loading, setLoading] = useState(false)
  const [enableClickFarm, setEnableClickFarm] = useState(true)
  const [enableUrlSwap, setEnableUrlSwap] = useState(true)

  const isCampaignMode = !!campaignIds
  const selectionIdCount = useMemo(
    () =>
      isCampaignMode
        ? countDedupedPositiveIds(campaignIds)
        : countDedupedPositiveIds(offerIds),
    [isCampaignMode, campaignIds, offerIds]
  )

  const handleBatchStart = async () => {
    if (!enableClickFarm && !enableUrlSwap) {
      toast.error('请至少选择一种任务类型')
      return
    }

    setLoading(true)
    try {
      const endpoint = isCampaignMode
        ? '/api/campaigns/batch-start-tasks'
        : '/api/offers/batch-start-tasks'

      const clientRequestId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : undefined

      const body = {
        campaignIds: campaignIds || [],
        offerIds: offerIds || [],
        enableClickFarm,
        enableUrlSwap,
        ...(clientRequestId ? { clientRequestId } : {}),
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      const result = await response.json().catch(() => ({}))
      const responseData = result?.data && typeof result.data === 'object' ? result.data : {}
      const errors = Array.isArray(responseData?.errors) ? responseData.errors : []
      const failedItemsByType = responseData?.failedItemsByType && typeof responseData.failedItemsByType === 'object'
        ? responseData.failedItemsByType as { clickFarm?: number; urlSwap?: number; general?: number }
        : {}

      if (!response.ok) {
        const byTypeParts: string[] = []
        if (Number(failedItemsByType.clickFarm || 0) > 0) byTypeParts.push(`补点击 ${Number(failedItemsByType.clickFarm)} 项`)
        if (Number(failedItemsByType.urlSwap || 0) > 0) byTypeParts.push(`换链接 ${Number(failedItemsByType.urlSwap)} 项`)
        if (Number(failedItemsByType.general || 0) > 0) byTypeParts.push(`通用 ${Number(failedItemsByType.general)} 项`)
        const fallback = errors.length > 0
          ? `共 ${errors.length} 条失败记录（按操作项计）${byTypeParts.length > 0 ? `：${byTypeParts.join('，')}` : ''}`
          : '操作失败'
        throw new Error(result?.message || result?.error || fallback)
      }

      const messages: string[] = []
      const clickFarmTasksCreated = Number(responseData?.clickFarmTasksCreated || 0)
      const clickFarmTasksUpdated = Number(responseData?.clickFarmTasksUpdated || 0)
      const urlSwapTasksCreated = Number(responseData?.urlSwapTasksCreated || 0)
      const urlSwapTasksUpdated = Number(responseData?.urlSwapTasksUpdated || 0)
      const requestedIdsCount = Number(
        responseData?.requestedIdsCount ?? selectionIdCount ?? 0
      )
      const matchedOfferCount = Number(
        responseData?.matchedOfferCount ?? responseData?.requestedCount ?? 0
      )
      const failedOfferCount = Number(responseData?.failedOfferCount ?? 0)
      const failedOperationCount = errors.length
      const unmatchedIdsCount = Number(responseData?.unmatchedIdsCount ?? 0)
      const unmatchedHint = unmatchedIdsCount > 0 ? `另有 ${unmatchedIdsCount} 个请求 ID 未命中。` : ''

      if (clickFarmTasksCreated > 0) {
        messages.push(`新建 ${clickFarmTasksCreated} 个补点击`)
      }
      if (clickFarmTasksUpdated > 0) {
        messages.push(`更新 ${clickFarmTasksUpdated} 个补点击`)
      }
      if (urlSwapTasksCreated > 0) {
        messages.push(`新建 ${urlSwapTasksCreated} 个换链接`)
      }
      if (urlSwapTasksUpdated > 0) {
        messages.push(`更新 ${urlSwapTasksUpdated} 个换链接`)
      }

      const succeededCount = (
        clickFarmTasksCreated
        + clickFarmTasksUpdated
        + urlSwapTasksCreated
        + urlSwapTasksUpdated
      )
      const compactErrorMessage = errors
        .slice(0, 3)
        .map((item: { offerId?: number; type?: string; error?: string }) => (
          `Offer ${item.offerId ?? '-'}(${item.type ?? 'unknown'}): ${item.error ?? '未知错误'}`
        ))
        .join('；')

      if (errors.length > 0 && succeededCount === 0) {
        const errDesc = [unmatchedHint, compactErrorMessage].filter(Boolean).join('')
        toast.error('批量开启任务失败', {
          description: errDesc || '全部任务执行失败',
          duration: 6000,
        })
        return
      }

      if (errors.length > 0) {
        const successPart = messages.length > 0 ? messages.join('；') : '部分任务成功'
        const warningByTypeParts: string[] = []
        if (Number(failedItemsByType.clickFarm || 0) > 0) warningByTypeParts.push(`补点击 ${Number(failedItemsByType.clickFarm)} 项`)
        if (Number(failedItemsByType.urlSwap || 0) > 0) warningByTypeParts.push(`换链接 ${Number(failedItemsByType.urlSwap)} 项`)
        if (Number(failedItemsByType.general || 0) > 0) warningByTypeParts.push(`通用 ${Number(failedItemsByType.general)} 项`)
        const errorPart = compactErrorMessage
          ? `共 ${failedOperationCount} 条失败记录（按操作项计）${warningByTypeParts.length > 0 ? `：${warningByTypeParts.join('，')}` : ''}；示例：${compactErrorMessage}${errors.length > 3 ? '…' : ''}`
          : `共 ${failedOperationCount} 条失败记录（按操作项计）`
        toast.warning('批量开启任务部分成功', {
          description: `${unmatchedHint}${successPart}；已选 ${requestedIdsCount} 个 ID，实际处理 ${matchedOfferCount} 个 Offer；${failedOfferCount} 个 Offer 至少有一项失败；${errorPart}`,
          duration: 6000,
        })
      } else {
        const successDescription =
          unmatchedIdsCount > 0
            ? `${messages.join('；')}（另有 ${unmatchedIdsCount} 个请求 ID 未命中，未处理）`
            : messages.join('；')
        toast.success(result.message || '批量开启任务成功', {
          description: successDescription,
          duration: 5000,
        })
      }

      onSuccess?.()
      onOpenChange(false)
    } catch (error: any) {
      console.error('批量开启任务失败:', error)
      toast.error('批量开启任务失败', {
        description: error.message,
        duration: 5000,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>批量开启任务</DialogTitle>
          <DialogDescription>
            为选中的 {selectionIdCount} 个{isCampaignMode ? '广告系列' : 'Offer'}（去重后）批量开启补点击和换链任务
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert className="bg-blue-50 border-blue-200">
            <div className="text-sm text-blue-900">
              <strong className="font-semibold">📋 公共配置：</strong>
              <ul className="list-disc list-inside mt-2 space-y-1 ml-2">
                <li>
                  <strong>补点击：</strong>
                  每日 10 次，06:00-24:00，不限期，均衡分布，无 Referer
                </li>
                <li>
                  <strong>换链接：</strong>
                  自动访问推广链接，24 小时间隔，不限期
                </li>
              </ul>
            </div>
          </Alert>

          <div className="space-y-3 border rounded-lg p-4 bg-gray-50">
            <div className="flex items-center space-x-3">
              <Checkbox
                id="enableClickFarm"
                checked={enableClickFarm}
                onCheckedChange={(checked) => setEnableClickFarm(checked as boolean)}
                className="data-[state=checked]:bg-blue-600"
              />
              <Label htmlFor="enableClickFarm" className="font-medium cursor-pointer flex-1">
                <div className="flex items-center gap-2">
                  <span>🎯 开启补点击任务</span>
                  <span className="text-xs text-gray-500">
                    （自动访问推广链接增加点击）
                  </span>
                </div>
              </Label>
            </div>

            <div className="flex items-center space-x-3">
              <Checkbox
                id="enableUrlSwap"
                checked={enableUrlSwap}
                onCheckedChange={(checked) => setEnableUrlSwap(checked as boolean)}
                className="data-[state=checked]:bg-blue-600"
              />
              <Label htmlFor="enableUrlSwap" className="font-medium cursor-pointer flex-1">
                <div className="flex items-center gap-2">
                  <span>🔗 开启换链接任务</span>
                  <span className="text-xs text-gray-500">
                    （自动更换推广链接）
                  </span>
                </div>
              </Label>
            </div>
          </div>

          {(!enableClickFarm && !enableUrlSwap) && (
            <Alert variant="destructive">
              <div className="text-sm">
                ⚠️ 请至少选择一种任务类型
              </div>
            </Alert>
          )}

          {selectionIdCount > 100 && (
            <Alert variant="destructive">
              <div className="text-sm">
                ⚠️ 选中项目较多（{selectionIdCount} 个，去重后），建议分批操作（每批 100 个以内）
              </div>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button 
            onClick={handleBatchStart} 
            disabled={loading || (!enableClickFarm && !enableUrlSwap)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                处理中...
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4 mr-2" />
                一键开启
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
