import OffersClientPage from './OffersClientPage'
import { isPerformanceReleaseEnabled } from '@/lib/feature-flags'

export default function OffersPage() {
  const offersIncrementalPollEnabled = isPerformanceReleaseEnabled('offersIncrementalPoll')
  const offersServerPagingEnabled = isPerformanceReleaseEnabled('offersServerPaging')

  return (
    <OffersClientPage
      offersIncrementalPollEnabled={offersIncrementalPollEnabled}
      offersServerPagingEnabled={offersServerPagingEnabled}
    />
  )
}
