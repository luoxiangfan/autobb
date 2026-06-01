import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GOOGLE_ADS_DUAL_STACK_WARNING } from '../google-ads-auth-context'

let mockDb: any
const mockListAccessibleCustomers = vi.fn()
const mockGenerateKeywordHistoricalMetrics = vi.fn()

const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
}))

vi.mock('../db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('../google-ads-api', () => ({
  getGoogleAdsClient: () => ({
    listAccessibleCustomers: (...args: any[]) => mockListAccessibleCustomers(...args),
    Customer: () => ({
      keywordPlanIdeas: {
        generateKeywordHistoricalMetrics: (...args: any[]) =>
          mockGenerateKeywordHistoricalMetrics(...args),
      },
    }),
  }),
}))

vi.mock('../google-ads-auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../google-ads-auth-context')>()
  return {
    ...actual,
    getGoogleAdsAuthContext: authContextFns.getGoogleAdsAuthContext,
  }
})

const oauthCredentialsFixture = {
  client_id: 'cid',
  client_secret: 'secret',
  developer_token: 'token',
  refresh_token: 'refresh',
  login_customer_id: '2872703913',
  api_access_level: 'explorer',
}

function mockOAuthAuthContext(overrides?: { dualStack?: boolean }) {
  authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
    userId: 71,
    ownerUserId: 71,
    dualStack: overrides?.dualStack ?? false,
    auth: { authType: 'oauth' as const },
    oauthCredentials: oauthCredentialsFixture,
    serviceAccountConfig: null,
    assignment: null,
    isShared: false,
    canModify: true,
  })
}

describe('google-ads-access-level-detector', () => {
  beforeEach(() => {
    mockDb = {
      queryOne: vi.fn(),
    }
    mockListAccessibleCustomers.mockReset()
    mockGenerateKeywordHistoricalMetrics.mockReset()
    mockOAuthAuthContext()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('throws dual-stack warning before probing Google Ads API', async () => {
    mockOAuthAuthContext({ dualStack: true })
    const { detectApiAccessLevel } = await import('../google-ads-access-level-detector')

    await expect(detectApiAccessLevel(71)).rejects.toThrow(GOOGLE_ADS_DUAL_STACK_WARNING)
    expect(mockListAccessibleCustomers).not.toHaveBeenCalled()
  })

  it('upgrades explorer to basic when keyword planner probe succeeds', async () => {
    const { detectApiAccessLevel } = await import('../google-ads-access-level-detector')

    mockListAccessibleCustomers.mockResolvedValue({
      resource_names: ['customers/2872703913'],
    })
    mockGenerateKeywordHistoricalMetrics.mockResolvedValue({ results: [] })

    const result = await detectApiAccessLevel(71)

    expect(result.level).toBe('basic')
    expect(result.method).toBe('api_call')
    expect(mockGenerateKeywordHistoricalMetrics).toHaveBeenCalledTimes(1)
  })

  it('returns test when probe fails with test-only developer token error', async () => {
    const { detectApiAccessLevel } = await import('../google-ads-access-level-detector')

    mockListAccessibleCustomers.mockResolvedValue({
      resource_names: ['customers/2872703913'],
    })
    mockGenerateKeywordHistoricalMetrics.mockRejectedValue({
      errors: [
        {
          message:
            'The developer token is only approved for use with test accounts. To access non-test accounts, apply for Basic or Standard access.',
        },
      ],
    })

    const result = await detectApiAccessLevel(71)

    expect(result.level).toBe('test')
    expect(result.method).toBe('error_pattern')
  })
})
