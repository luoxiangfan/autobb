/**
 * 队列任务执行器注册
 *
 * 在队列系统初始化时注册所有任务执行器
 */

import type { UnifiedQueueManager } from '../unified-queue-manager'
import { createScrapeExecutor, convertPriorityToEnum } from './scrape-executor'
import { createSyncExecutor } from './sync-executor'
import { createAIAnalysisExecutor } from './ai-analysis-executor'
import { createBackupExecutor } from './backup-executor'
import { createExportExecutor } from './export-executor'
import { createEmailExecutor } from './email-executor'
import { createLinkCheckExecutor } from './link-check-executor'
import { createCleanupExecutor } from './cleanup-executor'
import { executeOfferExtraction } from './offer-extraction-executor'
import { executeBatchCreation } from './batch-creation-executor'
import { executeAdCreativeGeneration } from './ad-creative-executor'
import { executeCampaignPublish } from './campaign-publish-executor'
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
import { logger } from '@/lib/structured-logger'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

function isEnvTrue(value?: string | null): boolean {
  if (!value) return false
  return TRUE_VALUES.has(value.toLowerCase())
}

function shouldRegisterBackgroundExecutors(): { allowed: boolean; reason: string } {
  const splitFlag = isEnvTrue(process.env.QUEUE_SPLIT_BACKGROUND)
  const isBackgroundWorker = isEnvTrue(process.env.QUEUE_BACKGROUND_WORKER)
  const override = isEnvTrue(process.env.QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB)

  if (!splitFlag) {
    return { allowed: true, reason: 'split_disabled' }
  }
  if (isBackgroundWorker) {
    return { allowed: true, reason: 'background_worker' }
  }
  if (override) {
    return { allowed: true, reason: 'override' }
  }
  return { allowed: false, reason: 'split_enabled_non_worker' }
}

/**
 * 注册所有任务执行器
 */
export function registerAllExecutors(queue: UnifiedQueueManager): void {
  // 注册 scrape 执行器
  queue.registerExecutor('scrape', createScrapeExecutor())

  // 注册 sync 执行器
  queue.registerExecutor('sync', createSyncExecutor())

  // 注册 ai-analysis 执行器
  queue.registerExecutor('ai-analysis', createAIAnalysisExecutor())

  // 注册 backup 执行器
  queue.registerExecutor('backup', createBackupExecutor())

  // 注册 export 执行器
  queue.registerExecutor('export', createExportExecutor())

  // 注册 email 执行器
  queue.registerExecutor('email', createEmailExecutor())

  // 注册 link-check 执行器
  queue.registerExecutor('link-check', createLinkCheckExecutor())

  // 注册 cleanup 执行器
  queue.registerExecutor('cleanup', createCleanupExecutor())

  // 注册 offer-extraction 执行器
  queue.registerExecutor('offer-extraction', executeOfferExtraction)

  // 注册 batch-offer-creation 执行器
  queue.registerExecutor('batch-offer-creation', executeBatchCreation)

  // 注册 ad-creative 执行器
  queue.registerExecutor('ad-creative', executeAdCreativeGeneration)

  // 🆕 注册 campaign-publish 执行器（异步Campaign发布，避免504超时）
  queue.registerExecutor('campaign-publish', executeCampaignPublish)

  // OpenClaw 指令是用户交互主链路，始终在 core 队列可执行；
  // 当 split 模式下 background worker 离线时，可回退到 core 执行避免任务卡死。
  queue.registerExecutor('openclaw-command', executeOpenclawCommandTask)

  const backgroundDecision = shouldRegisterBackgroundExecutors()
  if (backgroundDecision.allowed) {
    // 🆕 注册 click-farm 执行器（补点击任务，带代理和超时控制）
    queue.registerExecutor('click-farm-trigger', executeClickFarmTriggerTask)
    queue.registerExecutor('click-farm-batch', executeClickFarmBatchTask)
    queue.registerExecutor('click-farm', createClickFarmExecutor())

    // 🆕 注册 url-swap 执行器（换链接任务，监测和更新广告链接）
    queue.registerExecutor('url-swap', executeUrlSwapTask)

    // 🆕 注册 openclaw-strategy 执行器（OpenClaw策略）
    queue.registerExecutor('openclaw-strategy', executeOpenclawStrategy)

    // 🆕 注册 affiliate-product-sync 执行器（联盟商品同步）
    queue.registerExecutor('affiliate-product-sync', executeAffiliateProductSync)

    // 🆕 注册 openclaw-affiliate-sync 执行器（OpenClaw 联盟佣金快照同步）
    queue.registerExecutor('openclaw-affiliate-sync', executeOpenclawAffiliateSync)

    // 🆕 注册 openclaw-report-send 执行器（OpenClaw 每日报表投递）
    queue.registerExecutor('openclaw-report-send', executeOpenclawReportSend)

    // 🆕 注册 product-score-calculation 执行器（商品推荐指数计算）
    queue.registerExecutor('product-score-calculation', executeProductScoreCalculation)
  } else {
    logger.warn('queue_background_executors_skipped', {
      reason: backgroundDecision.reason,
      splitFlag: isEnvTrue(process.env.QUEUE_SPLIT_BACKGROUND),
      backgroundWorker: isEnvTrue(process.env.QUEUE_BACKGROUND_WORKER),
      override: isEnvTrue(process.env.QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB),
    })
  }
}

/**
 * 注册后台任务执行器（非核心任务）
 *
 * 用于独立 background worker：只加载必要执行器，减少内存占用并降低对核心任务的干扰。
 */
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
}

export { createScrapeExecutor, convertPriorityToEnum } from './scrape-executor'
export { createSyncExecutor } from './sync-executor'
export { createAIAnalysisExecutor } from './ai-analysis-executor'
export { createBackupExecutor } from './backup-executor'
export { createExportExecutor } from './export-executor'
export { createEmailExecutor } from './email-executor'
export { createLinkCheckExecutor } from './link-check-executor'
export { createCleanupExecutor } from './cleanup-executor'
export type { ScrapeTaskData } from './scrape-executor'
export type { SyncTaskData } from './sync-executor'
export type { AIAnalysisTaskData } from './ai-analysis-executor'
export type { BackupTaskData } from './backup-executor'
export type { ExportTaskData } from './export-executor'
export type { EmailTaskData } from './email-executor'
export type { LinkCheckTaskData } from './link-check-executor'
export type { CleanupTaskData } from './cleanup-executor'
export type { AdCreativeTaskData } from './ad-creative-executor'
export type { CampaignPublishTaskData } from './campaign-publish-executor'
export type { ClickFarmTaskData } from './click-farm-executor'
export type { ClickFarmTriggerTaskData, ClickFarmBatchTaskData } from '@/lib/click-farm/queue-task-types'
export type { UrlSwapTaskData } from './url-swap-executor'
export type { AffiliateProductSyncTaskData } from './affiliate-product-sync-executor'
export type { OpenclawCommandTaskData } from './openclaw-command-executor'
export type { OpenclawAffiliateSyncTaskData } from './openclaw-affiliate-sync-executor'
export type { OpenclawReportSendTaskData } from './openclaw-report-send-executor'
export type { ProductScoreCalculationTaskData } from './product-score-calculation-executor'
