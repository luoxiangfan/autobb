/**
 * Click-farm public API barrel.
 */
export type { ClickFarmNotification, ClickFarmNotificationType } from './alerts/notifications'
export type { ClickFarmHealth } from './alerts/monitoring'

export { parseClickFarmTask, calculateMatchRate } from './click-farm-row'

export {
  getClickFarmTaskById,
  getClickFarmTasks,
  getPendingTasks,
  getClickFarmTaskByOfferId,
} from './click-farm-queries'

export {
  createClickFarmTask,
  updateClickFarmTask,
  deleteClickFarmTask,
  stopClickFarmTask,
  restartClickFarmTask,
  pauseClickFarmTask,
  pauseClickFarmTasksByOfferId,
  updateTaskStatus,
} from './click-farm-task-lifecycle'

export {
  getClickFarmStats,
  getAdminClickFarmStats,
  getHourlyDistribution,
  initializeDailyHistory,
  updateTaskStats,
} from './click-farm-stats'

export { getClickFarmHealth, getClickFarmMetricsHistory } from './alerts/monitoring'

export {
  notifyTaskPaused,
  notifyTaskCompleted,
  notifyTaskResumed,
  getUserNotifications,
} from './alerts/notifications'
