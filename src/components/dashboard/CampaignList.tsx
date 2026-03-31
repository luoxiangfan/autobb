'use client'

/**
 * CampaignList - P1-5优化版 + P2-2导出功能
 * 使用shadcn/ui Table组件 + CSV导出
 */

import { useEffect, useState } from 'react'
import { ArrowUpDown, Search, Filter, Download } from 'lucide-react'
import { exportCampaigns, type CampaignExportData } from '@/lib/export-utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { TableLoadingSkeleton } from '@/components/ui/loading-skeleton' // P2-6: 统一loading
import { NoCampaignsState } from '@/components/ui/empty-state' // P2-7: 统一空状态
import { safeToFixed, formatCurrency } from '@/lib/utils'

interface CampaignPerformance {
  campaignId: number
  campaignName: string
  status: string
  offerBrand: string
  impressions: number
  clicks: number
  cost: number
  conversions: number
  ctr: number
  cpc: number
  conversionRate: number
  currency?: string // 🔧 新增(2025-12-30): 货币代码
}

export function CampaignList() {
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('cost')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const fetchCampaigns = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        sortBy,
        sortOrder,
        page: page.toString(),
        pageSize: '10',
      })

      if (searchQuery) params.append('search', searchQuery)
      if (statusFilter) params.append('status', statusFilter)

      const response = await fetch(`/api/dashboard/campaigns?${params}`, {
        credentials: 'include'
      })
      if (!response.ok) throw new Error('获取Campaign列表失败')

      const result = await response.json()
      setCampaigns(result.data.campaigns)
      setTotalPages(result.data.pagination.totalPages)
    } catch (error) {
      console.error('获取Campaign列表失败:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCampaigns()
  }, [sortBy, sortOrder, searchQuery, statusFilter, page])

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  // P2-6: 使用统一的Loading Skeleton
  if (loading && campaigns.length === 0) {
    return <TableLoadingSkeleton rows={5} />
  }

  // P2-2: 导出Campaign数据
  const handleExport = () => {
    const exportData: CampaignExportData[] = campaigns.map((campaign) => ({
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      status: campaign.status,
      offerBrand: campaign.offerBrand,
      impressions: campaign.impressions,
      clicks: campaign.clicks,
      cost: campaign.cost,
      conversions: campaign.conversions,
      ctr: campaign.ctr,
      cpc: campaign.cpc,
      conversionRate: campaign.conversionRate,
    }))
    exportCampaigns(exportData)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Campaign列表</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={campaigns.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            导出CSV
          </Button>
        </div>
        <div className="mt-4 flex flex-col sm:flex-row gap-4">
          {/* 搜索框 */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="搜索Campaign或品牌..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* 状态筛选 */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="所有状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">所有状态</SelectItem>
              <SelectItem value="ENABLED">启用</SelectItem>
              <SelectItem value="PAUSED">暂停</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        {/* P2-7: 空状态 */}
        {campaigns.length === 0 ? (
          <NoCampaignsState inCard={false} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign名称</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right cursor-pointer hover:bg-accent" onClick={() => handleSort('impressions')}>
                      <div className="flex items-center justify-end gap-1">
                        展示量
                        <ArrowUpDown className="h-4 w-4" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right cursor-pointer hover:bg-accent" onClick={() => handleSort('clicks')}>
                      <div className="flex items-center justify-end gap-1">
                        点击量
                        <ArrowUpDown className="h-4 w-4" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right cursor-pointer hover:bg-accent" onClick={() => handleSort('cost')}>
                      <div className="flex items-center justify-end gap-1">
                        花费
                        <ArrowUpDown className="h-4 w-4" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                    <TableHead className="text-right">CPC</TableHead>
                    <TableHead className="text-right cursor-pointer hover:bg-accent" onClick={() => handleSort('conversions')}>
                      <div className="flex items-center justify-end gap-1">
                        转化量
                        <ArrowUpDown className="h-4 w-4" />
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((campaign) => (
                    <TableRow key={campaign.campaignId}>
                      <TableCell>
                        <div className="font-medium">{campaign.campaignName}</div>
                        <div className="text-sm text-muted-foreground">{campaign.offerBrand}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={campaign.status === 'ENABLED' ? 'default' : 'secondary'}>
                          {campaign.status === 'ENABLED' ? '启用' : '暂停'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {(campaign.impressions ?? 0).toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {(campaign.clicks ?? 0).toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(Number(campaign.cost) || 0, campaign.currency || 'USD', 2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {safeToFixed(Number(campaign.ctr) || 0, 2)}%
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(Number(campaign.cpc) || 0, campaign.currency || 'USD', 2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {campaign.conversions}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  上一页
                </Button>
                <span className="text-sm text-muted-foreground">
                  第 {page} / {totalPages} 页
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  下一页
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
