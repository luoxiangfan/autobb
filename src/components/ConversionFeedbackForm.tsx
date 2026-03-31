'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Calendar } from 'lucide-react'

interface ConversionFeedbackFormProps {
  adCreativeId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function ConversionFeedbackForm({
  adCreativeId,
  open,
  onOpenChange,
  onSuccess
}: ConversionFeedbackFormProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    conversions: '',
    conversionValue: '',
    periodStart: '',
    periodEnd: '',
    feedbackNote: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const conversions = parseInt(formData.conversions)
    if (isNaN(conversions) || conversions < 0) {
      setError('Please enter a valid number of conversions')
      return
    }

    if (!formData.periodStart || !formData.periodEnd) {
      setError('Please select the date range')
      return
    }

    setLoading(true)

    try {
      const response = await fetch(`/api/ad-creatives/${adCreativeId}/conversion-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include auth cookie
        body: JSON.stringify({
          conversions,
          conversionValue: parseFloat(formData.conversionValue) || 0,
          periodStart: formData.periodStart,
          periodEnd: formData.periodEnd,
          feedbackNote: formData.feedbackNote || undefined
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to submit feedback')
      }

      // 成功后重置表单并关闭
      setFormData({
        conversions: '',
        conversionValue: '',
        periodStart: '',
        periodEnd: '',
        feedbackNote: ''
      })
      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report Conversions</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4">
            {/* 转化次数 */}
            <div className="space-y-2">
              <Label htmlFor="conversions">Number of Conversions *</Label>
              <Input
                id="conversions"
                type="number"
                min="0"
                placeholder="e.g., 25"
                value={formData.conversions}
                onChange={(e) => setFormData({ ...formData, conversions: e.target.value })}
                required
              />
            </div>

            {/* 转化价值 */}
            <div className="space-y-2">
              <Label htmlFor="conversionValue">Conversion Value ($)</Label>
              <Input
                id="conversionValue"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g., 1250.00"
                value={formData.conversionValue}
                onChange={(e) => setFormData({ ...formData, conversionValue: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Optional: Total revenue from these conversions
              </p>
            </div>

            {/* 时间范围 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="periodStart">Start Date *</Label>
                <div className="relative">
                  <Input
                    id="periodStart"
                    type="date"
                    value={formData.periodStart}
                    onChange={(e) => setFormData({ ...formData, periodStart: e.target.value })}
                    required
                  />
                  <Calendar className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="periodEnd">End Date *</Label>
                <div className="relative">
                  <Input
                    id="periodEnd"
                    type="date"
                    value={formData.periodEnd}
                    onChange={(e) => setFormData({ ...formData, periodEnd: e.target.value })}
                    required
                  />
                  <Calendar className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>

            {/* 备注 */}
            <div className="space-y-2">
              <Label htmlFor="feedbackNote">Notes</Label>
              <Textarea
                id="feedbackNote"
                placeholder="Any additional context..."
                value={formData.feedbackNote}
                onChange={(e) => setFormData({ ...formData, feedbackNote: e.target.value })}
                rows={2}
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-500 bg-red-50 p-2 rounded">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Submitting...' : 'Submit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
