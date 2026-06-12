import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: dbFns.queryOne,
  })),
}))

import {
  resolveLinkedServiceAccountIdForGoogleAdsAccount,
  resolveLinkedServiceAccountIdForOffer,
} from '@/lib/google-ads/accounts/auth/index'

describe('resolveLinkedServiceAccountIdForOffer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns linked SA from campaign join when offer has campaigns', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INNER JOIN campaigns')) {
        return { service_account_id: 'sa-from-campaign' }
      }
      return null
    })

    const linked = await resolveLinkedServiceAccountIdForOffer(42, 10)
    expect(linked).toBe('sa-from-campaign')
  })

  it('falls back to latest enabled account when offer has no linked campaign', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INNER JOIN campaigns')) {
        return null
      }
      if (sql.includes('FROM google_ads_accounts')) {
        return { service_account_id: 'sa-fallback' }
      }
      return null
    })

    const linked = await resolveLinkedServiceAccountIdForOffer(42, 10)
    expect(linked).toBe('sa-fallback')
  })

  it('returns null when no account has linked SA', async () => {
    dbFns.queryOne.mockResolvedValue(null)

    const linked = await resolveLinkedServiceAccountIdForOffer(42)
    expect(linked).toBeNull()
  })
})

describe('resolveLinkedServiceAccountIdForGoogleAdsAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns trimmed service_account_id for account row', async () => {
    dbFns.queryOne.mockResolvedValue({ service_account_id: '  sa-99  ' })

    const linked = await resolveLinkedServiceAccountIdForGoogleAdsAccount(42, 775)
    expect(linked).toBe('sa-99')
    expect(dbFns.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('FROM google_ads_accounts'),
      [775, 42]
    )
  })
})
