import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultOAuthApiAuth,
  defaultOAuthAuthContext,
} from './helpers/campaign-route-auth-context-mock'

const prepareFns = vi.hoisted(() => ({
  prepareGoogleAdsApiCallForLinkedAccountCached: vi.fn(),
}))

const keywordPlannerFns = vi.hoisted(() => ({
  getGoogleAdsConfig: vi.fn(),
}))

const plannerAuthFns = vi.hoisted(() => ({
  resolveLinkedServiceAccountIdForOffer: vi.fn(),
  queryGoogleAdsAccountForOfferExpand: vi.fn(),
}))

vi.mock('../google-ads-api-prepare', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../google-ads-api-prepare')>()
  return {
    ...actual,
    prepareGoogleAdsApiCallForLinkedAccountCached:
      prepareFns.prepareGoogleAdsApiCallForLinkedAccountCached,
  }
})

vi.mock('../keyword-planner', () => ({
  getGoogleAdsConfig: keywordPlannerFns.getGoogleAdsConfig,
}))

vi.mock('../google-ads-keyword-planner-auth', () => ({
  resolveLinkedServiceAccountIdForOffer: plannerAuthFns.resolveLinkedServiceAccountIdForOffer,
  queryGoogleAdsAccountForOfferExpand: plannerAuthFns.queryGoogleAdsAccountForOfferExpand,
}))

import {
  createCreativeGenerationAuthCache,
  validateGoogleAdsConfigForCreativeGeneration,
} from '../google-ads-creative-generation-auth'
import { invalidateGoogleAdsAuthContextCache } from '@/lib/google-ads-auth-context'

const oauthCredentialsFull = {
  refresh_token: 'oauth-refresh-token',
  login_customer_id: '9988776655',
  client_id: 'test-client-id.apps.googleusercontent.com',
  client_secret: 'GOCSPX-test-client-secret',
  developer_token: 'abcdefghijklmnopqrstuvwxyz123456',
}

const preparedOk = {
  ok: true as const,
  authContext: {
    ...defaultOAuthAuthContext,
    userId: 1,
    ownerUserId: 1,
    oauthCredentials: oauthCredentialsFull,
  },
  apiAuth: defaultOAuthApiAuth,
  refreshToken: 'oauth-refresh-token',
  oauthCredentials: oauthCredentialsFull,
  oauthLoginCustomerId: '9988776655',
}

describe('CreativeGenerationValidationCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prepareFns.prepareGoogleAdsApiCallForLinkedAccountCached.mockResolvedValue(preparedOk)
    keywordPlannerFns.getGoogleAdsConfig.mockResolvedValue({
      developerToken: 'dev-token',
      refreshToken: 'oauth-refresh-token',
      customerId: '1234567890',
      loginCustomerId: '9988776655',
    })
    plannerAuthFns.resolveLinkedServiceAccountIdForOffer.mockResolvedValue(null)
    plannerAuthFns.queryGoogleAdsAccountForOfferExpand.mockResolvedValue({
      customer_id: '1234567890',
    })
  })

  it('stores only { ok: true } in validationByOfferId without authContext or apiAuth', async () => {
    const cache = createCreativeGenerationAuthCache()

    const first = await validateGoogleAdsConfigForCreativeGeneration(1, 42, cache)
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.authContext).toBeDefined()
      expect(first.apiAuth).toBeDefined()
    }

    const entry = cache.validationByOfferId.get(42)
    expect(entry).toEqual({ ok: true, generationAtValidate: 0 })
    expect(entry).not.toHaveProperty('authContext')
    expect(entry).not.toHaveProperty('apiAuth')

    const second = await validateGoogleAdsConfigForCreativeGeneration(1, 42, cache)
    expect(second).toEqual({ ok: true })
    expect(second).not.toHaveProperty('authContext')
    expect(second).not.toHaveProperty('apiAuth')
    expect(prepareFns.prepareGoogleAdsApiCallForLinkedAccountCached).toHaveBeenCalledTimes(1)
  })

  it('stores only { ok: true } in validationByUserId when offerId is omitted', async () => {
    const cache = createCreativeGenerationAuthCache()

    const first = await validateGoogleAdsConfigForCreativeGeneration(1, undefined, cache)
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.authContext).toBeDefined()
      expect(first.apiAuth).toBeDefined()
    }

    const entry = cache.validationByUserId.get(1)
    expect(entry).toEqual({ ok: true, generationAtValidate: 0 })
    expect(entry).not.toHaveProperty('authContext')
    expect(entry).not.toHaveProperty('apiAuth')

    const second = await validateGoogleAdsConfigForCreativeGeneration(1, undefined, cache)
    expect(second).toEqual({ ok: true })
    expect(prepareFns.prepareGoogleAdsApiCallForLinkedAccountCached).toHaveBeenCalledTimes(1)
  })

  it('stores failure metadata without credentials in validation cache', async () => {
    keywordPlannerFns.getGoogleAdsConfig.mockResolvedValue({
      developerToken: '',
      refreshToken: '',
      customerId: '',
      loginCustomerId: '',
    })
    const cache = createCreativeGenerationAuthCache()

    const first = await validateGoogleAdsConfigForCreativeGeneration(1, 42, cache)
    expect(first.ok).toBe(false)
    if (!first.ok) {
      expect(first.message).toContain('完整的 Google Ads API 配置')
      expect(first.missingFields?.length).toBeGreaterThan(0)
    }

    const entry = cache.validationByOfferId.get(42)
    expect(entry?.ok).toBe(false)
    if (entry && !entry.ok) {
      expect(entry.message).toContain('完整的 Google Ads API 配置')
      expect(entry.missingFields?.length).toBeGreaterThan(0)
    }
    expect(entry).not.toHaveProperty('authContext')
    expect(entry).not.toHaveProperty('apiAuth')
    expect(entry).not.toHaveProperty('oauthCredentials')

    const second = await validateGoogleAdsConfigForCreativeGeneration(1, 42, cache)
    expect(second.ok).toBe(false)
    if (!second.ok && entry && !entry.ok) {
      expect(second.message).toBe(entry.message)
      expect(second.missingFields).toEqual(entry.missingFields)
    }
    expect(second).not.toHaveProperty('generationAtValidate')
    expect(second).not.toHaveProperty('ownerUserId')
    expect(prepareFns.prepareGoogleAdsApiCallForLinkedAccountCached).toHaveBeenCalledTimes(1)
  })

  it('revalidates when validation cache generation is stale after invalidate', async () => {
    const cache = createCreativeGenerationAuthCache()

    await validateGoogleAdsConfigForCreativeGeneration(1, 42, cache)
    expect(prepareFns.prepareGoogleAdsApiCallForLinkedAccountCached).toHaveBeenCalledTimes(1)

    invalidateGoogleAdsAuthContextCache(1)

    await validateGoogleAdsConfigForCreativeGeneration(1, 42, cache)
    expect(prepareFns.prepareGoogleAdsApiCallForLinkedAccountCached).toHaveBeenCalledTimes(2)
  })

  it('revalidates shared auth validation when owner generation changes but request user generation does not', async () => {
    prepareFns.prepareGoogleAdsApiCallForLinkedAccountCached.mockResolvedValue({
      ...preparedOk,
      authContext: {
        ...preparedOk.authContext,
        userId: 2,
        ownerUserId: 7,
        isShared: true,
      },
    })
    const cache = createCreativeGenerationAuthCache()

    await validateGoogleAdsConfigForCreativeGeneration(2, 42, cache)
    expect(prepareFns.prepareGoogleAdsApiCallForLinkedAccountCached).toHaveBeenCalledTimes(1)
    expect(cache.validationByOfferId.get(42)).toMatchObject({
      ok: true,
      ownerUserId: 7,
      ownerGenerationAtValidate: 0,
    })

    invalidateGoogleAdsAuthContextCache(7)

    await validateGoogleAdsConfigForCreativeGeneration(2, 42, cache)
    expect(prepareFns.prepareGoogleAdsApiCallForLinkedAccountCached).toHaveBeenCalledTimes(2)
  })
})
