import type { GoogleAdsCampaignRemoteActionSummary } from '@/lib/google-ads/campaign/remote-actions'

export function buildDeleteAccountApiWarnings(
  shouldRemoveRemote: boolean,
  googleAds: GoogleAdsCampaignRemoteActionSummary,
  options?: { localDeleted?: boolean }
): string[] | undefined {
  if (!shouldRemoveRemote) {
    return undefined
  }

  const localDeleted = options?.localDeleted !== false
  const localPrefix = localDeleted ? '本地账号已删除，但' : '本地账号删除失败；'

  const warnings: string[] = []

  if (!localDeleted) {
    warnings.push('本地账号删除失败；请检查远端操作结果与 failures 明细')
  }

  if (googleAds.skipReason === 'ACCOUNT_INELIGIBLE') {
    warnings.push(`${localPrefix}远端未执行（账号缺少 customer_id 或不可用）`)
  }

  if (googleAds.skipReason === 'CREDENTIALS_MISSING') {
    warnings.push(`${localPrefix}远端未执行（缺少 Google Ads 认证凭证）`)
  }

  if (googleAds.truncated > 0) {
    warnings.push(
      `共 ${googleAds.planned + googleAds.truncated} 个可删远端广告系列，受单次上限 ${googleAds.maxCampaigns} 限制，仅处理前 ${googleAds.planned} 个（其余仅本地删除）`
    )
  }

  if (googleAds.timedOut) {
    warnings.push('远端批处理触发整体超时，未完成的广告系列见 failures 明细')
  }

  const partialFailure =
    googleAds.executed &&
    googleAds.planned > 0 &&
    googleAds.removed + googleAds.pausedFallback < googleAds.planned &&
    (googleAds.failed > 0 || googleAds.failures.length > 0)

  if (partialFailure) {
    warnings.push('部分 Google Ads 远端广告系列删除失败，请查看 failures 明细')
  }

  const globalFailure =
    googleAds.executed &&
    googleAds.planned > 0 &&
    googleAds.removed + googleAds.pausedFallback === 0 &&
    googleAds.failures.length > 0

  if (globalFailure) {
    warnings.push('Google Ads 远端操作未成功，请查看 failures 明细')
  }

  return warnings.length > 0 ? warnings : undefined
}
