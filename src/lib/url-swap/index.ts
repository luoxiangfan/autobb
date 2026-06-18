/**
 * Url-swap public API barrel.
 */
export type { UrlSwapErrorType } from './url-swap-types'

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

export { getUrlSwapTaskStats, getUrlSwapUserStats, getUrlSwapGlobalStats } from './url-swap-stats'
