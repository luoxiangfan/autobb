'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { showInfo } from '@/lib/toast-utils'
import { GOOGLE_ADS_CAMPAIGN_PIPELINE_IDLE_EVENT } from '@/lib/google-ads-campaign-sync-events'

type SsePayload =
  | { type: 'hello'; busy: boolean; ts: number }
  | { type: 'status'; busy: boolean; pending: number; running: number; ts: number }
  | { type: 'pipeline_idle'; ts: number }
  | { type: 'end'; reason: string; ts: number }

/**
 * 在已登录应用壳内维持一条 SSE，用于 Google Ads 广告系列同步管线完成时：
 * - 派发 `GOOGLE_ADS_CAMPAIGN_PIPELINE_IDLE_EVENT`（广告系列页监听并刷新列表）
 * - 非广告系列页时 toast 提示
 */
export function GoogleAdsCampaignSyncSseBridge() {
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const run = async () => {
      try {
        const response = await fetch('/api/sync/google-ads-campaign-sse', {
          credentials: 'include',
          signal: ac.signal,
        })
        if (!response.ok) return
        if (!response.body) return

        const reader = response.body.getReader()
        readerRef.current = reader
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() || ''
          for (const raw of parts) {
            const line = raw.trim()
            if (!line.startsWith('data: ')) continue
            let data: SsePayload
            try {
              data = JSON.parse(line.slice(6)) as SsePayload
            } catch {
              continue
            }
            if (data.type === 'pipeline_idle') {
              window.dispatchEvent(new CustomEvent(GOOGLE_ADS_CAMPAIGN_PIPELINE_IDLE_EVENT))
              const onCampaigns = pathnameRef.current?.startsWith('/campaigns') === true
              if (!onCampaigns) {
                showInfo('广告系列', 'Google Ads 同步已完成，可在广告系列页查看最新数据')
              }
            }
          }
        }
      } catch {
        /* 取消或网络错误 */
      } finally {
        readerRef.current = null
        if (!ac.signal.aborted) {
          reconnectTimer = setTimeout(() => {
            void run()
          }, 4000)
        }
      }
    }

    void run()

    return () => {
      ac.abort()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      readerRef.current?.cancel().catch(() => {})
    }
  }, [])

  return null
}
