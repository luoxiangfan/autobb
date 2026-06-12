import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  exec: vi.fn(async () => {}),
}))

const authContextFns = vi.hoisted(() => ({
  invalidateGoogleAdsAuthContextForCredentialUser: vi.fn(async () => {}),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  invalidateGoogleAdsAuthContextForCredentialUser:
    authContextFns.invalidateGoogleAdsAuthContextForCredentialUser,
}))

import {
  deleteAllGoogleAdsServiceAccountsForUser,
  deleteGoogleAdsServiceAccountForUser,
  replaceGoogleAdsServiceAccountForUser,
} from '@/lib/google-ads-service-account'

describe('google-ads-service-account mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replaceGoogleAdsServiceAccountForUser replaces row and busts cache', async () => {
    const id = await replaceGoogleAdsServiceAccountForUser(7, {
      name: 'Main SA',
      mccCustomerId: '1234567890',
      developerToken: 'dev-token',
      serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
      encryptedPrivateKey: 'enc-key',
      projectId: 'proj-1',
    })

    expect(id).toEqual(expect.any(String))
    expect(dbFns.exec).toHaveBeenCalledTimes(2)
    expect(dbFns.exec.mock.calls[0]?.[0]).toContain('DELETE FROM google_ads_service_accounts')
    expect(dbFns.exec.mock.calls[1]?.[0]).toContain('INSERT INTO google_ads_service_accounts')
    expect(authContextFns.invalidateGoogleAdsAuthContextForCredentialUser).toHaveBeenCalledWith(7)
  })

  it('deleteGoogleAdsServiceAccountForUser deletes by id and busts cache', async () => {
    await deleteGoogleAdsServiceAccountForUser(7, 'sa-99')

    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM google_ads_service_accounts'),
      ['sa-99', 7]
    )
    expect(authContextFns.invalidateGoogleAdsAuthContextForCredentialUser).toHaveBeenCalledWith(7)
  })

  it('deleteAllGoogleAdsServiceAccountsForUser clears user rows and busts cache', async () => {
    await deleteAllGoogleAdsServiceAccountsForUser(7)

    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM google_ads_service_accounts'),
      [7]
    )
    expect(authContextFns.invalidateGoogleAdsAuthContextForCredentialUser).toHaveBeenCalledWith(7)
  })
})
