import { describe, expect, it, vi } from 'vitest'
import { defaultOAuthAuthContext } from './helpers/campaign-route-auth-context-mock'
import {
  assertAuthContextSecretsHydrated,
  googleAdsAuthContextNeedsSecretHydration,
  hydrateGoogleAdsAuthContextSecrets,
  normalizeCachedAuthContextPayload,
  oauthCredentialsLookStripped,
  oauthRefreshConfiguredFromContext,
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

    expect(stripped.secretsStripped).toBe(true)
    expect(stripped.oauthHasRefreshToken).toBe(true)
    expect(stripped.oauthCredentials?.client_id).toBe('cid.apps.googleusercontent.com')
    expect(stripped.oauthCredentials?.refresh_token).toBeNull()
    expect(stripped.serviceAccountConfig?.privateKey).toBeNull()
    expect(stripped.serviceAccountConfig?.developerToken).toBeNull()
  })

  it('hydrateGoogleAdsAuthContextSecrets reloads stripped OAuth credentials', async () => {
    const stripped = stripGoogleAdsAuthContextForCache({
      ...defaultOAuthAuthContext,
      oauthCredentials: {
        id: 1,
        user_id: 7,
        client_id: 'cid.apps.googleusercontent.com',
        client_secret: null,
        refresh_token: null,
        developer_token: null,
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

    const hydrated = await hydrateGoogleAdsAuthContextSecrets(stripped, () => 1)

    expect(oauthCredentialsLookStripped(stripped.oauthCredentials)).toBe(true)
    expect(hydrated.secretsStripped).toBe(false)
    expect(hydrated.oauthCredentials?.refresh_token).toBe('refresh')
    expect(oauthFns.getGoogleAdsCredentials).toHaveBeenCalledWith(7, {
      ownerUserId: 7,
      assignment: null,
      isShared: false,
    })
  })

  it('hydrate reuses generation-bound secrets cache', async () => {
    const stripped = stripGoogleAdsAuthContextForCache({
      ...defaultOAuthAuthContext,
      oauthCredentials: {
        id: 1,
        user_id: 7,
        client_id: 'cid.apps.googleusercontent.com',
        client_secret: null,
        refresh_token: null,
        developer_token: null,
        login_customer_id: '9988776655',
        is_active: 1,
        created_at: '',
        updated_at: '',
      },
    } as any)

    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'refresh',
      client_id: 'cid',
      client_secret: 'sec',
      developer_token: 'dev',
    })

    await hydrateGoogleAdsAuthContextSecrets(stripped, () => 3)
    oauthFns.getGoogleAdsCredentials.mockClear()

    const second = await hydrateGoogleAdsAuthContextSecrets(stripped, () => 3)
    expect(second.oauthCredentials?.refresh_token).toBe('refresh')
    expect(oauthFns.getGoogleAdsCredentials).not.toHaveBeenCalled()
  })

  it('googleAdsAuthContextNeedsSecretHydration is false when secrets are present', () => {
    const full = {
      ...defaultOAuthAuthContext,
      secretsStripped: false,
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

  it('oauthRefreshConfiguredFromContext works on strip metadata without secrets', () => {
    const slim = stripGoogleAdsAuthContextForCache({
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
    } as any)

    expect(oauthRefreshConfiguredFromContext(slim)).toBe(true)
    expect(slim.oauthCredentials?.refresh_token).toBeNull()
  })

  it('normalizeCachedAuthContextPayload strips legacy plaintext Redis entries', () => {
    const legacy = {
      ...defaultOAuthAuthContext,
      oauthCredentials: {
        refresh_token: 'legacy-rt',
        client_id: 'cid',
        client_secret: 'sec',
        developer_token: 'dev',
        login_customer_id: '9988776655',
      },
    } as any

    const normalized = normalizeCachedAuthContextPayload(legacy)
    expect(normalized.secretsStripped).toBe(true)
    expect(normalized.oauthCredentials?.refresh_token).toBeNull()
    expect(normalized.oauthHasRefreshToken).toBe(true)
  })

  it('assertAuthContextSecretsHydrated rejects strip context', () => {
    const slim = stripGoogleAdsAuthContextForCache(defaultOAuthAuthContext as any)
    expect(() => assertAuthContextSecretsHydrated(slim)).toThrow(/not hydrated/)
  })
})
