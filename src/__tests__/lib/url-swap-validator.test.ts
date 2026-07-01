/**
 * Url Swap validateTaskConfig 行为测试
 * src/__tests__/lib/url-swap-validator.test.ts
 */

import { describe, it, expect, vi } from 'vitest'
import { URL_SWAP_ALLOWED_INTERVALS_MINUTES } from '@/lib/url-swap/url-swap-intervals'

// Avoid native bcrypt binary issues in test environments (arch mismatch).
vi.mock('bcrypt', () => {
  const stub = {
    hash: async () => 'stub-hash',
    compare: async () => true,
  }
  return { default: stub, ...stub }
})

describe('validateTaskConfig', () => {
  it('允许所有配置的换链间隔', async () => {
    const { validateTaskConfig } = await import('@/lib/url-swap/url-swap-validator')
    for (const interval of URL_SWAP_ALLOWED_INTERVALS_MINUTES) {
      const result = validateTaskConfig(interval, 7)
      expect(result.valid).toBe(true)
    }
  })

  it('拒绝非法换链间隔并给出可选列表', async () => {
    const { validateTaskConfig } = await import('@/lib/url-swap/url-swap-validator')
    const result = validateTaskConfig(7, 7)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('换链间隔必须是以下值之一：')
    expect(result.error).toContain(URL_SWAP_ALLOWED_INTERVALS_MINUTES.join(', '))
    expect(result.error).toContain('分钟')
  })

  it('拒绝 legacy 换链间隔 240 和 480 分钟', async () => {
    const { validateTaskConfig } = await import('@/lib/url-swap/url-swap-validator')
    for (const interval of [240, 480]) {
      const result = validateTaskConfig(interval, 7)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('换链间隔必须是以下值之一')
    }
  })
})
