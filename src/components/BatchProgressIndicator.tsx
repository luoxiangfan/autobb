'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'

interface BatchProgressIndicatorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  batchId: string | null
  status: string | null
  progress: number
  totalCount: number
  completedCount: number
  failedCount: number
}

export function BatchProgressIndicator({
  open,
  onOpenChange,
  batchId,
  status,
  progress,
  totalCount,
  completedCount,
  failedCount,
}: BatchProgressIndicatorProps) {
  const [statusText, setStatusText] = useState('准备中...')

  useEffect(() => {
    switch (status) {
      case 'pending':
        setStatusText('任务已加入队列，等待执行...')
        break
      case 'running':
        setStatusText(`正在创建广告系列... (${completedCount + failedCount}/${totalCount})`)
        break
      case 'completed':
        setStatusText('✅ 全部完成！')
        break
      case 'partial':
        setStatusText(`⚠️ 部分完成：成功 ${completedCount} 个，失败 ${failedCount} 个`)
        break
      case 'failed':
        setStatusText('❌ 任务失败')
        break
      default:
        setStatusText('准备中...')
    }
  }, [status, completedCount, failedCount, totalCount])

  const getStatusColor = () => {
    switch (status) {
      case 'completed':
        return 'text-green-600'
      case 'partial':
        return 'text-yellow-600'
      case 'failed':
        return 'text-red-600'
      default:
        return 'text-blue-600'
    }
  }

  const getStatusIcon = () => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-6 h-6 text-green-600" />
      case 'partial':
        return <AlertCircle className="w-6 h-6 text-yellow-600" />
      case 'failed':
        return <XCircle className="w-6 h-6 text-red-600" />
      default:
        return <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getStatusIcon()}
            <span className={getStatusColor()}>批量创建广告系列</span>
          </DialogTitle>
          <DialogDescription>
            {batchId && (
              <Badge variant="secondary" className="mt-2">
                任务 ID: {batchId}
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 进度条 */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{statusText}</span>
              <span className="font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* 统计信息 */}
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="space-y-1">
              <div className="text-2xl font-bold">{totalCount}</div>
              <div className="text-xs text-gray-500">总数</div>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-bold text-green-600">{completedCount}</div>
              <div className="text-xs text-gray-500">成功</div>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-bold text-red-600">{failedCount}</div>
              <div className="text-xs text-gray-500">失败</div>
            </div>
          </div>

          {/* 提示信息 */}
          {status === 'running' && (
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-sm text-blue-900">
                💡 任务在后台执行，您可以关闭此对话框继续其他操作。
                <br />
                完成后会收到通知。
              </AlertDescription>
            </Alert>
          )}

          {status === 'completed' && (
            <Alert className="bg-green-50 border-green-200">
              <AlertDescription className="text-sm text-green-900">
                🎉 所有广告系列创建成功！
              </AlertDescription>
            </Alert>
          )}

          {status === 'partial' && (
            <Alert variant="destructive">
              <AlertDescription className="text-sm">
                ⚠️ 部分广告系列创建失败，请查看错误日志。
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
