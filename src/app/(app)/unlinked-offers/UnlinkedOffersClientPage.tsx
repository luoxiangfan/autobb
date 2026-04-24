'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Package, Calendar, RotateCcw, Loader2, ExternalLink } from 'lucide-react'

interface UnlinkedOffer {
  id: number
  offer_name: string
  brand: string
  offer_url: string
  affiliate_link: string
  target_country: string
  last_unlinked_at: string
  unlinkedFromCustomerIds: string[]
  active_campaign_count: number
}

export default function UnlinkedOffersClientPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [offers, setOffers] = useState<UnlinkedOffer[]>([])
  const [total, setTotal] = useState(0)
  const [selectedOfferIds, setSelectedOfferIds] = useState<number[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  
  // 批量创建对话框
  const [isBatchCreateOpen, setIsBatchCreateOpen] = useState(false)
  const [googleAdsAccounts, setGoogleAdsAccounts] = useState<Array<{ id: number; customer_id: string; account_name: string }>>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [campaignName, setCampaignName] = useState('')
  const [budgetAmount, setBudgetAmount] = useState(50)
  const [budgetType, setBudgetType] = useState('DAILY')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetchUnlinkedOffers()
    fetchGoogleAdsAccounts()
  }, [startDate, endDate, customerId, currentPage, pageSize])

  const fetchUnlinkedOffers = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      if (customerId) params.set('customerId', customerId)
      params.set('limit', pageSize.toString())
      params.set('offset', ((currentPage - 1) * pageSize).toString())

      const response = await fetch(`/api/offers/unlinked?${params.toString()}`, {
        credentials: 'include',
      })

      if (!response.ok) throw new Error('获取数据失败')

      const data = await response.json()
      setOffers(data.offers || [])
      setTotal(data.total || 0)
    } catch (error: any) {
      console.error('获取已解除关联的 Offer 失败:', error)
      toast.error('获取数据失败', { description: error.message })
    } finally {
      setLoading(false)
    }
  }

  const fetchGoogleAdsAccounts = async () => {
    try {
      const response = await fetch('/api/google-ads-accounts', {
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json()
        setGoogleAdsAccounts(data.accounts || [])
      }
    } catch (error) {
      console.error('获取 Google Ads 账号失败:', error)
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // 只选择当前页的 Offer
      const currentIds = offers.map(o => o.id)
      setSelectedOfferIds([...new Set([...selectedOfferIds, ...currentIds])])
    } else {
      // 取消选择当前页的 Offer
      const currentIds = offers.map(o => o.id)
      setSelectedOfferIds(selectedOfferIds.filter(id => !currentIds.includes(id)))
    }
  }

  const handleSelectOffer = (checked: boolean, offerId: number) => {
    if (checked) {
      setSelectedOfferIds([...selectedOfferIds, offerId])
    } else {
      setSelectedOfferIds(selectedOfferIds.filter(id => id !== offerId))
    }
  }

  const handleBatchCreate = async () => {
    if (selectedOfferIds.length === 0) {
      toast.error('请选择至少一个 Offer')
      return
    }

    if (!selectedAccountId) {
      toast.error('请选择 Google Ads 账号')
      return
    }

    setCreating(true)
    try {
      const response = await fetch('/api/offers/batch-create-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          offerIds: selectedOfferIds,
          googleAdsAccountId: parseInt(selectedAccountId),
          campaignConfig: {
            campaignName: campaignName || 'Rebuild_Campaign',
            budgetAmount,
            budgetType,
            status: 'PAUSED',
          },
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '创建失败')
      }

      const result = await response.json()
      toast.success(result.message)
      setIsBatchCreateOpen(false)
      setSelectedOfferIds([])
    } catch (error: any) {
      console.error('批量创建广告系列失败:', error)
      toast.error('批量创建失败', { description: error.message })
    } finally {
      setCreating(false)
    }
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  const allSelected = offers.length > 0 && selectedOfferIds.length === offers.length
  const someSelected = selectedOfferIds.length > 0 && !allSelected

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">已解除关联的 Offer</h1>
              <p className="text-sm text-gray-500 mt-1">
                筛选因删除 Google Ads 账号而解除关联的 Offer，可批量重新创建广告系列
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="default"
                onClick={() => setIsBatchCreateOpen(true)}
                disabled={selectedOfferIds.length === 0}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                批量创建广告系列 ({selectedOfferIds.length})
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 筛选器 */}
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label>开始日期</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <Label>结束日期</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div>
                <Label>Customer ID</Label>
                <Input
                  placeholder="筛选特定 customer_id"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setStartDate('')
                    setEndDate('')
                    setCustomerId('')
                    setCurrentPage(1)
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
            <span>共 {total} 个 Offer</span>
            {selectedOfferIds.length > 0 && (
              <Badge variant="secondary">已选择 {selectedOfferIds.length} 个</Badge>
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
                      checked={allSelected}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Offer 名称</TableHead>
                  <TableHead>品牌</TableHead>
                  <TableHead>国家</TableHead>
                  <TableHead>解除关联时间</TableHead>
                  <TableHead>解除关联的账号</TableHead>
                  <TableHead>活跃广告系列</TableHead>
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
                ) : offers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12">
                      <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="text-gray-500">暂无已解除关联的 Offer</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  offers.map((offer) => (
                    <TableRow key={offer.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedOfferIds.includes(offer.id)}
                          onCheckedChange={(checked) => handleSelectOffer(checked as boolean, offer.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{offer.offer_name || offer.brand}</div>
                          <a
                            href={offer.offer_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                          >
                            查看 Offer <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </TableCell>
                      <TableCell>{offer.brand || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{offer.target_country || '-'}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <Calendar className="w-3 h-3 inline mr-1" />
                          {formatDate(offer.last_unlinked_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {offer.unlinkedFromCustomerIds.slice(0, 3).map((cid: string) => (
                            <Badge key={cid} variant="secondary" className="text-xs">
                              {cid.slice(-4)}
                            </Badge>
                          ))}
                          {offer.unlinkedFromCustomerIds.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{offer.unlinkedFromCustomerIds.length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={offer.active_campaign_count > 0 ? 'default' : 'secondary'}>
                          {offer.active_campaign_count} 个
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => router.push(`/offers/${offer.id}`)}
                        >
                          查看
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* 分页 */}
        {total > 0 && (
          <div className="flex items-center justify-between mt-6">
            <div className="text-sm text-gray-600">
              共 {total} 条记录，第 {currentPage} 页，共 {Math.ceil(total / pageSize)} 页
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label className="text-sm">每页显示</Label>
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
              为选中的 {selectedOfferIds.length} 个 Offer 批量创建广告系列
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label>Google Ads 账号 *</Label>
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="请选择 Google Ads 账号" />
                </SelectTrigger>
                <SelectContent>
                  {googleAdsAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id.toString()}>
                      {account.account_name || account.customer_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>广告系列名称前缀</Label>
              <Input
                placeholder="Rebuild_Campaign"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>每日预算</Label>
                <Input
                  type="number"
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(Number(e.target.value))}
                />
              </div>
              <div>
                <Label>预算类型</Label>
                <Select value={budgetType} onValueChange={setBudgetType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY">每日预算</SelectItem>
                    <SelectItem value="TOTAL">总预算</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
              <strong>说明：</strong>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>新创建的广告系列状态为"暂停"</li>
                <li>跳过已有活跃广告系列的 Offer</li>
                <li>创建后可在广告系列页面查看和管理</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBatchCreateOpen(false)} disabled={creating}>
              取消
            </Button>
            <Button
              onClick={handleBatchCreate}
              disabled={creating || !selectedAccountId || selectedOfferIds.length === 0}
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  创建中...
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  批量创建
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
