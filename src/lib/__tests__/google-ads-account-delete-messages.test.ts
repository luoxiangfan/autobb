import { describe, expect, it } from 'vitest'
import { buildDeleteAccountRemoteMessage } from '@/lib/google-ads/account-delete'

describe('buildDeleteAccountRemoteMessage', () => {
  it('describes partial failures as warning', () => {
    const result = buildDeleteAccountRemoteMessage(true, {
      planned: 2,
      attempted: 2,
      paused: 0,
      removed: 1,
      pausedFallback: 0,
      failed: 1,
      action: 'REMOVE',
      executed: true,
      failures: [{ campaignId: '1002', reason: 'denied' }],
    })

    expect(result.tone).toBe('warning')
    expect(result.message).toContain('失败 1')
    expect(result.message).toContain('1002')
  })
})
