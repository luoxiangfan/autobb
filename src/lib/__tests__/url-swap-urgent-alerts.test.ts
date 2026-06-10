import { describe, expect, it } from 'vitest'
import {
  excludeDisabledUrlSwapTasksSql,
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

  it('builds disabled-task exclusion SQL for postgres and sqlite', () => {
    expect(excludeDisabledUrlSwapTasksSql('postgres')).toContain("t.status <> 'disabled'")
    expect(excludeDisabledUrlSwapTasksSql('sqlite')).toContain("t.status <> 'disabled'")
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
