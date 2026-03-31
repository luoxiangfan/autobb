'use client'

import { usePathname } from 'next/navigation'
import { useReportWebVitals } from 'next/web-vitals'

type WebVitalsReporterProps = {
  enabled: boolean
  buildId: string
  flagSnapshot: string
}

type WebVitalMetric = {
  id: string
  name: string
  value: number
  delta: number
  rating?: 'good' | 'needs-improvement' | 'poor'
  navigationType?: string
}

const WEB_VITALS_ENDPOINT = '/api/monitoring/web-vitals'

function reportMetric(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload)

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const accepted = navigator.sendBeacon(
      WEB_VITALS_ENDPOINT,
      new Blob([body], { type: 'application/json' })
    )
    if (accepted) return
  }

  void fetch(WEB_VITALS_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body,
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => {})
}

export default function WebVitalsReporter({ enabled, buildId, flagSnapshot }: WebVitalsReporterProps) {
  const pathname = usePathname() || '/'

  useReportWebVitals((metric: WebVitalMetric) => {
    if (!enabled) return

    reportMetric({
      id: metric.id,
      name: metric.name,
      value: metric.value,
      delta: metric.delta,
      rating: metric.rating,
      navigationType: metric.navigationType,
      path: pathname,
      buildId,
      flagSnapshot,
      ts: Date.now(),
    })
  })

  return null
}
