'use client'

import CampaignsClientPage from '../campaigns/CampaignsClientPage'
import { isPerformanceReleaseEnabled } from '@/lib/feature-flags'
import { Loader2 } from 'lucide-react'

/**
 * 最近 14 天新增广告系列页面
 * 与广告系列页面使用相同的组件和功能，但只展示最近 14 天内创建的广告系列
 */
export default function Recent14DaysCampaignsPage() {
  const campaignsReqDedupEnabled = isPerformanceReleaseEnabled('campaignsReqDedup')
  const campaignsServerPagingEnabled = isPerformanceReleaseEnabled('campaignsServerPaging')

  // 计算 14 天前的日期
  const now = new Date()
  const fourteenDaysAgo = new Date(now)
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
  
  const startStr = fourteenDaysAgo.toISOString().split('T')[0]
  const endStr = now.toISOString().split('T')[0]
  // 如果参数还未设置，显示加载状态
  const createdAtStart = startStr
  const createdAtEnd = endStr
  
  if (!createdAtStart || !createdAtEnd) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-gray-600">正在加载最近 14 天新增广告系列...</p>
        </div>
      </div>
    )
  }

  return (
    <CampaignsClientPage
      campaignsReqDedupEnabled={campaignsReqDedupEnabled}
      campaignsServerPagingEnabled={campaignsServerPagingEnabled}
      defaultTimeRange='14'
      createdAtStart={createdAtStart}
      createdAtEnd={createdAtEnd}
      pageTitle="最近 14 天新增广告系列"
    />
  )
}
