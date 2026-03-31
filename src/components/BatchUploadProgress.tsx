'use client'

import { useState, useEffect } from 'react'
import { X, ChevronRight, CheckCircle, Clock, AlertCircle, Loader2 } from 'lucide-react'

interface BatchUploadProgressProps {
  offerIds: number[]
  onComplete?: () => void
  onClose?: () => void
}

// 🔧 修复(2025-12-11): 使用camelCase匹配API返回的字段名
interface OfferStatus {
  id: number
  brand: string
  scrapeStatus: 'pending' | 'in_progress' | 'completed' | 'failed'
  affiliateLink?: string
  targetCountry?: string
  scrapeError?: string
}

export function BatchUploadProgress({ offerIds, onComplete, onClose }: BatchUploadProgressProps) {
  const [progress, setProgress] = useState({ completed: 0, total: offerIds.length })
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [offers, setOffers] = useState<OfferStatus[]>([])
  const [isMinimized, setIsMinimized] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)

  useEffect(() => {
    // 轮询状态（每5秒）
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/offers?ids=${offerIds.join(',')}`)
        const data = await response.json()

        if (data.success && data.offers) {
          setOffers(data.offers)

          const completed = data.offers.filter(
            (o: OfferStatus) => o.scrapeStatus === 'completed' || o.scrapeStatus === 'failed'
          ).length

          setProgress({ completed, total: offerIds.length })

          // 全部完成
          if (completed === offerIds.length && !isCompleted) {
            setIsCompleted(true)
            clearInterval(interval)
            onComplete?.()
          }
        }
      } catch (error) {
        console.error('轮询Offer状态失败:', error)
      }
    }, 5000)

    // 立即执行一次
    fetch(`/api/offers?ids=${offerIds.join(',')}`).then(async (response) => {
      const data = await response.json()
      if (data.success && data.offers) {
        setOffers(data.offers)
      }
    })

    return () => clearInterval(interval)
  }, [offerIds, isCompleted, onComplete])

  const progressPercentage = Math.round((progress.completed / progress.total) * 100)
  const estimatedMinutes = Math.ceil((progress.total - progress.completed) * 0.5)

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />
      case 'in_progress':
        return <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-red-600" />
      default:
        return <Clock className="w-5 h-5 text-gray-400" />
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return '已完成'
      case 'in_progress':
        return 'AI分析中...'
      case 'failed':
        return '处理失败'
      default:
        return '等待处理'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-600'
      case 'in_progress':
        return 'text-blue-600'
      case 'failed':
        return 'text-red-600'
      default:
        return 'text-gray-500'
    }
  }

  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className="fixed bottom-4 right-4 z-50 bg-indigo-600 text-white px-4 py-2 rounded-full shadow-lg hover:bg-indigo-700 transition-all flex items-center space-x-2"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm font-medium">
          {progress.completed}/{progress.total} 已完成
        </span>
      </button>
    )
  }

  return (
    <>
      {/* 浮动进度卡片 */}
      <div className="fixed top-4 right-4 z-50 bg-white shadow-2xl rounded-lg w-80 border border-gray-200">
        <div className="p-4">
          {/* 标题栏 */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
              <span className="text-sm font-semibold text-gray-900">
                {isCompleted ? '✅ 批量上传完成' : '📤 批量上传进行中'}
              </span>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={() => setIsMinimized(true)}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                title="最小化"
              >
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              </button>
              <button
                onClick={() => {
                  onClose?.()
                }}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                title="关闭"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>

          {/* 进度信息 */}
          <div className="mb-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-2xl font-bold text-gray-900">
                {progress.completed}/{progress.total}
              </span>
              <span className="text-sm font-medium text-gray-600">
                {progressPercentage}%
              </span>
            </div>

            {/* 进度条 */}
            <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-500 to-indigo-600 h-2.5 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>

          {/* 预计时间 */}
          {!isCompleted && progress.completed < progress.total && (
            <p className="text-xs text-gray-500 mb-3">
              ⏱️ 预计剩余时间: 约 {estimatedMinutes} 分钟
            </p>
          )}

          {/* 完成提示 */}
          {isCompleted && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3">
              <p className="text-sm text-green-800 font-medium">
                🎉 所有Offer已处理完成！
              </p>
              <p className="text-xs text-green-600 mt-1">
                成功: {offers.filter(o => o.scrapeStatus === 'completed').length} 个 |
                失败: {offers.filter(o => o.scrapeStatus === 'failed').length} 个
              </p>
            </div>
          )}

          {/* 查看详情按钮 */}
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-medium"
          >
            <span>查看详细进度</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 侧边抽屉（详细信息） */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50">
          {/* 半透明背景 */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity"
            onClick={() => setIsDrawerOpen(false)}
          />

          {/* 抽屉内容 */}
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl overflow-hidden flex flex-col animate-slide-in-right">
            {/* 抽屉标题 */}
            <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">📤 批量上传进度</h2>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="p-1 hover:bg-white/20 rounded transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-3xl font-bold">
                    {progress.completed}/{progress.total}
                  </span>
                  <span className="text-lg font-semibold">
                    {progressPercentage}%
                  </span>
                </div>
                <div className="w-full bg-white/30 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-white h-3 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Offer列表 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {offers.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                  <p>加载中...</p>
                </div>
              ) : (
                offers.map((offer) => (
                  <div
                    key={offer.id}
                    className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow bg-white"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(offer.scrapeStatus)}
                        <span className="font-semibold text-gray-900">
                          Offer #{offer.id}
                        </span>
                      </div>
                      <span className={`text-xs font-medium ${getStatusColor(offer.scrapeStatus)}`}>
                        {getStatusText(offer.scrapeStatus)}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <p className="text-sm text-gray-700">
                        <span className="font-medium">品牌:</span> {offer.brand || '提取中...'}
                      </p>
                      <p className="text-sm text-gray-700">
                        <span className="font-medium">国家:</span> {offer.targetCountry || 'N/A'}
                      </p>
                      {offer.scrapeError && (
                        <p className="text-xs text-red-600 mt-2">
                          ⚠️ {offer.scrapeError}
                        </p>
                      )}
                    </div>

                    {offer.scrapeStatus === 'completed' && (
                      <a
                        href={`/offers/${offer.id}`}
                        className="inline-block mt-3 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        查看详情 →
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* 底部操作栏 */}
            <div className="border-t border-gray-200 p-4 bg-gray-50">
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加动画样式 */}
      <style jsx>{`
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }
      `}</style>
    </>
  )
}
