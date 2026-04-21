'use client'

import { useState } from 'react'
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

  const itemCount = campaignIds?.length || offerIds?.length || 0
  const isCampaignMode = !!campaignIds

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

      const body = {
        campaignIds: campaignIds || [],
        offerIds: offerIds || [],
        enableClickFarm,
        enableUrlSwap,
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: '操作失败' }))
        throw new Error(error.error || '操作失败')
      }

      const result = await response.json()
      
      const messages: string[] = []
      if (result.data.clickFarmTasksCreated > 0) {
        messages.push(`新建 ${result.data.clickFarmTasksCreated} 个补点击`)
      }
      if (result.data.clickFarmTasksUpdated > 0) {
        messages.push(`更新 ${result.data.clickFarmTasksUpdated} 个补点击`)
      }
      if (result.data.urlSwapTasksCreated > 0) {
        messages.push(`新建 ${result.data.urlSwapTasksCreated} 个换链接`)
      }
      if (result.data.urlSwapTasksUpdated > 0) {
        messages.push(`更新 ${result.data.urlSwapTasksUpdated} 个换链接`)
      }

      toast.success(result.message, {
        description: messages.join('；'),
        duration: 5000,
      })

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
            为选中的 {itemCount} 个{isCampaignMode ? '广告系列' : 'Offer'}批量开启补点击和换链任务
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

          {itemCount > 100 && (
            <Alert variant="destructive">
              <div className="text-sm">
                ⚠️ 选中项目较多（{itemCount}个），建议分批操作（每批 100 个以内）
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
