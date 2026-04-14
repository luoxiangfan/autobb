'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Check, X, Loader2 } from 'lucide-react'
import { showSuccess, showError } from '@/lib/toast-utils'

interface EditableCustomNameProps {
  campaignId: number
  initialCustomName: string | null
  disabled?: boolean
  onSaved?: (newName: string | null) => void
}

/**
 * 可编辑的自定义名称组件
 * 
 * 功能：
 * 1. 默认显示自定义名称（如果有），否则显示占位符
 * 2. 点击后进入编辑模式
 * 3. 失焦或按 Enter 保存，按 ESC 取消
 * 4. 只在值发生变化时才请求接口
 * 5. 短时间多次请求时取消前面的请求，只保留最后一次
 */
export function EditableCustomName({
  campaignId,
  initialCustomName,
  disabled = false,
  onSaved,
}: EditableCustomNameProps) {
  // 当前显示的名称（可能正在编辑）
  const [displayValue, setDisplayValue] = useState(initialCustomName ?? '')
  // 已保存的名称（用于比较是否发生变化）
  const [savedValue, setSavedValue] = useState(initialCustomName ?? '')
  // 编辑模式
  const [isEditing, setIsEditing] = useState(false)
  // 保存中
  const [isSaving, setIsSaving] = useState(false)
  // 输入框引用
  const inputRef = useRef<HTMLInputElement>(null)
  // 当前请求的 AbortController
  const abortControllerRef = useRef<AbortController | null>(null)
  // 防抖定时器
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 聚焦输入框
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // 清理函数
  useEffect(() => {
    return () => {
      // 组件卸载时取消请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      // 清除定时器
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  /**
   * 保存自定义名称
   */
  const saveCustomName = useCallback(async (value: string) => {
    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // 创建新的 AbortController
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setIsSaving(true)

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/custom-name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          customName: value === '' ? null : value,
        }),
        signal: abortController.signal,
      })

      if (response.status === 401) {
        showError('保存失败', '未授权，请重新登录')
        // 刷新页面重新加载数据
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
      setSavedValue(value.trim())
      onSaved?.(value === '' ? null : value)
      showSuccess('保存成功', value ? `已设置自定义名称` : '已清除自定义名称')
      setIsEditing(false)
    } catch (error: any) {
      // 忽略取消的请求
      if (error.name === 'AbortError') {
        return
      }

      showError('保存失败', error?.message || '网络错误')
      // 恢复为已保存的值
      setDisplayValue(savedValue.trim())
    } finally {
      setIsSaving(false)
      abortControllerRef.current = null
    }
  }, [campaignId, savedValue, onSaved])

  /**
   * 处理失焦保存（带防抖）
   */
  const handleBlur = useCallback(() => {
    // 清除之前的定时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // 设置新的定时器（300ms 防抖）
    debounceTimerRef.current = setTimeout(() => {
      // 值没有变化，不保存
      if (displayValue === savedValue) {
        setIsEditing(false)
        return
      }

      // 保存新值
      saveCustomName(displayValue)
    }, 300)
  }, [displayValue, savedValue, saveCustomName])

  /**
   * 处理键盘事件
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // 按 Enter 保存
      e.preventDefault()
      handleBlur()
    } else if (e.key === 'Escape') {
      // 按 ESC 取消
      e.preventDefault()
      setDisplayValue(savedValue.trim())
      setIsEditing(false)
    }
  }, [handleBlur, savedValue])

  /**
   * 开始编辑
   */
  const handleStartEdit = useCallback(() => {
    if (disabled) return
    setIsEditing(true)
  }, [disabled])

  /**
   * 取消编辑
   */
  const handleCancel = useCallback(() => {
    // 清除定时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    // 取消请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    setDisplayValue(savedValue.trim())
    setIsEditing(false)
  }, [savedValue])

  // 禁用状态
  if (disabled) {
    return (
      <div className="text-sm text-gray-400">
        {displayValue || '-'}
      </div>
    )
  }

  // 编辑模式
  if (isEditing) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          ref={inputRef}
          value={displayValue}
          onChange={(e) => setDisplayValue(e.target.value.trim())}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="输入自定义名称"
          className="h-8 text-sm min-w-[150px]"
          disabled={isSaving}
        />
        {isSaving ? (
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={handleCancel}
            title="取消编辑 (ESC)"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    )
  }

  // 显示模式
  return (
    <div
      className="flex items-center gap-1.5 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5 -mx-1 -my-0.5 min-h-[28px]"
      onClick={handleStartEdit}
      title="点击编辑"
    >
      <span className={`text-sm ${displayValue ? 'text-gray-900' : 'text-gray-400'}`}>
        {displayValue || '点击添加'}
      </span>
    </div>
  )
}
