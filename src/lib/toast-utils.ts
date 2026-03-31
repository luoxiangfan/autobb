'use client'

/**
 * Toast 通知工具函数
 * 统一的通知系统，用于替换所有原生 alert
 */

import { toast } from 'sonner'

/**
 * 成功通知
 */
export function showSuccess(message: string, description?: string) {
  toast.success(message, {
    description,
    duration: 3000,
  })
}

/**
 * 错误通知
 */
export function showError(message: string, description?: string) {
  toast.error(message, {
    description,
    duration: 4000,
  })
}

/**
 * 警告通知
 */
export function showWarning(message: string, description?: string) {
  toast.warning(message, {
    description,
    duration: 3500,
  })
}

/**
 * 信息通知
 */
export function showInfo(message: string, description?: string) {
  toast.info(message, {
    description,
    duration: 3000,
  })
}

/**
 * 加载中通知（返回 ID 用于后续更新或关闭）
 */
export function showLoading(message: string) {
  return toast.loading(message)
}

/**
 * Promise 通知（自动处理加载、成功、失败状态）
 */
export function showPromise<T>(
  promise: Promise<T>,
  messages: {
    loading: string
    success: string | ((data: T) => string)
    error: string | ((error: Error) => string)
  }
) {
  return toast.promise(promise, messages)
}

/**
 * 确认对话框（需要用户确认的操作）
 * 注意：Sonner 不支持原生确认对话框，这个需要用 AlertDialog 组件
 * 这里提供一个辅助函数，返回一个 Promise
 */
export async function showConfirm(
  title: string,
  description: string
): Promise<boolean> {
  // 这个需要配合 AlertDialog 组件使用
  // 暂时返回 true，后续需要实现完整的确认对话框
  console.warn('showConfirm 需要配合 AlertDialog 组件实现')
  return window.confirm(`${title}\n${description}`)
}
