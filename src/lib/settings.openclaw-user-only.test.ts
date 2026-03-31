import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}))

vi.mock('./db', () => ({
  getDatabase: async () => ({
    query: queryMock,
  }),
}))

vi.mock('./crypto', () => ({
  decrypt: (value: string) => `decrypted:${value}`,
  encrypt: (value: string) => value,
  hashPassword: async (value: string) => value,
  verifyPassword: async () => true,
  generateRandomKey: () => 'k',
}))

import { getUserOnlySettingsByCategory } from './settings'

describe('getUserOnlySettingsByCategory', () => {
  beforeEach(() => {
    queryMock.mockReset()
  })

  it('queries only user scoped rows and decrypts sensitive values', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 1,
        user_id: 99,
        category: 'openclaw',
        key: 'feishu_app_secret',
        value: null,
        encrypted_value: 'enc-secret',
        data_type: 'string',
        is_sensitive: true,
        is_required: false,
        validation_status: null,
        validation_message: null,
        last_validated_at: null,
        default_value: null,
        description: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ])

    const res = await getUserOnlySettingsByCategory('openclaw', 99)

    expect(queryMock).toHaveBeenCalledWith(
      'SELECT * FROM system_settings WHERE category = ? AND user_id = ? ORDER BY key',
      ['openclaw', 99]
    )
    expect(res).toEqual([
      expect.objectContaining({
        key: 'feishu_app_secret',
        value: 'decrypted:enc-secret',
        isSensitive: true,
      }),
    ])
  })

  it('returns empty list for invalid user id', async () => {
    const res = await getUserOnlySettingsByCategory('openclaw', 0)
    expect(res).toEqual([])
    expect(queryMock).not.toHaveBeenCalled()
  })
})

