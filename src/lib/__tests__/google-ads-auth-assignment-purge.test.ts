import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  exec: vi.fn(async () => {}),
}))

const authContextFns = vi.hoisted(() => ({
  invalidateGoogleAdsAuthContextCacheForOwner: vi.fn(async () => {}),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    exec: dbFns.exec,
  })),
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  invalidateGoogleAdsAuthContextCacheForOwner:
    authContextFns.invalidateGoogleAdsAuthContextCacheForOwner,
}))

import { purgeGoogleAdsAuthConfigForUser } from '@/lib/google-ads-auth-assignment'

describe('purgeGoogleAdsAuthConfigForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates owner and shared dependents cache before deleting DB rows', async () => {
    await purgeGoogleAdsAuthConfigForUser(1)

    expect(authContextFns.invalidateGoogleAdsAuthContextCacheForOwner).toHaveBeenCalledWith(1)
    const invalidateOrder =
      authContextFns.invalidateGoogleAdsAuthContextCacheForOwner.mock.invocationCallOrder[0]
    const execOrder = dbFns.exec.mock.invocationCallOrder[0]
    expect(invalidateOrder).toBeLessThan(execOrder)
    expect(dbFns.exec).toHaveBeenCalled()
  })
})
