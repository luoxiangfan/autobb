import { withAuth } from '@/lib/auth'
import { handleCampaignPerformanceGet } from '@/lib/campaign/performance/handle-campaign-performance-get'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request, user) => handleCampaignPerformanceGet(request, user))
