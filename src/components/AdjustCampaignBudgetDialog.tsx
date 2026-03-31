'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { showError, showSuccess } from '@/lib/toast-utils'

interface AdjustCampaignBudgetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  googleCampaignId: string
  campaignName: string
  currentBudget: number
  currentBudgetType: string
  currency: string
  onSaved?: (payload: {
    googleCampaignId: string
    budgetAmount: number
    budgetType: 'DAILY' | 'TOTAL'
  }) => void | Promise<void>
}

const DAILY_BUDGET_TYPE: 'DAILY' = 'DAILY'

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

export default function AdjustCampaignBudgetDialog(props: AdjustCampaignBudgetDialogProps) {
  const {
    open,
    onOpenChange,
    googleCampaignId,
    campaignName,
    currentBudget,
    currentBudgetType,
    currency,
    onSaved,
  } = props

  const [saving, setSaving] = useState(false)
  const [newBudgetValue, setNewBudgetValue] = useState('')

  const normalizedCurrentBudget = useMemo(() => {
    const parsed = Number(currentBudget)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }, [currentBudget])

  const currentBudgetDisplay = useMemo(() => {
    if (!(normalizedCurrentBudget > 0)) return '(未知)'
    return `${currency} ${normalizedCurrentBudget.toFixed(2)}`
  }, [currency, normalizedCurrentBudget])

  const normalizedCurrentBudgetType = useMemo(
    () => String(currentBudgetType || '').trim().toUpperCase() || DAILY_BUDGET_TYPE,
    [currentBudgetType]
  )

  useEffect(() => {
    if (!open) return
    setNewBudgetValue(normalizedCurrentBudget > 0 ? normalizedCurrentBudget.toFixed(2) : '')
  }, [open, normalizedCurrentBudget])

  const applyPercent = (percent: number) => {
    if (!(normalizedCurrentBudget > 0)) return
    const next = Math.max(0.01, normalizedCurrentBudget * (1 + percent))
    setNewBudgetValue(next.toFixed(2))
  }

  const save = async () => {
    try {
      const parsed = Number.parseFloat(newBudgetValue)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        showError('无效预算', '请输入有效的每日预算金额')
        return
      }

      const normalizedBudgetAmount = roundTo2(parsed)
      setSaving(true)

      const response = await fetch(`/api/campaigns/${googleCampaignId}/update-budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          budgetAmount: normalizedBudgetAmount,
          budgetType: DAILY_BUDGET_TYPE,
        }),
      })

      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error || data?.message || '更新预算失败')
      }

      const nextBudgetAmount = roundTo2(Number(data?.budgetAmount ?? normalizedBudgetAmount))
      const nextBudgetType = String(data?.budgetType || DAILY_BUDGET_TYPE).toUpperCase() === 'TOTAL'
        ? 'TOTAL'
        : 'DAILY'

      await onSaved?.({
        googleCampaignId,
        budgetAmount: nextBudgetAmount,
        budgetType: nextBudgetType,
      })

      showSuccess('每日预算已更新', `${campaignName} → ${currency} ${nextBudgetAmount.toFixed(2)}/day`)
      onOpenChange(false)
    } catch (e: any) {
      showError('更新预算失败', e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>调整每日预算 - {campaignName}</DialogTitle>
          <DialogDescription>预算将同步更新到 Google Ads，并将该广告系列预算类型设置为每日预算（DAILY）。</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              当前预算: <span className="font-medium text-foreground">{currentBudgetDisplay}</span>
            </span>
            <span>
              预算类型: <span className="font-medium text-foreground">{normalizedCurrentBudgetType}</span>
            </span>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">更新后每日预算</div>
            <div className="flex items-center gap-2">
              <div className="text-sm text-muted-foreground w-20">{currency}</div>
              <Input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={newBudgetValue}
                onChange={(e) => setNewBudgetValue(e.target.value)}
                placeholder="0.00"
                disabled={saving}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyPercent(-0.2)}
                disabled={saving || !(normalizedCurrentBudget > 0)}
              >
                -20%
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyPercent(-0.1)}
                disabled={saving || !(normalizedCurrentBudget > 0)}
              >
                -10%
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyPercent(0.1)}
                disabled={saving || !(normalizedCurrentBudget > 0)}
              >
                +10%
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyPercent(0.2)}
                disabled={saving || !(normalizedCurrentBudget > 0)}
              >
                +20%
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 border-t pt-3 flex-wrap">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? '更新中…' : '更新'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
