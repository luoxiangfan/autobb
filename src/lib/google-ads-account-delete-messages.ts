import type { GoogleAdsCampaignRemoteActionSummary } from './google-ads-campaign-remote-actions'

export function buildDeleteAccountRemoteMessage(
  removeRemote: boolean,
  googleAds?: GoogleAdsCampaignRemoteActionSummary
): { tone: 'success' | 'warning'; message: string } {
  if (!removeRemote) {
    return { tone: 'success', message: '仅删除本地记录，未操作 Google Ads 远端' }
  }

  if (!googleAds) {
    return { tone: 'success', message: '本地已删除' }
  }

  if (googleAds.skipReason === 'NO_CAMPAIGNS') {
    return { tone: 'success', message: '本地已删除；该账号下没有可同步的远端广告系列' }
  }

  if (googleAds.skipReason === 'ACCOUNT_INELIGIBLE') {
    return {
      tone: 'warning',
      message: '本地已删除；远端未执行（账号缺少 customer_id 或不可用）',
    }
  }

  if (googleAds.skipReason === 'CREDENTIALS_MISSING') {
    return {
      tone: 'warning',
      message: '本地已删除；远端未执行（缺少 Google Ads OAuth 凭证）',
    }
  }

  if (googleAds.truncated > 0) {
    const truncateNote = `受单次上限 ${googleAds.maxCampaigns} 限制，仅远端处理 ${googleAds.planned} 个（另有 ${googleAds.truncated} 个仅本地删除）`
    if (!googleAds.executed) {
      return { tone: 'warning', message: `本地已删除；${truncateNote}` }
    }
  }

  if (!googleAds.executed) {
    if (googleAds.failures.length > 0) {
      return {
        tone: 'warning',
        message: `本地已删除；远端未执行（${googleAds.failures[0]?.reason || '未知原因'}）`,
      }
    }
    return { tone: 'success', message: '本地已删除' }
  }

  const successCount = googleAds.removed + googleAds.pausedFallback
  const parts = [
    `远端处理 ${googleAds.attempted} 个：删除 ${googleAds.removed}，降级暂停 ${googleAds.pausedFallback}`,
  ]

  if (googleAds.failed > 0 || googleAds.failures.length > 0) {
    parts.push(`失败 ${googleAds.failed}`)
    const sample = googleAds.failures
      .slice(0, 3)
      .map((item) => `${item.campaignId}（${item.reason}）`)
      .join('；')
    if (sample) {
      parts.push(`示例：${sample}`)
    }
    if (googleAds.failures.length > 3) {
      parts.push(`另有 ${googleAds.failures.length - 3} 条失败未展示`)
    }
    return { tone: 'warning', message: parts.join('。') }
  }

  if (successCount === 0 && googleAds.planned > 0) {
    return { tone: 'warning', message: '本地已删除，但远端广告系列均未成功处理' }
  }

  return { tone: 'success', message: parts.join('。') }
}
