import { describe, expect, it } from 'vitest'
import {
  excludeDisabledUrlSwapTasksSql,
  requireEnabledCampaignForOfferSql,
} from '@/lib/url-swap/alerts'

describe('url-swap urgent alerts SQL helpers', () => {
  it('builds enabled-campaign filter SQL for postgres', () => {
    expect(requireEnabledCampaignForOfferSql()).toContain('c.is_deleted = false')
  })

  it('builds disabled-task exclusion SQL', () => {
    expect(excludeDisabledUrlSwapTasksSql()).toContain("t.status <> 'disabled'")
  })
})
