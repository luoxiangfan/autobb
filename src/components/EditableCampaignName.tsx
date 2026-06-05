'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { X, Loader2 } from 'lucide-react'
import { showSuccess, showError } from '@/lib/toast-utils'

interface EditableCampaignNameProps {
  campaignId: number
  initialCampaignName: string
  disabled?: boolean
  onSaved?: (newName: string) => void
}

/**
 * 可编辑的广告系列名称组件
 */
export function EditableCampaignName({
  campaignId,
  initialCampaignName,
  disabled = false,
  onSaved,
}: EditableCampaignNameProps) {
  const [displayValue, setDisplayValue] = useState(initialCampaignName)
  const [savedValue, setSavedValue] = useState(initialCampaignName)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    setDisplayValue(initialCampaignName)
    setSavedValue(initialCampaignName)
  }, [initialCampaignName])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  const saveCampaignName = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) {
        showError('保存失败', '系列名称不能为空')
        setDisplayValue(savedValue)
        setIsEditing(false)
        return
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      const abortController = new AbortController()
      abortControllerRef.current = abortController
      setIsSaving(true)

      try {
        const response = await fetch(`/api/campaigns/${campaignId}/campaign-name`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ campaignName: trimmed }),
          signal: abortController.signal,
        })

        if (response.status === 401) {
          showError('保存失败', '未授权，请重新登录')
          setTimeout(() => {
            window.location.reload()
          }, 1000)
          return
        }

        if (!response.ok) {
          const data = await response.json().catch(() => null)
          throw new Error(data?.error || '网络错误')
        }

        const data = await response.json().catch(() => null)
        const nextName = String(data?.campaign?.campaignName || trimmed)
        setSavedValue(nextName)
        setDisplayValue(nextName)
        onSaved?.(nextName)
        showSuccess('保存成功', data?.syncedToGoogleAds ? '已同步到 Google Ads' : '系列名称已更新')
        setIsEditing(false)
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        const message = error instanceof Error ? error.message : '网络错误'
        showError('保存失败', message)
        setDisplayValue(savedValue)
      } finally {
        setIsSaving(false)
        abortControllerRef.current = null
      }
    },
    [campaignId, savedValue, onSaved]
  )

  const handleBlur = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      if (displayValue.trim() === savedValue.trim()) {
        setIsEditing(false)
        return
      }
      saveCampaignName(displayValue)
    }, 300)
  }, [displayValue, savedValue, saveCampaignName])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleBlur()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setDisplayValue(savedValue)
        setIsEditing(false)
      }
    },
    [handleBlur, savedValue]
  )

  const handleStartEdit = useCallback(() => {
    if (disabled) return
    setIsEditing(true)
  }, [disabled])

  const handleCancel = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setDisplayValue(savedValue)
    setIsEditing(false)
  }, [savedValue])

  if (disabled) {
    return (
      <div className="font-medium text-gray-900 whitespace-nowrap" title={savedValue}>
        {savedValue}
      </div>
    )
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <Input
          ref={inputRef}
          value={displayValue}
          onChange={(e) => setDisplayValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="输入系列名称"
          className="h-8 text-sm min-w-[180px] font-medium"
          disabled={isSaving}
        />
        {isSaving ? (
          <Loader2 className="w-4 h-4 animate-spin text-gray-400 shrink-0" />
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 shrink-0"
            onClick={handleCancel}
            title="取消编辑 (ESC)"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      className="font-medium text-gray-900 whitespace-nowrap cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5 -mx-1 min-h-[28px] flex items-center"
      onClick={handleStartEdit}
      title="点击编辑系列名称"
    >
      {savedValue}
    </div>
  )
}
