import { describe, expect, it } from 'vitest'
import {
  ENABLE_CAMPAIGN_OFFER_TASK_HINTS,
  formatToggleStatusWarnings,
  PAUSE_CAMPAIGN_OFFER_TASK_HINTS,
} from './toggle-status-warning'

describe('PAUSE_CAMPAIGN_OFFER_TASK_HINTS', () => {
  it('includes click-farm pause and url-swap disable hints', () => {
    expect(PAUSE_CAMPAIGN_OFFER_TASK_HINTS).toEqual([
      '同步暂停关联 Offer 的补点击任务（标记为已停止）',
      '同步禁用关联 Offer 的换链接任务',
    ])
  })
})

describe('ENABLE_CAMPAIGN_OFFER_TASK_HINTS', () => {
  it('includes resume, recreate, and default-parameter hints', () => {
    expect(ENABLE_CAMPAIGN_OFFER_TASK_HINTS.length).toBe(3)
    expect(ENABLE_CAMPAIGN_OFFER_TASK_HINTS[0]).toContain('任务仍存在')
    expect(ENABLE_CAMPAIGN_OFFER_TASK_HINTS[1]).toContain('重新创建')
    expect(ENABLE_CAMPAIGN_OFFER_TASK_HINTS[2]).toContain('默认参数')
  })
})

describe('formatToggleStatusWarnings', () => {
  it('formats known warning codes with friendly labels', () => {
    const output = formatToggleStatusWarnings([
      { code: 'OFFER_TASK_PAUSE_FAILED', message: '暂停失败' },
      { code: 'OFFER_TASK_RESUME_FAILED', message: '补点击: 队列不可用' },
      { code: 'OFFER_NOT_BOUND', message: '当前广告系列未绑定 Offer' },
    ])

    expect(output).toBe(
      '[关联任务暂停失败] 暂停失败；[关联任务恢复失败] 补点击: 队列不可用；[未关联 Offer] 当前广告系列未绑定 Offer'
    )
  })

  it('falls back to warning code for unknown labels', () => {
    const output = formatToggleStatusWarnings([{ code: 'UNKNOWN_CODE', message: '需要人工关注' }])

    expect(output).toBe('[UNKNOWN_CODE] 需要人工关注')
  })

  it('ignores warnings without messages', () => {
    const output = formatToggleStatusWarnings([
      { code: 'OFFER_TASK_PAUSE_FAILED', message: '' },
      { code: 'OFFER_NOT_BOUND', message: '有提示' },
      { code: 'OFFER_NOT_BOUND' },
    ])

    expect(output).toBe('[未关联 Offer] 有提示')
  })
})
