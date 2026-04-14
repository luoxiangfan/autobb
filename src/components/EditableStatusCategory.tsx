'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { showSuccess, showError } from '@/lib/toast-utils'

interface StatusCategory {
  value: string
  label: string
  color: string
}

const STATUS_CATEGORIES: StatusCategory[] = [
  { value: 'pending', label: '待定', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  { value: 'watching', label: '观察', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  { value: 'qualified', label: '合格', color: 'bg-green-100 text-green-800 border-green-200' },
]

interface EditableStatusCategoryProps {
  campaignId: number
  initialStatusCategory: string | null
  disabled?: boolean
  onSaved?: (newStatus: string) => void
}

/**
 * 可编辑的运营状态组件
 * 
 * 功能：
 * 1. 默认显示运营状态（Badge 形式）
 * 2. 点击后显示下拉选择框
 * 3. 选择新值后自动保存
 * 4. 失焦或选择后自动关闭
 */
export function EditableStatusCategory({
  campaignId,
  initialStatusCategory,
  disabled = false,
  onSaved,
}: EditableStatusCategoryProps) {
  // 当前状态
  const [status, setStatus] = useState(initialStatusCategory ?? 'pending')
  // 编辑模式
  const [isEditing, setIsEditing] = useState(false)
  // 保存中
  const [isSaving, setIsSaving] = useState(false)
  // 组件引用
  const containerRef = useRef<HTMLDivElement>(null)

  // 获取状态配置
  const statusConfig = STATUS_CATEGORIES.find(s => s.value === status) || STATUS_CATEGORIES[0]

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        if (isEditing) {
          setIsEditing(false)
        }
      }
    }

    if (isEditing) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isEditing])

  /**
   * 保存运营状态
   */
  const saveStatusCategory = useCallback(async (value: string) => {
    if (value === status) {
      setIsEditing(false)
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/status-category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ statusCategory: value }),
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

      // 保存成功
      setStatus(value)
      onSaved?.(value)
      showSuccess('保存成功', `已设置运营状态为"${STATUS_CATEGORIES.find(s => s.value === value)?.label || value}"`)
    } catch (error: any) {
      showError('保存失败', error?.message || '网络错误')
    } finally {
      setIsSaving(false)
      setIsEditing(false)
    }
  }, [campaignId, status, onSaved])

  /**
   * 处理状态变化
   */
  const handleValueChange = (value: string) => {
    saveStatusCategory(value)
  }

  // 禁用状态
  if (disabled) {
    return (
      <Badge variant="outline" className="w-full justify-center opacity-50">
        {statusConfig.label}
      </Badge>
    )
  }

  // 编辑模式
  if (isEditing) {
    return (
      <div ref={containerRef} className="relative">
        <Select
          value={status}
          onValueChange={(value) => {
            handleValueChange(value)
          }}
          onBlur={() => setIsEditing(false)}
          className="h-8 w-[100px] text-sm"
          autoFocus
        >
          <option value="" disabled>
            运营状态
          </option>
          {STATUS_CATEGORIES.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </Select>
      </div>
    )
  }

  // 显示模式
  return (
    <Badge
      variant="outline"
      className={`w-full justify-center cursor-pointer hover:bg-gray-50 transition-colors ${statusConfig.color}`}
      onClick={() => setIsEditing(true)}
      title="点击修改运营状态"
    >
      {isSaving ? (
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          保存中...
        </span>
      ) : (
        statusConfig.label
      )}
    </Badge>
  )
}
