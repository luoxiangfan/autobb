'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

/**
 * 网络状态类型
 */
type NetworkStatus = 'online' | 'offline' | 'reconnecting'

/**
 * 网络状态Hook
 */
export function useNetworkStatus() {
  const [status, setStatus] = useState<NetworkStatus>('online')
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    // 初始化状态
    setIsOnline(navigator.onLine)
    setStatus(navigator.onLine ? 'online' : 'offline')

    const handleOnline = () => {
      setIsOnline(true)
      setStatus('online')
    }

    const handleOffline = () => {
      setIsOnline(false)
      setStatus('offline')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { status, isOnline }
}

/**
 * 网络离线提示Toast组件
 * 当检测到离线状态时自动显示
 */
export function NetworkOfflineToast() {
  const { status, isOnline } = useNetworkStatus()
  const [hasShown, setHasShown] = useState(false)

  useEffect(() => {
    if (!isOnline && !hasShown) {
      toast.error('网络连接断开，请检查您的网络连接', {
        duration: Infinity, // 不自动消失
        action: {
          label: '重试',
          onClick: () => window.location.reload(),
        },
      })
      setHasShown(true)
    } else if (isOnline && hasShown) {
      // 恢复连接后更新toast
      toast.success('网络连接已恢复')
      setHasShown(false)
    }
  }, [isOnline, hasShown])

  return null
}

/**
 * 网络状态横幅组件
 * 固定在页面顶部
 */
export function NetworkStatusBanner() {
  const { status, isOnline } = useNetworkStatus()

  if (isOnline) {
    return null
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-500 text-white px-4 py-2 flex items-center justify-center gap-2 animate-in slide-in-from-top">
      <WifiOff className="h-4 w-4" />
      <span className="text-sm font-medium">网络连接断开，请检查网络设置</span>
    </div>
  )
}

/**
 * 离线页面组件
 * 当检测到离线状态时显示
 */
export function OfflinePage() {
  const { status, isOnline } = useNetworkStatus()
  const [retrying, setRetrying] = useState(false)

  const handleRetry = useCallback(() => {
    setRetrying(true)
    // 延迟重试，模拟网络恢复
    setTimeout(() => {
      if (navigator.onLine) {
        window.location.reload()
      } else {
        setRetrying(false)
      }
    }, 2000)
  }, [])

  if (isOnline) {
    return null
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-4 p-8">
        <div className="mx-auto w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
          <WifiOff className="h-8 w-8 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">网络连接断开</h1>
        <p className="text-slate-500 max-w-sm">
          请检查您的网络连接，然后点击下方按钮重试
        </p>
        <div className="pt-4">
          <Button
            onClick={handleRetry}
            disabled={retrying}
            className="gap-2"
          >
            {retrying ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                正在重试...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                重试
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * 带有网络状态检测的API请求Hook
 */
export function useApiWithNetworkCheck() {
  const { isOnline } = useNetworkStatus()
  const [error, setError] = useState<Error | null>(null)

  const fetchWithCheck = useCallback(async <T,>(
    url: string,
    options?: RequestInit
  ): Promise<T | null> => {
    if (!isOnline) {
      setError(new Error('网络连接已断开'))
      return null
    }

    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      setError(null)
      return response.json()
    } catch (err) {
      setError(err as Error)
      return null
    }
  }, [isOnline])

  return { fetchWithCheck, error, isOnline }
}

/**
 * 自动重连组件
 * 当网络恢复时自动重试失败的请求
 */
export function AutoReconnect({
  onReconnect,
  children,
}: {
  onReconnect?: () => void
  children: React.ReactNode
}) {
  const { status, isOnline } = useNetworkStatus()
  const prevStatus = useRef(status)

  useEffect(() => {
    // 检测从离线到在线的转换
    if (prevStatus.current === 'offline' && status === 'online') {
      onReconnect?.()
    }
    prevStatus.current = status
  }, [status, onReconnect])

  return <>{children}</>
}
