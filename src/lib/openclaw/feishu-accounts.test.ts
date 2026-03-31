import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  queryMock: vi.fn(),
  decryptMock: vi.fn((value: string) => value),
  getUserOnlySettingMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: async () => ({
    query: hoisted.queryMock,
  }),
}))

vi.mock('@/lib/crypto', () => ({
  decrypt: hoisted.decryptMock,
}))

vi.mock('@/lib/settings', async () => {
  const actual = await vi.importActual<typeof import('@/lib/settings')>('@/lib/settings')
  return {
    ...actual,
    getUserOnlySetting: hoisted.getUserOnlySettingMock,
  }
})

import { collectUserFeishuAccounts, collectUserFeishuBindingAccounts } from './feishu-accounts'

describe('collectUserFeishuAccounts', () => {
  beforeEach(() => {
    hoisted.queryMock.mockReset()
    hoisted.decryptMock.mockClear()
    hoisted.getUserOnlySettingMock.mockReset()
  })

  it('forces allowlist and injects open_id from feishu_target', async () => {
    hoisted.queryMock.mockResolvedValueOnce([
      { user_id: 1, key: 'feishu_app_id', value: 'cli_xxx', encrypted_value: null, is_sensitive: false },
      { user_id: 1, key: 'feishu_app_secret', value: null, encrypted_value: 'sec_xxx', is_sensitive: true },
      { user_id: 1, key: 'feishu_target', value: 'ou_target_123', encrypted_value: null, is_sensitive: false },
      { user_id: 1, key: 'feishu_dm_policy', value: 'open', encrypted_value: null, is_sensitive: false },
      { user_id: 1, key: 'feishu_allow_from', value: '[]', encrypted_value: null, is_sensitive: false },
    ])

    const accounts = await collectUserFeishuAccounts()

    expect(accounts['user-1']).toBeDefined()
    expect(accounts['user-1'].dmPolicy).toBe('allowlist')
    expect(accounts['user-1'].allowFrom).toEqual(['ou_target_123'])
  })

  it('keeps explicit allowlist entries and appends target id without duplicates', async () => {
    hoisted.queryMock.mockResolvedValueOnce([
      { user_id: 2, key: 'feishu_app_id', value: 'cli_yyy', encrypted_value: null, is_sensitive: false },
      { user_id: 2, key: 'feishu_app_secret', value: 'sec_yyy', encrypted_value: null, is_sensitive: false },
      { user_id: 2, key: 'feishu_target', value: 'feishu:ou_same', encrypted_value: null, is_sensitive: false },
      { user_id: 2, key: 'feishu_allow_from', value: '["ou_a","ou_same"]', encrypted_value: null, is_sensitive: false },
      { user_id: 2, key: 'feishu_dm_policy', value: 'allowlist', encrypted_value: null, is_sensitive: false },
    ])

    const accounts = await collectUserFeishuAccounts()

    expect(accounts['user-2']).toBeDefined()
    expect(accounts['user-2'].dmPolicy).toBe('allowlist')
    expect(accounts['user-2'].allowFrom).toEqual(['ou_a', 'ou_same'])
  })

  it('does not inject allowlist entries for group chat target', async () => {
    hoisted.queryMock.mockResolvedValueOnce([
      { user_id: 3, key: 'feishu_app_id', value: 'cli_zzz', encrypted_value: null, is_sensitive: false },
      { user_id: 3, key: 'feishu_app_secret', value: 'sec_zzz', encrypted_value: null, is_sensitive: false },
      { user_id: 3, key: 'feishu_target', value: 'oc_group_001', encrypted_value: null, is_sensitive: false },
      { user_id: 3, key: 'feishu_dm_policy', value: 'open', encrypted_value: null, is_sensitive: false },
      { user_id: 3, key: 'feishu_allow_from', value: '', encrypted_value: null, is_sensitive: false },
    ])

    const accounts = await collectUserFeishuAccounts()

    expect(accounts['user-3']).toBeDefined()
    expect(accounts['user-3'].dmPolicy).toBe('open')
    expect(accounts['user-3'].allowFrom).toBeUndefined()
  })

  it('merges card settings from user feishu_accounts_json.main', async () => {
    hoisted.queryMock.mockResolvedValueOnce([
      { user_id: 4, key: 'feishu_app_id', value: 'cli_base', encrypted_value: null, is_sensitive: false },
      { user_id: 4, key: 'feishu_app_secret', value: 'sec_base', encrypted_value: null, is_sensitive: false },
      { user_id: 4, key: 'feishu_allow_from', value: '["ou_cfg"]', encrypted_value: null, is_sensitive: false },
      { user_id: 4, key: 'feishu_target', value: 'ou_target_4', encrypted_value: null, is_sensitive: false },
      {
        user_id: 4,
        key: 'feishu_accounts_json',
        value: JSON.stringify({
          main: {
            appId: 'cli_json',
            appSecret: 'sec_json',
            allowFrom: ['ou_json'],
            dmPolicy: 'open',
            cardCallbackPath: '/feishu/user-4/card-action',
            cardVerificationToken: 'verify_token_4',
            cardEncryptKey: 'encrypt_key_4',
            cardConfirmUrl: 'https://example.com/api/openclaw/commands/confirm',
            cardConfirmAuthToken: 'confirm_auth_4',
            cardConfirmTimeoutMs: 12000,
          },
        }),
        encrypted_value: null,
        is_sensitive: true,
      },
    ])

    const accounts = await collectUserFeishuAccounts()

    expect(accounts['user-4']).toBeDefined()
    expect(accounts['user-4'].appId).toBe('cli_base')
    expect(accounts['user-4'].appSecret).toBe('sec_base')
    expect(accounts['user-4'].dmPolicy).toBe('allowlist')
    expect(accounts['user-4'].allowFrom).toEqual(['ou_json', 'ou_cfg', 'ou_target_4'])
    expect(accounts['user-4'].cardCallbackPath).toBe('/feishu/user-4/card-action')
    expect(accounts['user-4'].cardVerificationToken).toBe('verify_token_4')
    expect(accounts['user-4'].cardEncryptKey).toBe('encrypt_key_4')
    expect(accounts['user-4'].cardConfirmUrl).toBe('https://example.com/api/openclaw/commands/confirm')
    expect(accounts['user-4'].cardConfirmAuthToken).toBe('confirm_auth_4')
    expect(accounts['user-4'].cardConfirmTimeoutMs).toBe(12000)
  })

  it('supports appSecretFile as user credential source', async () => {
    hoisted.queryMock.mockResolvedValueOnce([
      { user_id: 5, key: 'feishu_app_id', value: 'cli_file', encrypted_value: null, is_sensitive: false },
      {
        user_id: 5,
        key: 'feishu_app_secret_file',
        value: '/secrets/feishu-app-secret',
        encrypted_value: null,
        is_sensitive: false,
      },
    ])

    const accounts = await collectUserFeishuAccounts()

    expect(accounts['user-5']).toBeDefined()
    expect(accounts['user-5'].appId).toBe('cli_file')
    expect(accounts['user-5'].appSecret).toBeUndefined()
    expect(accounts['user-5'].appSecretFile).toBe('/secrets/feishu-app-secret')
  })

  it('collects binding accounts without decrypting sensitive fields', async () => {
    hoisted.queryMock.mockResolvedValueOnce([
      { user_id: 6, key: 'feishu_allow_from', value: '["ou_cfg"]', encrypted_value: null, is_sensitive: false },
      { user_id: 6, key: 'feishu_target', value: 'feishu:ou_target_6', encrypted_value: null, is_sensitive: false },
      { user_id: 6, key: 'feishu_auth_mode', value: 'strict', encrypted_value: null, is_sensitive: false },
      { user_id: 6, key: 'feishu_require_tenant_key', value: 'true', encrypted_value: null, is_sensitive: false },
      { user_id: 6, key: 'feishu_strict_auto_bind', value: 'false', encrypted_value: null, is_sensitive: false },
      {
        user_id: 6,
        key: 'feishu_app_secret',
        value: null,
        encrypted_value: 'never-read-in-binding-collector',
        is_sensitive: true,
      },
    ])

    const accounts = await collectUserFeishuBindingAccounts()

    expect(accounts['user-6']).toBeDefined()
    expect(accounts['user-6'].allowFrom).toEqual(['ou_cfg', 'ou_target_6'])
    expect(accounts['user-6'].authMode).toBe('strict')
    expect(accounts['user-6'].requireTenantKey).toBe(true)
    expect(accounts['user-6'].strictAutoBind).toBe(false)
    expect(hoisted.decryptMock).not.toHaveBeenCalled()
  })
})
