import CampaignsClientPage from './CampaignsClientPage'
import { isPerformanceReleaseEnabled } from '@/lib/feature-flags'

export default function CampaignsPage() {
  const campaignsReqDedupEnabled = isPerformanceReleaseEnabled('campaignsReqDedup')
  const campaignsServerPagingEnabled = isPerformanceReleaseEnabled('campaignsServerPaging')

  return (
    <CampaignsClientPage
      campaignsReqDedupEnabled={campaignsReqDedupEnabled}
      campaignsServerPagingEnabled={campaignsServerPagingEnabled}
    />
  )
}
