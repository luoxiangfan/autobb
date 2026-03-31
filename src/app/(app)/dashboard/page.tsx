import DashboardClientPage from './DashboardClientPage'
import { isPerformanceReleaseEnabled } from '@/lib/feature-flags'

export default function DashboardPage() {
  const dashboardDeferEnabled = isPerformanceReleaseEnabled('dashboardDefer')

  return <DashboardClientPage dashboardDeferEnabled={dashboardDeferEnabled} />
}
