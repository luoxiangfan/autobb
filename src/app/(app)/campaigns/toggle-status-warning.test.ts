import { describe, expect, it } from 'vitest'
import { formatToggleStatusWarnings } from './toggle-status-warning'

describe('formatToggleStatusWarnings', () => {
  it('formats known warning codes with friendly labels', () => {
    const output = formatToggleStatusWarnings([
      { code: 'OFFER_TASK_PAUSE_FAILED', message: '暂停失败' },
      { code: 'OFFER_NOT_BOUND', message: '当前广告系列未绑定 Offer' },
    ])

    expect(output).toBe('[关联任务暂停失败] 暂停失败；[未关联 Offer] 当前广告系列未绑定 Offer')
  })

  it('falls back to warning code for unknown labels', () => {
    const output = formatToggleStatusWarnings([
      { code: 'UNKNOWN_CODE', message: '需要人工关注' },
    ])

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
