import { withAuth } from '@/lib/auth'
import { handleCampaignPublishPost } from '@/lib/campaign/publish/handle-campaign-publish-post'

export const POST = withAuth(async (request, user) => handleCampaignPublishPost(request, user))
