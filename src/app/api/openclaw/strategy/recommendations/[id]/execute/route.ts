import { resolveOpenclawRequestUser } from '@/lib/openclaw/gateway/request-auth'
import { createStrategyRecommendationExecuteHandler } from '@/lib/openclaw/strategy/strategy-recommendations-route-handlers'

export const dynamic = 'force-dynamic'

export const POST = createStrategyRecommendationExecuteHandler({
  resolveRequestUser: resolveOpenclawRequestUser,
  unauthorizedError: 'OpenClaw 功能未开启或未授权',
})
