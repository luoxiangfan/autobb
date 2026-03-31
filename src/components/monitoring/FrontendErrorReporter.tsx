'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

type FrontendErrorReporterProps = {
  enabled: boolean
  buildId: string
  flagSnapshot: string
}

const FRONTEND_ERROR_ENDPOINT = '/api/monitoring/frontend-errors'
const DEDUPE_WINDOW_MS = 10_000

function sendError(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload)

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const accepted = navigator.sendBeacon(
      FRONTEND_ERROR_ENDPOINT,
      new Blob([body], { type: 'application/json' })
    )
    if (accepted) return
  }

  void fetch(FRONTEND_ERROR_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body,
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => {})
}

export default function FrontendErrorReporter({ enabled, buildId, flagSnapshot }: FrontendErrorReporterProps) {
  const pathname = usePathname() || '/'
  const recentErrorRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (!enabled) return

    const shouldReport = (key: string) => {
      const now = Date.now()
      const lastReported = recentErrorRef.current.get(key) || 0
      if (now - lastReported < DEDUPE_WINDOW_MS) return false
      recentErrorRef.current.set(key, now)
      return true
    }

    const handleError = (event: ErrorEvent) => {
      const name = event.error?.name || 'Error'
      const message = event.error?.message || event.message || 'Unknown error'
      const key = `error:${name}:${message}:${pathname}`
      if (!shouldReport(key)) return

      sendError({
        type: 'error',
        name,
        message,
        stack: event.error?.stack,
        path: pathname,
        buildId,
        flagSnapshot,
        ts: Date.now(),
      })
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const name =
        typeof reason === 'object' && reason && 'name' in reason
          ? String((reason as { name?: unknown }).name || 'UnhandledRejection')
          : 'UnhandledRejection'
      const message =
        typeof reason === 'object' && reason && 'message' in reason
          ? String((reason as { message?: unknown }).message || 'Unhandled promise rejection')
          : String(reason || 'Unhandled promise rejection')
      const stack =
        typeof reason === 'object' && reason && 'stack' in reason
          ? String((reason as { stack?: unknown }).stack || '')
          : undefined

      const key = `unhandledrejection:${name}:${message}:${pathname}`
      if (!shouldReport(key)) return

      sendError({
        type: 'unhandledrejection',
        name,
        message,
        stack,
        path: pathname,
        buildId,
        flagSnapshot,
        ts: Date.now(),
      })
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [enabled, pathname, buildId, flagSnapshot])

  return null
}
