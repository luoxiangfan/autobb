import { describe, expect, it } from 'vitest'
import { buildDeleteAccountApiWarnings } from '@/lib/google-ads/account-delete'

describe('buildDeleteAccountApiWarnings', () => {
  it('includes credentials warning after local delete', () => {
    const warnings = buildDeleteAccountApiWarnings(true, {
      planned: 2,
      attempted: 0,
      paused: 0,
      removed: 0,
      pausedFallback: 0,
      failed: 0,
      action: 'REMOVE',
      executed: false,
      skipReason: 'CREDENTIALS_MISSING',
      failures: [],
    })

    expect(warnings?.[0]).toContain('本地账号已删除')
    expect(warnings?.[0]).toContain('认证凭证')
  })

  it('uses different prefix when local delete failed', () => {
    const warnings = buildDeleteAccountApiWarnings(
      true,
      {
        planned: 1,
        attempted: 1,
        paused: 0,
        removed: 0,
        pausedFallback: 0,
        failed: 1,
        action: 'REMOVE',
        executed: true,
        failures: [{ campaignId: '1', reason: 'err' }],
      },
      { localDeleted: false }
    )

    expect(warnings?.some((item) => item.includes('本地账号删除失败'))).toBe(true)
  })
})
