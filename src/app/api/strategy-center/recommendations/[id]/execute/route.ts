import { resolveStrategyCenterRequestUser } from '@/lib/openclaw/gateway/request-auth'
import { createStrategyRecommendationExecuteHandler } from '@/lib/openclaw/strategy/strategy-recommendations-route-handlers'

export const dynamic = 'force-dynamic'

export const POST = createStrategyRecommendationExecuteHandler({
  resolveRequestUser: resolveStrategyCenterRequestUser,
  unauthorizedError: '策略中心功能未开启或未授权',
})
