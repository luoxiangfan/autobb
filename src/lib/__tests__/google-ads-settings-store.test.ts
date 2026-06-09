import { beforeEach, describe, expect, it, vi } from 'vitest'

const assignmentFns = vi.hoisted(() => ({
  isGoogleAdsAuthShared: vi.fn(),
  resolveGoogleAdsCredentialOwnerId: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  queryOne: vi.fn(),
}))

vi.mock('@/lib/google-ads-auth-assignment', () => ({
  isGoogleAdsAuthShared: assignmentFns.isGoogleAdsAuthShared,
  resolveGoogleAdsCredentialOwnerId: assignmentFns.resolveGoogleAdsCredentialOwnerId,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

import {
  maskGoogleAdsCredentialSettingValueForReadOnly,
  overlayGoogleAdsSettingsFromCredentialStore,
  resolveGoogleAdsOAuthSettingsReadUserId,
} from '@/lib/google-ads-settings-store'

describe('resolveGoogleAdsOAuthSettingsReadUserId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses owner user id for shared oauth assignment', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 99,
      isShared: true,
      assignment: { authType: 'oauth' },
    })

    await expect(resolveGoogleAdsOAuthSettingsReadUserId(5)).resolves.toBe(99)
  })

  it('uses current user id for own credentials', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 5,
      isShared: false,
      assignment: null,
    })

    await expect(resolveGoogleAdsOAuthSettingsReadUserId(5)).resolves.toBe(5)
  })
})

describe('maskGoogleAdsCredentialSettingValueForReadOnly', () => {
  it('hides secrets and masks client id', () => {
    expect(
      maskGoogleAdsCredentialSettingValueForReadOnly('client_secret', 'super-secret-value', true)
    ).toBe('')
    expect(maskGoogleAdsCredentialSettingValueForReadOnly('developer_token', 'dev-token-123')).toBe(
      ''
    )
    expect(
      maskGoogleAdsCredentialSettingValueForReadOnly(
        'client_id',
        '123456789012345678901.apps.googleusercontent.com'
      )
    ).toBe('12345678....com')
    expect(maskGoogleAdsCredentialSettingValueForReadOnly('login_customer_id', '1234567890')).toBe(
      '1234567890'
    )
  })
})

describe('overlayGoogleAdsSettingsFromCredentialStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.getDatabase.mockResolvedValue({
      type: 'sqlite',
      queryOne: dbFns.queryOne,
    })
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 5,
      isShared: true,
      assignment: { authType: 'oauth', assignmentMode: 'shared_admin' },
    })
    assignmentFns.isGoogleAdsAuthShared.mockReturnValue(true)
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (String(sql).includes('google_ads_credentials')) {
        return {
          login_customer_id: '1234567890',
          client_id: '123456789012345678901.apps.googleusercontent.com',
          client_secret: 'plain-secret',
          developer_token: 'plain-dev-token',
        }
      }
      return null
    })
  })

  it('masks sensitive oauth fields for shared read-only users', async () => {
    const settings = [
      {
        category: 'google_ads',
        key: 'client_id',
        value: '',
        dataType: 'string',
        isSensitive: false,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: '',
      },
      {
        category: 'google_ads',
        key: 'client_secret',
        value: '',
        dataType: 'string',
        isSensitive: true,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: '',
      },
      {
        category: 'google_ads',
        key: 'developer_token',
        value: '',
        dataType: 'string',
        isSensitive: true,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: '',
      },
      {
        category: 'google_ads',
        key: 'login_customer_id',
        value: '',
        dataType: 'string',
        isSensitive: false,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: '',
      },
    ]

    const overlaid = await overlayGoogleAdsSettingsFromCredentialStore(settings, 5)
    const byKey = Object.fromEntries(overlaid.map((item) => [item.key, item.value]))

    expect(byKey.login_customer_id).toBe('1234567890')
    expect(byKey.client_id).toBe('12345678....com')
    expect(byKey.client_secret).toBe('')
    expect(byKey.developer_token).toBe('')
  })

  it('reads oauth fields from shared admin not current user', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 99,
      isShared: true,
      assignment: { authType: 'oauth', assignmentMode: 'shared_admin' },
    })
    assignmentFns.isGoogleAdsAuthShared.mockReturnValue(false)

    dbFns.queryOne.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (String(sql).includes('google_ads_credentials')) {
        expect(params?.[0]).toBe(99)
        return {
          login_customer_id: '1234567890',
          client_id: '123456789012345678901.apps.googleusercontent.com',
          client_secret: 'plain-secret',
          developer_token: 'plain-dev-token',
        }
      }
      return null
    })

    const settings = [
      {
        category: 'google_ads',
        key: 'client_id',
        value: '',
        dataType: 'string',
        isSensitive: false,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: '',
      },
    ]

    const overlaid = await overlayGoogleAdsSettingsFromCredentialStore(settings, 5)
    const byKey = Object.fromEntries(overlaid.map((item) => [item.key, item.value]))

    expect(byKey.client_id).toBe('123456789012345678901.apps.googleusercontent.com')
  })
})
