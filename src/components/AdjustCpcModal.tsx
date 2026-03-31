'use client'

import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { showError, showSuccess } from '@/lib/toast-utils'

interface OfferCampaign {
  id: string
  name: string
  status: string
  currentCpc: number
  currency: string
  biddingStrategy?: string
  adsCustomerId?: string | null
  adsAccountName?: string | null
}

interface AdjustCpcModalProps {
  isOpen: boolean
  onClose: () => void
  offer: {
    id: number
    offerName: string | null
    brand: string
  }
}

export default function AdjustCpcModal({ isOpen, onClose, offer }: AdjustCpcModalProps) {
  const [campaigns, setCampaigns] = useState<OfferCampaign[]>([])
  const [loading, setLoading] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState('')
  const [cpcValues, setCpcValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (isOpen) {
      void fetchCampaigns()
    }
  }, [isOpen, offer.id])

  const fetchCampaigns = async () => {
    try {
      setLoading(true)
      setError('')

      const response = await fetch(`/api/offers/${offer.id}/campaigns`, {
        credentials: 'include', // 确保发送cookie
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || errorData?.message || '获取广告系列失败')
      }

      const data = await response.json()
      const nextCampaigns = (data.campaigns || []) as OfferCampaign[]
      setCampaigns(nextCampaigns)

      // Initialize CPC values with current values
      const initialCpc: Record<string, string> = {}
      nextCampaigns.forEach((campaign) => {
        initialCpc[campaign.id] = campaign.currentCpc > 0 ? campaign.currentCpc.toFixed(2) : ''
      })
      setCpcValues(initialCpc)
    } catch (err: any) {
      const message = err.message || '获取广告系列失败'
      setError(message)
      showError('获取广告系列失败', message)
    } finally {
      setLoading(false)
    }
  }

  const handleCpcChange = (campaignId: string, value: string) => {
    setCpcValues(prev => ({
      ...prev,
      [campaignId]: value
    }))
  }

  const applyPercentToCpc = (campaignId: string, percent: number) => {
    const campaign = campaigns.find(c => c.id === campaignId)
    const base = campaign?.currentCpc ?? 0
    if (!(base > 0)) return
    const next = Math.max(0.01, base * (1 + percent))
    setCpcValues(prev => ({
      ...prev,
      [campaignId]: next.toFixed(2)
    }))
  }

  const getStatusBadge = (status: string) => {
    const normalized = String(status || '').toUpperCase()
    if (normalized === 'ENABLED') return <Badge className="bg-green-600 hover:bg-green-700">启用</Badge>
    if (normalized === 'PAUSED') return <Badge variant="secondary">暂停</Badge>
    if (normalized === 'REMOVED') return <Badge variant="destructive">已删除</Badge>
    return <Badge variant="outline">{normalized || 'UNKNOWN'}</Badge>
  }

  const getCurrentCpcDisplay = (campaign: OfferCampaign) => {
    if (!(campaign.currentCpc > 0)) return '(未知)'
    return `${campaign.currency} ${campaign.currentCpc.toFixed(2)}`
  }

  const handleUpdateCpc = async (campaignId: string) => {
    try {
      setUpdating(true)
      setError('')

      const newCpc = parseFloat(cpcValues[campaignId])
      if (isNaN(newCpc) || newCpc <= 0) {
        setError('请输入有效的CPC值')
        return
      }

      const campaign = campaigns.find((c) => c.id === campaignId)
      if (campaign && campaign.currentCpc > 0 && Number(newCpc.toFixed(2)) === Number(campaign.currentCpc.toFixed(2))) {
        showSuccess('无需更新', `${campaign.name} 的CPC未变化`)
        return
      }

      const response = await fetch(`/api/campaigns/${campaignId}/update-cpc`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          newCpc: newCpc,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '更新CPC失败')
      }

      // Refresh campaigns list
      await fetchCampaigns()
      showSuccess('CPC已更新', `${campaign?.name || campaignId} → ${campaign?.currency || 'USD'} ${newCpc.toFixed(2)}`)
    } catch (err: any) {
      const message = err.message || '更新CPC失败'
      setError(message)
      showError('更新CPC失败', message)
    } finally {
      setUpdating(false)
    }
  }

  const handleUpdateAllCpc = async () => {
    try {
      setUpdating(true)
      setError('')

      let successCount = 0
      let failCount = 0

      for (const campaign of campaigns) {
        try {
          const newCpc = parseFloat(cpcValues[campaign.id])
          if (isNaN(newCpc) || newCpc <= 0) {
            failCount++
            continue
          }

          // Skip if CPC hasn't changed
          if (campaign.currentCpc > 0 && Number(newCpc.toFixed(2)) === Number(campaign.currentCpc.toFixed(2))) {
            continue
          }

          const response = await fetch(`/api/campaigns/${campaign.id}/update-cpc`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include', // 确保发送cookie
            body: JSON.stringify({
              newCpc: newCpc,
            }),
          })

          if (response.ok) {
            successCount++
          } else {
            failCount++
          }
        } catch {
          failCount++
        }
      }

      if (successCount > 0) {
        showSuccess('批量更新完成', `成功 ${successCount} 个${failCount > 0 ? `，失败 ${failCount} 个` : ''}`)
        await fetchCampaigns()
      } else {
        const message = '没有可更新的广告系列，请检查CPC值是否有效或是否有变化'
        setError(message)
        showError('批量更新失败', message)
      }
    } catch (err: any) {
      const message = err.message || '批量更新CPC失败'
      setError(message)
      showError('批量更新失败', message)
    } finally {
      setUpdating(false)
    }
  }

  const canBatchUpdate = useMemo(() => {
    if (campaigns.length === 0) return false
    return campaigns.some((c) => {
      const v = Number.parseFloat(cpcValues[c.id])
      if (!Number.isFinite(v) || v <= 0) return false
      if (!(c.currentCpc > 0)) return true
      return Number(v.toFixed(2)) !== Number(c.currentCpc.toFixed(2))
    })
  }, [campaigns, cpcValues])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>调整CPC - {offer.offerName || offer.brand || `Offer #${offer.id}`}</DialogTitle>
          <DialogDescription>支持输入绝对值CPC，或一键按比例填充（-20%/-10%/+10%/+20%）。</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
          {error && (
            <div className="text-sm text-red-600">{error}</div>
          )}

          {loading ? (
            <div className="text-sm text-muted-foreground">加载中…</div>
          ) : campaigns.length === 0 ? (
            <div className="text-sm text-muted-foreground">未找到广告系列（请先发布广告）。</div>
          ) : (
            <div className="space-y-3">
              {campaigns.map((campaign) => {
                const disableRow = updating || campaign.status === 'REMOVED'
                return (
                  <div key={campaign.id} className={`border rounded-lg p-4 space-y-3 ${campaign.status === 'REMOVED' ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate" title={campaign.name}>{campaign.name}</div>
                        <div className="text-xs text-muted-foreground font-mono truncate" title={campaign.id}>ID: {campaign.id}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Ads账户: <span className="text-foreground">{campaign.adsAccountName?.trim() || '未命名账号'}</span>
                          <span className="mx-1 text-muted-foreground">·</span>
                          <span className="font-mono">{campaign.adsCustomerId || '(未知CID)'}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          竞价策略: <span className="text-foreground">{campaign.biddingStrategy || 'UNKNOWN'}</span>
                        </div>
                      </div>
                      <div className="shrink-0">{getStatusBadge(campaign.status)}</div>
                    </div>

                    <div className="text-sm text-muted-foreground">
                      当前CPC: <span className="font-medium text-foreground">{getCurrentCpcDisplay(campaign)}</span>
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm font-medium">更新后CPC</div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm text-muted-foreground w-20">{campaign.currency}</div>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min="0.01"
                          step="0.01"
                          value={cpcValues[campaign.id] || ''}
                          onChange={(e) => handleCpcChange(campaign.id, e.target.value)}
                          placeholder="0.00"
                          disabled={disableRow}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => applyPercentToCpc(campaign.id, -0.2)} disabled={disableRow || !(campaign.currentCpc > 0)}>
                          -20%
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => applyPercentToCpc(campaign.id, -0.1)} disabled={disableRow || !(campaign.currentCpc > 0)}>
                          -10%
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => applyPercentToCpc(campaign.id, 0.1)} disabled={disableRow || !(campaign.currentCpc > 0)}>
                          +10%
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => applyPercentToCpc(campaign.id, 0.2)} disabled={disableRow || !(campaign.currentCpc > 0)}>
                          +20%
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center justify-end">
                      <Button size="sm" onClick={() => handleUpdateCpc(campaign.id)} disabled={disableRow}>
                        {updating ? '更新中…' : '更新'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 border-t pt-3 flex-wrap">
          <Button type="button" variant="outline" onClick={onClose} disabled={updating}>
            取消
          </Button>
          <Button type="button" onClick={handleUpdateAllCpc} disabled={updating || loading || !canBatchUpdate}>
            {updating ? '更新中…' : '批量更新已修改'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
