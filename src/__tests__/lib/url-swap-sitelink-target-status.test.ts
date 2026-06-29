import { describe, expect, it } from 'vitest'
import { resolveUrlSwapSitelinkTargetStatusForTaskStatus } from '@/lib/url-swap/url-swap-sitelink-targets'

describe('resolveUrlSwapSitelinkTargetStatusForTaskStatus', () => {
  it('keeps sitelink targets active only when parent task is enabled', () => {
    expect(resolveUrlSwapSitelinkTargetStatusForTaskStatus('enabled')).toBe('active')
    expect(resolveUrlSwapSitelinkTargetStatusForTaskStatus('disabled')).toBe('paused')
    expect(resolveUrlSwapSitelinkTargetStatusForTaskStatus('error')).toBe('paused')
    expect(resolveUrlSwapSitelinkTargetStatusForTaskStatus('completed')).toBe('paused')
  })
})
