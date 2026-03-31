'use client'

/**
 * MobileOfferCard - P2-4移动端优化
 * 针对移动端设计的Offer卡片视图
 */

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Rocket, DollarSign, BarChart3, ExternalLink } from 'lucide-react'

interface Offer {
  id: number
  url: string
  brand: string
  category: string | null
  targetCountry: string
  affiliateLink: string | null
  brandDescription: string | null
  scrapeStatus: string  // 🔧 修复(2025-12-11): snake_case → camelCase
  isActive: boolean
  createdAt: string
  offerName: string | null
  targetLanguage: string | null
  productPrice?: string | null
  commissionPayout?: string | null
  linkedAccounts?: any[]
}

interface MobileOfferCardProps {
  offer: Offer
  onLaunchAd: (offer: Offer) => void
  onAdjustCpc: (offer: Offer) => void
  onLaunchScore: (offer: Offer) => void
}

export function MobileOfferCard({
  offer,
  onLaunchAd,
  onAdjustCpc,
  onLaunchScore,
}: MobileOfferCardProps) {
  const getScrapeStatusBadge = (status: string) => {
    const configs = {
      pending: { label: '抓取中', variant: 'default' as const },
      in_progress: { label: '抓取中', variant: 'default' as const },
      completed: { label: '已完成', variant: 'default' as const },
      failed: { label: '失败', variant: 'destructive' as const },
    }
    const config = configs[status as keyof typeof configs] || {
      label: status,
      variant: 'outline' as const,
    }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        {/* 顶部：Offer ID */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 font-mono">Offer ID: #{offer.id}</span>
          {getScrapeStatusBadge(offer.scrapeStatus)}
        </div>

        {/* Offer标识 */}
        <div className="flex items-start gap-2">
          <a
            href={`/offers/${offer.id}`}
            className="text-blue-600 hover:text-blue-800 font-semibold text-sm flex items-center gap-1 flex-1"
          >
            <span className="font-mono truncate">
              {offer.offerName || `${offer.brand}_${offer.targetCountry}_01`}
            </span>
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
          </a>
        </div>

        {/* 品牌信息 */}
        <div className="space-y-1">
          <div className="font-medium text-gray-900">{offer.brand}</div>
          <div className="text-xs text-gray-500 truncate">{offer.url}</div>
        </div>

        {/* 国家和语言 */}
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline" className="text-xs">
            {offer.targetCountry}
          </Badge>
          <span className="text-gray-600">{offer.targetLanguage || 'English'}</span>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col gap-2 pt-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => onLaunchAd(offer)}
            className="w-full justify-start"
          >
            <Rocket className="w-4 h-4 mr-2" />
            一键上广告
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAdjustCpc(offer)}
              className="justify-start"
              disabled={!offer.linkedAccounts || offer.linkedAccounts.length === 0}
              title={!offer.linkedAccounts || offer.linkedAccounts.length === 0 ? '请先发布广告并关联Ads账号' : undefined}
            >
              <DollarSign className="w-4 h-4 mr-1" />
              调整CPC
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onLaunchScore(offer)}
              className="justify-start"
            >
              <BarChart3 className="w-4 h-4 mr-1" />
              投放分析
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
