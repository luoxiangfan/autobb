/**
 * 广告系列页「关联 Offer 任务」菜单：按任务状态决定暂停或开启
 */

export type OfferTasksToggleAction = 'pause' | 'start'

function normalizeOfferTaskStatus(status: string | null | undefined): string {
  return String(status || '')
    .trim()
    .toLowerCase()
}

/* * 补点击：待执行/运行中 → 需要暂停（已 stopped/paused 跳过） */
export function clickFarmTaskNeedsPause(status: string | null | undefined): boolean {
  const normalized = normalizeOfferTaskStatus(status)
  return normalized === 'pending' || normalized === 'running'
}

/* * 换链接：运行中 → 需要禁用（已 disabled / 失败 error 走开启流程） */
export function urlSwapTaskNeedsPause(status: string | null | undefined): boolean {
  return normalizeOfferTaskStatus(status) === 'enabled'
}

/* * 补点击：无任务 / 已完成 / 已停止 / 已暂停 → 需要开启或重建 */
export function clickFarmTaskNeedsStart(status: string | null | undefined): boolean {
  const normalized = normalizeOfferTaskStatus(status)
  if (!normalized) return true
  return normalized === 'completed' || normalized === 'stopped' || normalized === 'paused'
}

/* * 换链接：无任务 / 已完成 / 已禁用 / 失败 → 需要开启或重建 */
export function urlSwapTaskNeedsStart(status: string | null | undefined): boolean {
  const normalized = normalizeOfferTaskStatus(status)
  if (!normalized) return true
  return normalized === 'completed' || normalized === 'disabled' || normalized === 'error'
}

/**
 * 菜单与确认弹窗动作
 * 存在非完成且非失败的活跃任务 → 暂停
 * 否则 → 按默认配置恢复/新建
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

export function campaignHasBoundOffer(offerId: number | null | undefined): boolean {
  const id = Number(offerId)
  return Number.isFinite(id) && id > 0
}

export function isCampaignEnabled(status: string | null | undefined): boolean {
  return (
    String(status || '')
      .trim()
      .toUpperCase() === 'ENABLED'
  )
}

/* * 是否展示「补点击任务 / 换链接任务」单独入口（暂停中的广告系列不展示） */
export function shouldShowIndividualOfferTaskMenuItems(
  campaignStatus: string | null | undefined
): boolean {
  return (
    String(campaignStatus || '')
      .trim()
      .toUpperCase() !== 'PAUSED'
  )
}

/* * 是否展示「暂停/开启关联 Offer 任务」菜单项 */
export function shouldShowOfferTasksMenuItem(params: {
  offerId: number | null | undefined
  campaignStatus: string | null | undefined
  action: OfferTasksToggleAction
}): boolean {
  if (!campaignHasBoundOffer(params.offerId)) return false
  if (params.action === 'start' && !isCampaignEnabled(params.campaignStatus)) return false
  return true
}
