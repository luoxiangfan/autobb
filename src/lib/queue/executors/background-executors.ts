/**
 * 后台队列执行器注册（非核心任务）
 *
 * 注意：该文件刻意只 import 非核心执行器，避免 background worker 进程加载
 * offer-extraction / AI / Playwright 等重依赖，从而降低内存占用与启动时间。
 */

import type { UnifiedQueueManager } from '../unified-queue-manager'
import { executeClickFarmTriggerTask } from './click-farm-trigger-executor'
import { executeClickFarmBatchTask } from './click-farm-batch-executor'
import { createClickFarmExecutor } from './click-farm-executor'
import { executeUrlSwapTask } from './url-swap-executor'
import { executeOpenclawStrategy } from './openclaw-strategy-executor'
import { executeAffiliateProductSync } from './affiliate-product-sync-executor'
import { executeOpenclawCommandTask } from './openclaw-command-executor'
import { executeOpenclawAffiliateSync } from './openclaw-affiliate-sync-executor'
import { executeOpenclawReportSend } from './openclaw-report-send-executor'
import { executeProductScoreCalculation } from './product-score-calculation-executor'
import { executeGoogleAdsCampaignSyncTask } from './google-ads-campaign-sync-executor'

export function registerBackgroundExecutors(queue: UnifiedQueueManager): void {
  queue.registerExecutor('click-farm-trigger', executeClickFarmTriggerTask)
  queue.registerExecutor('click-farm-batch', executeClickFarmBatchTask)
  queue.registerExecutor('click-farm', createClickFarmExecutor())
  queue.registerExecutor('url-swap', executeUrlSwapTask)
  queue.registerExecutor('openclaw-strategy', executeOpenclawStrategy)
  queue.registerExecutor('affiliate-product-sync', executeAffiliateProductSync)
  queue.registerExecutor('openclaw-command', executeOpenclawCommandTask)
  queue.registerExecutor('openclaw-affiliate-sync', executeOpenclawAffiliateSync)
  queue.registerExecutor('openclaw-report-send', executeOpenclawReportSend)
  queue.registerExecutor('product-score-calculation', executeProductScoreCalculation)
  queue.registerExecutor('google-ads-campaign-sync', executeGoogleAdsCampaignSyncTask)
}
