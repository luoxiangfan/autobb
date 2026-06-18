/**
 * Shared background task executor registration.
 * Used by web queue (when split allows) and the dedicated background worker process.
 */
import type { UnifiedQueueManager } from '../unified-queue-manager'
import { executeClickFarmTriggerTask } from './click-farm-trigger-executor'
import { executeClickFarmBatchTask } from './click-farm-batch-executor'
import { createClickFarmExecutor } from './click-farm-executor'
import { executeUrlSwapTask } from './url-swap-executor'
import { executeOpenclawStrategy } from './openclaw-strategy-executor'
import { executeAffiliateProductSync } from './affiliate-product-sync-executor'
import { executeOpenclawAffiliateSync } from './openclaw-affiliate-sync-executor'
import { executeOpenclawReportSend } from './openclaw-report-send-executor'
import { executeProductScoreCalculation } from './product-score-calculation-executor'
import { executeGoogleAdsCampaignSyncTask } from './google-ads-campaign-sync-executor'
import { executeCampaignBatchCreate } from './campaign-batch-create-executor'

export function registerSharedBackgroundExecutors(queue: UnifiedQueueManager): void {
  queue.registerExecutor('click-farm-trigger', executeClickFarmTriggerTask)
  queue.registerExecutor('click-farm-batch', executeClickFarmBatchTask)
  queue.registerExecutor('click-farm', createClickFarmExecutor())
  queue.registerExecutor('url-swap', executeUrlSwapTask)
  queue.registerExecutor('openclaw-strategy', executeOpenclawStrategy)
  queue.registerExecutor('affiliate-product-sync', executeAffiliateProductSync)
  queue.registerExecutor('openclaw-affiliate-sync', executeOpenclawAffiliateSync)
  queue.registerExecutor('openclaw-report-send', executeOpenclawReportSend)
  queue.registerExecutor('product-score-calculation', executeProductScoreCalculation)
  queue.registerExecutor('@/lib/google-ads/campaign/sync', executeGoogleAdsCampaignSyncTask)
  queue.registerExecutor('campaign-batch-create', executeCampaignBatchCreate)
}
