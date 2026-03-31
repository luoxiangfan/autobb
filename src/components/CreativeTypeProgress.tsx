'use client'

/**
 * 🆕 v4.16: 创意类型进度指示器组件
 * ✅ KISS-3类型：显示3个创意类型的生成状态：已生成、待生成
 */

import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

interface CreativeTypeProgressProps {
  generatedBuckets: string[]
  activeBucket?: string | null
  offer: {
    page_type?: string | null
  }
}

// KISS-3类型创意配置（单品/店铺使用同一套逻辑展示）
const PRODUCT_BUCKETS = [
  {
    key: 'A',
    creativeType: 'brand_intent',
    label: '品牌意图导向',
    description: '品牌词必须和当前商品/品类锚点一起出现',
    color: 'bg-blue-500'
  },
  {
    key: 'B',
    creativeType: 'model_intent',
    label: '商品型号/产品族导向',
    description: '聚焦当前商品型号/产品族，按完全匹配投放',
    color: 'bg-green-500'
  },
  {
    key: 'D',
    creativeType: 'product_intent',
    label: '商品需求导向',
    description: '覆盖品牌+商品需求/功能/场景，扩大需求承接',
    color: 'bg-amber-500'
  },
]

const STORE_BUCKETS = [
  {
    key: 'A',
    creativeType: 'brand_intent',
    label: '品牌意图导向',
    description: '品牌词必须和真实商品集合/核心品类一起出现',
    color: 'bg-blue-500'
  },
  {
    key: 'B',
    creativeType: 'model_intent',
    label: '热门型号/产品族导向',
    description: '聚焦店铺热门商品型号/产品族，按完全匹配投放',
    color: 'bg-green-500'
  },
  {
    key: 'D',
    creativeType: 'product_intent',
    label: '商品需求导向',
    description: '覆盖品牌下商品需求、产品线、功能和场景',
    color: 'bg-amber-500'
  },
]

export function CreativeTypeProgress({ generatedBuckets, activeBucket, offer }: CreativeTypeProgressProps) {
  const linkType = offer.page_type || 'product'
  const buckets = linkType === 'store' ? STORE_BUCKETS : PRODUCT_BUCKETS
  const nextBucket = buckets.find(b => !generatedBuckets.includes(b.key))
  const highlightedBucket = activeBucket || nextBucket?.key || null

  return (
    <TooltipProvider>
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-gray-700">创意类型（canonical）</span>

          <div className="flex items-center gap-2">
            {buckets.map((bucket) => {
              const isGenerated = generatedBuckets.includes(bucket.key)
              const isCurrent = highlightedBucket === bucket.key
              const isGenerating = activeBucket === bucket.key

              return (
                <Tooltip key={bucket.key}>
                  <TooltipTrigger asChild>
                    <div
                      className={`flex cursor-default items-center gap-1.5 rounded-md border px-2 py-1 ${
                        isGenerated
                          ? 'border-green-200 bg-green-50/60'
                          : isCurrent
                            ? 'border-purple-200 bg-purple-50/50'
                            : 'border-gray-200 bg-gray-50/60'
                      }`}
                    >
                      <div
                        className={`
                          flex h-5 w-5 shrink-0 items-center justify-center rounded-full
                          ${isGenerated
                            ? `${bucket.color} text-white`
                            : 'bg-gray-100 text-gray-400'}
                          ${isCurrent && !isGenerated ? 'ring-1 ring-purple-500' : ''}
                        `}
                      >
                        {isGenerated ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : isGenerating ? (
                          <Loader2 className="h-3 w-3 animate-spin text-purple-600" />
                        ) : (
                          <Circle className="h-3 w-3" />
                        )}
                      </div>
                      <span className={`text-xs font-semibold ${isGenerated ? 'text-gray-900' : 'text-gray-500'}`}>
                        {bucket.label}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-gray-400">{bucket.creativeType}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-medium">{bucket.label}</p>
                    <p className="text-[11px] text-gray-500">槽位 {bucket.key} · {bucket.creativeType}</p>
                    <p className="text-xs text-gray-500">{bucket.description}</p>
                    {isGenerated && (
                      <p className="mt-1 text-xs text-green-600">✓ 已生成</p>
                    )}
                    {isGenerating && (
                      <p className="mt-1 text-xs text-purple-600">生成中</p>
                    )}
                    {!isGenerated && !isGenerating && isCurrent && (
                      <p className="mt-1 text-xs text-gray-500">下一步</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>

          <span className="text-xs text-gray-500">
            {generatedBuckets.length === 3 ? (
              <span className="font-medium text-green-600">全部完成</span>
            ) : activeBucket ? (
              <span className="font-medium text-purple-600">
                生成中
              </span>
            ) : generatedBuckets.length === 0 ? (
              <span className="text-gray-400">未开始</span>
            ) : (
              <span className="text-gray-600">
                {generatedBuckets.length}/3
              </span>
            )}
          </span>
        </div>
      </div>
    </TooltipProvider>
  )
}
