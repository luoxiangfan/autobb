import { resolveStrategyCenterRequestUser } from '@/lib/openclaw/gateway/request-auth'
import { createStrategyRecommendationDismissHandler } from '@/lib/openclaw/strategy/strategy-recommendations-route-handlers'

export const dynamic = 'force-dynamic'

export const POST = createStrategyRecommendationDismissHandler({
  resolveRequestUser: resolveStrategyCenterRequestUser,
  unauthorizedError: '策略中心功能未开启或未授权',
})
