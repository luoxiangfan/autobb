import DashboardClientPage from './DashboardClientPage'
import { isPerformanceReleaseEnabled } from '@/lib/common'

export default function DashboardPage() {
  const dashboardDeferEnabled = isPerformanceReleaseEnabled('dashboardDefer')

  return <DashboardClientPage dashboardDeferEnabled={dashboardDeferEnabled} />
}
