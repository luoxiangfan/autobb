import { NextRequest } from 'next/server'
import { POST as postStrategyRecommendations } from '@/app/api/openclaw/strategy/recommendations/route'

export const dynamic = 'force-dynamic'

// 兼容旧入口：统一复用 recommendations 的手动分析实现，避免逻辑分叉。
export async function POST(request: NextRequest) {
  const response = await postStrategyRecommendations(request)
  response.headers.set('X-OpenClaw-Deprecated', 'true')
  response.headers.set(
    'X-OpenClaw-Deprecated-Message',
    '/api/openclaw/strategy/run is deprecated; use /api/openclaw/strategy/recommendations'
  )
  return response
}
