import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getGoogleAdsCampaignSyncPipelineSnapshot } from '@/lib/google-ads/campaign/sync-pipeline-status'

const POLL_MS = 2000
const STREAM_MAX_MS = 20 * 60 * 1000

/**
 * GET /api/sync/google-ads-campaign-sse
 * SSE：轮询队列 + sync_logs，在 Google Ads 广告系列同步管线从「忙」→「闲」时推送 `pipeline_idle`。
 * 需登录 Cookie；与 status-v2 数据源一致。
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        let pollInterval: ReturnType<typeof setInterval> | null = null
        let maxTimer: ReturnType<typeof setTimeout> | null = null

        const onAbort = () => {
          if (pollInterval) {
            clearInterval(pollInterval)
            pollInterval = null
          }
          if (maxTimer) {
            clearTimeout(maxTimer)
            maxTimer = null
          }
          request.signal.removeEventListener('abort', onAbort)
          try {
            controller.close()
          } catch {
            /* ignore */
          }
        }

        const cleanup = () => {
          if (pollInterval) {
            clearInterval(pollInterval)
            pollInterval = null
          }
          if (maxTimer) {
            clearTimeout(maxTimer)
            maxTimer = null
          }
          request.signal.removeEventListener('abort', onAbort)
        }

        let prevBusy = (await getGoogleAdsCampaignSyncPipelineSnapshot()).busy
        send({ type: 'hello', busy: prevBusy, ts: Date.now() })

        const poll = async () => {
          try {
            const snap = await getGoogleAdsCampaignSyncPipelineSnapshot()
            send({
              type: 'status',
              busy: snap.busy,
              pending: snap.pending,
              running: snap.running,
              ts: Date.now(),
            })
            if (prevBusy && !snap.busy) {
              send({ type: 'pipeline_idle', ts: Date.now() })
            }
            prevBusy = snap.busy
          } catch (e) {
            console.warn('[google-ads-campaign-sse] poll error:', e)
          }
        }

        await poll()
        pollInterval = setInterval(() => {
          void poll()
        }, POLL_MS)

        maxTimer = setTimeout(() => {
          cleanup()
          send({ type: 'end', reason: 'max_duration', ts: Date.now() })
          try {
            controller.close()
          } catch {
            /* ignore */
          }
        }, STREAM_MAX_MS)

        request.signal.addEventListener('abort', onAbort)
      },
    })

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error: any) {
    console.error('[google-ads-campaign-sse] error:', error)
    return NextResponse.json({ error: error.message || 'SSE 初始化失败' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300
