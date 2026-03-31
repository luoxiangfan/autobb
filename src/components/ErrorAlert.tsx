/**
 * 错误提示组件
 *
 * 功能：
 * - 显示用户友好的错误消息
 * - 支持重试操作
 * - 支持跳转到相关设置页面
 * - 可关闭的错误提示
 */

'use client'

import React from 'react'
import { ParsedError } from '@/lib/error-handler'
import { XMarkIcon, ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'

export interface ErrorAlertProps {
  error: ParsedError | null
  onClose?: () => void
  onRetry?: () => void
  className?: string
}

/**
 * 错误提示组件
 *
 * @example
 * ```tsx
 * const [error, setError] = useState<ParsedError | null>(null)
 *
 * async function handleSubmit() {
 *   const response = await fetch('/api/offers/1/generate-ad-creative', {
 *     method: 'POST',
 *     body: JSON.stringify(data)
 *   })
 *
 *   const parsedError = await parseErrorResponse(response)
 *   if (parsedError) {
 *     setError(parsedError)
 *     return
 *   }
 *
 *   // 成功处理...
 * }
 *
 * return (
 *   <>
 *     <ErrorAlert error={error} onClose={() => setError(null)} onRetry={handleSubmit} />
 *     <button onClick={handleSubmit}>生成广告创意</button>
 *   </>
 * )
 * ```
 */
export function ErrorAlert({ error, onClose, onRetry, className = '' }: ErrorAlertProps) {
  if (!error) {
    return null
  }

  const isWarning = error.code.startsWith('VAL_') || error.code.startsWith('PERM_')
  const bgColor = isWarning ? 'bg-yellow-50' : 'bg-red-50'
  const borderColor = isWarning ? 'border-yellow-400' : 'border-red-400'
  const textColor = isWarning ? 'text-yellow-800' : 'text-red-800'
  const iconColor = isWarning ? 'text-yellow-400' : 'text-red-400'
  const buttonColor = isWarning ? 'text-yellow-500 hover:text-yellow-600' : 'text-red-500 hover:text-red-600'

  // 提取重定向链接（如果有）
  const redirectUrl = error.details?.redirect

  return (
    <div className={`rounded-md ${bgColor} border ${borderColor} p-4 ${className}`}>
      <div className="flex">
        <div className="flex-shrink-0">
          {isWarning ? (
            <ExclamationTriangleIcon className={`h-5 w-5 ${iconColor}`} aria-hidden="true" />
          ) : (
            <InformationCircleIcon className={`h-5 w-5 ${iconColor}`} aria-hidden="true" />
          )}
        </div>
        <div className="ml-3 flex-1">
          <h3 className={`text-sm font-medium ${textColor}`}>{error.userMessage}</h3>

          {error.suggestedAction && (
            <div className={`mt-2 text-sm ${textColor}`}>
              <p>{error.suggestedAction}</p>
            </div>
          )}

          {error.details && !redirectUrl && (
            <div className="mt-2 text-xs opacity-75">
              <details>
                <summary className="cursor-pointer hover:underline">技术详情</summary>
                <pre className="mt-2 whitespace-pre-wrap">
                  {JSON.stringify(error.details, null, 2)}
                </pre>
              </details>
            </div>
          )}

          <div className="mt-4 flex gap-3">
            {onRetry && error.canRetry && (
              <button
                type="button"
                onClick={onRetry}
                className={`text-sm font-medium ${buttonColor} underline transition-colors`}
              >
                {error.retryDelay && error.retryDelay > 5000
                  ? `重试 (建议等待${Math.round(error.retryDelay / 1000)}秒)`
                  : '重试'}
              </button>
            )}

            {redirectUrl && (
              <Link
                href={redirectUrl}
                className={`text-sm font-medium ${buttonColor} underline transition-colors`}
              >
                前往设置
              </Link>
            )}

            {/* 显示错误码（可选） */}
            <span className="text-xs opacity-50">错误码: {error.code}</span>
          </div>
        </div>

        {onClose && (
          <div className="ml-auto pl-3">
            <div className="-mx-1.5 -my-1.5">
              <button
                type="button"
                onClick={onClose}
                className={`inline-flex rounded-md p-1.5 ${buttonColor} focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors`}
              >
                <span className="sr-only">关闭</span>
                <XMarkIcon className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 内联错误消息组件（更简洁的样式）
 *
 * @example
 * ```tsx
 * <InlineError error={error} />
 * ```
 */
export function InlineError({ error, className = '' }: { error: ParsedError | null; className?: string }) {
  if (!error) {
    return null
  }

  const isWarning = error.code.startsWith('VAL_') || error.code.startsWith('PERM_')
  const textColor = isWarning ? 'text-yellow-600' : 'text-red-600'

  return (
    <p className={`text-sm ${textColor} ${className}`}>
      {error.userMessage}
      {error.suggestedAction && (
        <span className="block mt-1 text-xs opacity-75">{error.suggestedAction}</span>
      )}
    </p>
  )
}

/**
 * 错误toast通知组件（需要配合toast库使用）
 *
 * 使用示例（with react-hot-toast）:
 * ```tsx
 * import toast from 'react-hot-toast'
 * import { showErrorNotification } from '@/lib/error-handler'
 *
 * const parsedError = await parseErrorResponse(response)
 * if (parsedError) {
 *   showErrorNotification(parsedError, toast)
 * }
 * ```
 */
