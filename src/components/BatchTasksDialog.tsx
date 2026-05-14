'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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

function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError'
  }
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  return name === 'AbortError'
}

/** 仅接受普通对象，排除数组与 null，避免误把 `data: []` 当业务载荷 */
function batchResponseDataObject(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return {}
  }
  return data as Record<string, unknown>
}

/** 与路由 `appendUnmatchedHint` 等文案对齐：message/error 任一已说明未命中时，客户端不再重复前缀 */
function batchApiPayloadMentionsUnmatched(message: unknown, error: unknown): boolean {
  const pieces = [message, error].filter(
    (x): x is string => typeof x === 'string' && x.trim().length > 0
  )
  return pieces.some(
    (text) => text.includes('未命中') || text.includes('不完全对应')
  )
}

function finiteNonNegativeInt(raw: unknown, fallback: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

/** Strict Mode 会重复挂载；模块级保证 dev 下「缺 variant」只告警一次 */
let batchTasksDialogVariantDevWarned = false

export type BatchTasksDialogVariant = 'offers' | 'campaigns'

interface BatchTasksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * 应显式传入 `offers` 或 `campaigns`，与请求接口一致。
   * 未传时仍会根据「是否存在有效 campaignIds」推断（仅兼容旧调用；新页面必须传入）。
   */
  variant?: BatchTasksDialogVariant
  campaignIds?: number[]  // 广告系列页面使用
  offerIds?: number[]     // Offer 页面使用
  onSuccess?: () => void
}

export default function BatchTasksDialog({
  open,
  onOpenChange,
  variant,
  campaignIds,
  offerIds,
  onSuccess,
}: BatchTasksDialogProps) {
  const [loading, setLoading] = useState(false)
  const [enableClickFarm, setEnableClickFarm] = useState(true)
  const [enableUrlSwap, setEnableUrlSwap] = useState(true)
  const submittingRef = useRef(false)
  const batchFetchAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || variant !== undefined) return
    if (batchTasksDialogVariantDevWarned) return
    batchTasksDialogVariantDevWarned = true
    console.warn(
      '[BatchTasksDialog] 请传入 variant="offers" | "campaigns"；未传时依赖 campaignIds 推断，后续可能改为必填。'
    )
  }, [variant])

  useEffect(() => {
    if (!open) {
      batchFetchAbortRef.current?.abort()
    }
  }, [open])

  const isCampaignMode = useMemo(() => {
    if (variant === 'campaigns') return true
    if (variant === 'offers') return false
    /** 依据 `.length` 推断：空数组为 false（勿用 `!!campaignIds`，空数组在 JS 中为真值） */
    return Boolean(campaignIds?.length)
  }, [variant, campaignIds])
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
    if (selectionIdCount === 0) {
      toast.error('请先选择至少一个要批量处理的项目')
      return
    }
    if (submittingRef.current) {
      return
    }
    submittingRef.current = true
    setLoading(true)
    const ac = new AbortController()
    batchFetchAbortRef.current = ac
    try {
      const endpoint = isCampaignMode
        ? '/api/campaigns/batch-start-tasks'
        : '/api/offers/batch-start-tasks'

      const clientRequestId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : undefined

      const body = isCampaignMode
        ? {
            campaignIds: campaignIds || [],
            enableClickFarm,
            enableUrlSwap,
            ...(clientRequestId ? { clientRequestId } : {}),
          }
        : {
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
        signal: ac.signal,
      })

      const result = await response.json().catch(() => ({}))
      const responseData = batchResponseDataObject(result?.data)
      const errors = Array.isArray(responseData.errors) ? responseData.errors : []
      const rawFailedByType = responseData.failedItemsByType
      const failedItemsByType =
        rawFailedByType && typeof rawFailedByType === 'object' && !Array.isArray(rawFailedByType)
          ? (rawFailedByType as { clickFarm?: number; urlSwap?: number; general?: number })
          : {}

      const requestedIdsCount = finiteNonNegativeInt(
        responseData.requestedIdsCount,
        selectionIdCount
      )
      const matchedOfferCount = finiteNonNegativeInt(
        responseData.matchedOfferCount ?? responseData.requestedCount,
        0
      )
      const unmatchedIdsCount = finiteNonNegativeInt(responseData.unmatchedIdsCount, 0)
      const selectionIdKindFromApi =
        responseData.selectionIdKind === 'campaign' ? 'campaign' : 'offer'
      const unmatchedHint =
        unmatchedIdsCount > 0
          ? selectionIdKindFromApi === 'campaign'
            ? `另有 ${unmatchedIdsCount} 个广告系列 ID 可能未单独命中库中记录。`
            : `另有 ${unmatchedIdsCount} 个请求 ID 未命中。`
          : ''

      const byTypeParts: string[] = []
      if (Number(failedItemsByType.clickFarm || 0) > 0) byTypeParts.push(`补点击 ${Number(failedItemsByType.clickFarm)} 项`)
      if (Number(failedItemsByType.urlSwap || 0) > 0) byTypeParts.push(`换链接 ${Number(failedItemsByType.urlSwap)} 项`)
      if (Number(failedItemsByType.general || 0) > 0) byTypeParts.push(`通用 ${Number(failedItemsByType.general)} 项`)

      const compactErrorMessage = errors
        .slice(0, 3)
        .map((item: { offerId?: number; type?: string; error?: string }) => (
          `Offer ${item.offerId ?? '-'}(${item.type ?? 'unknown'}): ${item.error ?? '未知错误'}`
        ))
        .join('；')

      const idSelectionLine =
        selectionIdKindFromApi === 'campaign'
          ? `已选 ${requestedIdsCount} 个广告系列（去重后 ID），实际处理 ${matchedOfferCount} 个 Offer。`
          : `已选 ${requestedIdsCount} 个 Offer ID，实际处理 ${matchedOfferCount} 个 Offer。`

      const serverCoversUnmatched = batchApiPayloadMentionsUnmatched(
        result?.message,
        result?.error
      )

      if (!response.ok) {
        if (ac.signal.aborted) return
        const fallback = errors.length > 0
          ? `共 ${errors.length} 条失败记录（按操作项计）${byTypeParts.length > 0 ? `：${byTypeParts.join('，')}` : ''}`
          : '操作失败'
        const unmatchedPrefixForErrorDesc =
          unmatchedIdsCount > 0 && !serverCoversUnmatched ? unmatchedHint : ''
        const errDesc = [unmatchedPrefixForErrorDesc, idSelectionLine, compactErrorMessage].filter(Boolean).join('')
        const title =
          typeof result?.message === 'string' && result.message.trim().length > 0
            ? result.message.trim()
            : typeof result?.error === 'string' && result.error.trim().length > 0
              ? result.error.trim()
              : '批量开启任务失败'
        toast.error(title, {
          description: errDesc || fallback,
          duration: 6000,
        })
        return
      }

      const messages: string[] = []
      const clickFarmTasksCreated = finiteNonNegativeInt(responseData.clickFarmTasksCreated, 0)
      const clickFarmTasksUpdated = finiteNonNegativeInt(responseData.clickFarmTasksUpdated, 0)
      const urlSwapTasksCreated = finiteNonNegativeInt(responseData.urlSwapTasksCreated, 0)
      const urlSwapTasksUpdated = finiteNonNegativeInt(responseData.urlSwapTasksUpdated, 0)
      const failedOfferCount = finiteNonNegativeInt(responseData.failedOfferCount, 0)
      const failedOperationCount = errors.length

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

      if (errors.length > 0) {
        const successPart = messages.length > 0 ? messages.join('；') : '部分任务成功'
        const errorPart = compactErrorMessage
          ? `共 ${failedOperationCount} 条失败记录（按操作项计）${byTypeParts.length > 0 ? `：${byTypeParts.join('，')}` : ''}；示例：${compactErrorMessage}${errors.length > 3 ? '…' : ''}`
          : `共 ${failedOperationCount} 条失败记录（按操作项计）`
        const partialTitle =
          typeof result?.message === 'string' && result.message.trim().length > 0
            ? result.message.trim()
            : typeof result?.error === 'string' && result.error.trim().length > 0
              ? result.error.trim()
              : '批量开启任务部分成功'
        const partialUnmatchedPrefix =
          unmatchedIdsCount > 0 && !serverCoversUnmatched ? unmatchedHint : ''
        const idSelectionPhrase =
          selectionIdKindFromApi === 'campaign'
            ? `已选 ${requestedIdsCount} 个广告系列（去重后 ID）`
            : `已选 ${requestedIdsCount} 个 Offer ID`
        toast.warning(partialTitle, {
          description: `${partialUnmatchedPrefix}${successPart}；${idSelectionPhrase}，实际处理 ${matchedOfferCount} 个 Offer；${failedOfferCount} 个 Offer 至少有一项失败；${errorPart}`,
          duration: 6000,
        })
      } else {
        // 未命中提示已在接口返回的 `message`（toast 标题）中由服务端拼接，此处不再重复
        const successDescription = messages.join('；')
        const successTitle =
          typeof result?.message === 'string' && result.message.trim().length > 0
            ? result.message.trim()
            : '批量开启任务成功'
        toast.success(successTitle, {
          ...(successDescription ? { description: successDescription } : {}),
          duration: 5000,
        })
      }

      onSuccess?.()
      onOpenChange(false)
    } catch (error: any) {
      if (isAbortError(error)) return
      console.error('批量开启任务失败:', error)
      toast.error('批量开启任务失败', {
        description: error?.message ?? String(error),
        duration: 5000,
      })
    } finally {
      if (batchFetchAbortRef.current === ac) {
        batchFetchAbortRef.current = null
      }
      submittingRef.current = false
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" aria-busy={loading}>
        <DialogHeader>
          <DialogTitle>批量开启任务</DialogTitle>
          <DialogDescription>
            {selectionIdCount === 0
              ? '请先在列表中勾选至少一项有效数据（去重后为正整数 ID），再批量开启任务。'
              : `为选中的 ${selectionIdCount} 个${isCampaignMode ? '广告系列' : 'Offer'}（去重后）批量开启补点击和换链任务`}
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

          {selectionIdCount === 0 && (
            <Alert variant="destructive">
              <div className="text-sm">
                ⚠️ 关闭本窗口后回到列表重新勾选即可
              </div>
            </Alert>
          )}

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
            disabled={
              loading
              || (!enableClickFarm && !enableUrlSwap)
              || selectionIdCount === 0
            }
            className="bg-blue-600 hover:bg-blue-700"
            aria-busy={loading}
            title={
              selectionIdCount === 0
                ? '请先在列表中勾选至少一项有效数据'
                : undefined
            }
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
