/**
 * Url-swap public API barrel.
 */
export type {
  UrlSwapErrorType,
  SwapHistorySitelinkUpdate,
  UrlSwapSitelinkTarget,
} from './url-swap-types'

export {
  parseUrlSwapTask,
  normalizeManualAffiliateLinks,
  normalizeNullableString,
  normalizeUrlSwapMode,
} from './url-swap-row'

export {
  getOfferById,
  getOfferCampaignTargets,
  findGoogleAdsAccountIdByCustomerId,
  type UrlSwapTargetInput,
} from './url-swap-offer-lookup'

export {
  getUrlSwapTaskById,
  getUrlSwapTaskByOfferId,
  hasUrlSwapTask,
  getUrlSwapTasks,
  getPendingTasks,
  getAllUrlSwapTasks,
} from './url-swap-queries'

export {
  getUrlSwapTaskTargets,
  ensureUrlSwapTaskTargets,
  addUrlSwapTargetForOfferCampaign,
  refreshUrlSwapTaskTargets,
  resolveCampaignTargetsForSitelinkBackfill,
  markUrlSwapTargetSuccess,
  markUrlSwapTargetFailure,
  pauseUrlSwapTargetsByTaskId,
  pauseUrlSwapTargetsByOfferId,
  pauseUrlSwapTargetsByUserIds,
  markUrlSwapTargetsRemovedByCampaignId,
  markUrlSwapTargetsRemovedByOfferAccount,
  markUrlSwapTargetsRemovedByOfferId,
} from './url-swap-targets'

export {
  createUrlSwapTask,
  updateUrlSwapTask,
  disableUrlSwapTask,
  enableUrlSwapTask,
  setTaskError,
  updateTaskStatus,
  recordSwapHistory,
  updateTaskAfterSwap,
  updateTaskAfterManualAdvance,
} from './url-swap-task-lifecycle'

export {
  syncUrlSwapSitelinkTargetsAfterPublish,
  loadOfferStoreProductLinksForUrlSwap,
  getActiveUrlSwapSitelinkTargets,
  getUrlSwapSitelinkTargets,
  markUrlSwapSitelinkTargetSuccess,
  markUrlSwapSitelinkTargetFailure,
  pauseUrlSwapSitelinkTargetsByTaskId,
  resumeUrlSwapSitelinkTargetsByTaskId,
  resolveUrlSwapSitelinkTargetStatusForTaskStatus,
  type UrlSwapSitelinkTargetStatus,
} from './url-swap-sitelink-targets'

export {
  runUrlSwapSitelinkSuffixPhase,
  mergeSitelinkPhaseIntoHistory,
  shouldRunUrlSwapSitelinkPhase,
  emptyUrlSwapSitelinkPhaseResult,
  URL_SWAP_SITELINK_ENABLED,
  type UrlSwapSitelinkPhaseResult,
} from './url-swap-sitelink-updater'

export {
  backfillUrlSwapSitelinkTargets,
  type BackfillUrlSwapSitelinkTargetsOptions,
  type BackfillUrlSwapSitelinkTargetsResult,
} from './backfill-sitelink-targets'

export {
  syncStoreSitelinkTargetsForOffer,
  type SyncStoreSitelinkTargetsForOfferResult,
} from './sync-store-sitelink-targets'

export {
  reconcileUrlSwapSitelinkAffiliateLinks,
  resolveAffiliateLinkForSitelinkTarget,
  type ReconcileUrlSwapSitelinkAffiliateLinksResult,
} from './reconcile-sitelink-affiliate-links'

export {
  removePendingUrlSwapQueueTasksByTaskIds,
  suspendUrlSwapTaskChildTargets,
  suspendUrlSwapTaskExecution,
} from './queue-cleanup'

export { getUrlSwapTaskStats, getUrlSwapUserStats, getUrlSwapGlobalStats } from './url-swap-stats'
