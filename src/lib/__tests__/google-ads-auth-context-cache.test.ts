import { describe, expect, it, vi } from 'vitest'
import { defaultOAuthAuthContext } from './helpers/campaign-route-auth-context-mock'
import {
  googleAdsAuthContextNeedsSecretHydration,
  hydrateGoogleAdsAuthContextSecrets,
  oauthCredentialsLookStripped,
  stripGoogleAdsAuthContextForCache,
} from '../google-ads-auth-context-cache'

const oauthFns = vi.hoisted(() => ({
  getGoogleAdsCredentials: vi.fn(),
}))

const saFns = vi.hoisted(() => ({
  getServiceAccountConfig: vi.fn(),
}))

vi.mock('../google-ads-oauth', () => ({
  getGoogleAdsCredentials: oauthFns.getGoogleAdsCredentials,
  getGoogleAdsCredentialsRaw: vi.fn(),
}))

vi.mock('../google-ads-service-account', () => ({
  getServiceAccountConfig: saFns.getServiceAccountConfig,
}))

describe('google-ads-auth-context-cache', () => {
  it('stripGoogleAdsAuthContextForCache removes OAuth and SA secrets', () => {
    const stripped = stripGoogleAdsAuthContextForCache({
      ...defaultOAuthAuthContext,
      oauthCredentials: {
        id: 1,
        user_id: 7,
        client_id: 'cid.apps.googleusercontent.com',
        client_secret: 'secret',
        refresh_token: 'refresh',
        developer_token: 'dev-token',
        login_customer_id: '9988776655',
        is_active: 1,
        created_at: '',
        updated_at: '',
      },
      serviceAccountConfig: {
        id: 'sa-1',
        name: 'SA',
        mccCustomerId: '111',
        developerToken: 'dev',
        serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----',
        projectId: 'p',
      },
    } as any)

    expect(stripped.oauthCredentials?.client_id).toBe('cid.apps.googleusercontent.com')
    expect(stripped.oauthCredentials?.refresh_token).toBe('')
    expect(stripped.serviceAccountConfig?.privateKey).toBe('')
    expect(stripped.serviceAccountConfig?.developerToken).toBe('')
  })

  it('hydrateGoogleAdsAuthContextSecrets reloads stripped OAuth credentials', async () => {
    const stripped = stripGoogleAdsAuthContextForCache({
      ...defaultOAuthAuthContext,
      oauthCredentials: {
        id: 1,
        user_id: 7,
        client_id: 'cid.apps.googleusercontent.com',
        client_secret: '',
        refresh_token: '',
        developer_token: '',
        login_customer_id: '9988776655',
        is_active: 1,
        created_at: '',
        updated_at: '',
      },
    } as any)

    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      client_id: 'cid.apps.googleusercontent.com',
      client_secret: 'secret',
      refresh_token: 'refresh',
      developer_token: 'dev-token',
      login_customer_id: '9988776655',
    })

    const hydrated = await hydrateGoogleAdsAuthContextSecrets(stripped)

    expect(oauthCredentialsLookStripped(stripped.oauthCredentials)).toBe(true)
    expect(hydrated.oauthCredentials?.refresh_token).toBe('refresh')
    expect(oauthFns.getGoogleAdsCredentials).toHaveBeenCalledWith(7, {
      ownerUserId: 7,
      assignment: null,
      isShared: false,
    })
  })

  it('googleAdsAuthContextNeedsSecretHydration is false when secrets are present', () => {
    const full = {
      ...defaultOAuthAuthContext,
      oauthCredentials: {
        id: 1,
        user_id: 7,
        client_id: 'cid',
        client_secret: 'secret',
        refresh_token: 'refresh',
        developer_token: 'dev-token',
        login_customer_id: '9988776655',
        is_active: 1,
        created_at: '',
        updated_at: '',
      },
    } as any

    expect(googleAdsAuthContextNeedsSecretHydration(full)).toBe(false)
    expect(googleAdsAuthContextNeedsSecretHydration(stripGoogleAdsAuthContextForCache(full))).toBe(
      true
    )
  })
})
