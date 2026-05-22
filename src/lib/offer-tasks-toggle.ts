/**
 * 广告系列页「关联 Offer 任务」菜单：按任务状态决定暂停或开启
 */

export type OfferTasksToggleAction = 'pause' | 'start'

export function normalizeOfferTaskStatus(status: string | null | undefined): string {
  return String(status || '').trim().toLowerCase()
}

/** 补点击：待执行/运行中 → 需要暂停（已 stopped/paused 跳过） */
export function clickFarmTaskNeedsPause(status: string | null | undefined): boolean {
  const normalized = normalizeOfferTaskStatus(status)
  return normalized === 'pending' || normalized === 'running'
}

/** 换链接：运行中 → 需要禁用（已 disabled / 失败 error 走开启流程） */
export function urlSwapTaskNeedsPause(status: string | null | undefined): boolean {
  return normalizeOfferTaskStatus(status) === 'enabled'
}

/** 补点击：无任务 / 已完成 / 已停止 / 已暂停 → 需要开启或重建 */
export function clickFarmTaskNeedsStart(status: string | null | undefined): boolean {
  const normalized = normalizeOfferTaskStatus(status)
  if (!normalized) return true
  return normalized === 'completed' || normalized === 'stopped' || normalized === 'paused'
}

/** 换链接：无任务 / 已完成 / 已禁用 / 失败 → 需要开启或重建 */
export function urlSwapTaskNeedsStart(status: string | null | undefined): boolean {
  const normalized = normalizeOfferTaskStatus(status)
  if (!normalized) return true
  return normalized === 'completed' || normalized === 'disabled' || normalized === 'error'
}

/**
 * 菜单与确认弹窗动作：
 * - 存在非完成且非失败的活跃任务 → 暂停
 * - 否则 → 按默认配置恢复/新建
 */
export function resolveOfferTasksToggleAction(
  clickFarmStatus: string | null | undefined,
  urlSwapStatus: string | null | undefined
): OfferTasksToggleAction {
  if (clickFarmTaskNeedsPause(clickFarmStatus) || urlSwapTaskNeedsPause(urlSwapStatus)) {
    return 'pause'
  }
  return 'start'
}

export function getOfferTasksMenuLabel(action: OfferTasksToggleAction): string {
  return action === 'pause' ? '暂停关联 Offer 任务' : '开启关联 Offer 任务'
}
