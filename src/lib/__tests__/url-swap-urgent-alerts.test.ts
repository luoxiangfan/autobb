import { describe, expect, it } from 'vitest'
import {
  excludeDisabledUrlSwapWithPausedCampaignSql,
  requireEnabledCampaignForOfferSql,
  summarizeUrlSwapErrorMessage,
} from '../url-swap/urgent-alerts'

describe('url-swap urgent alerts', () => {
  it('builds enabled-campaign filter SQL for postgres and sqlite', () => {
    expect(requireEnabledCampaignForOfferSql('postgres')).toContain(
      "c.status IN ('ENABLED', 'ACTIVE')"
    )
    expect(requireEnabledCampaignForOfferSql('sqlite')).toContain('c.is_deleted = 0')
  })

  it('builds paused-campaign exclusion SQL', () => {
    expect(excludeDisabledUrlSwapWithPausedCampaignSql('postgres')).toContain(
      "t.status = 'disabled'"
    )
    expect(excludeDisabledUrlSwapWithPausedCampaignSql('sqlite')).toContain("c.status = 'PAUSED'")
  })

  it('summarizes enhanced task error messages', () => {
    const summary = summarizeUrlSwapErrorMessage(
      '🔴 推广链接解析失败连续失败 3 次，任务已标记为错误状态。\n\n' +
        '错误详情: 推广链接已失效：PartnerBoost 返回 Invalid Link 页面\n\n' +
        '建议操作：\n1. 检查推广链接'
    )

    expect(summary).toContain('PartnerBoost')
    expect(summary).not.toContain('建议操作')
  })
})
