import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    queryOne: dbMocks.queryOne,
  })),
}))

vi.mock('@/lib/db-helpers', () => ({
  boolCondition: () => 'is_active = 1',
}))

import {
  hasConfiguredGoogleAdsAuth,
  resolveGoogleAdsApiAccessLevel,
} from '@/lib/google-ads-auth-assignment'

describe('google-ads shared auth resolution helpers', () => {
  beforeEach(() => {
    dbMocks.queryOne.mockReset()
  })

  it('hasConfiguredGoogleAdsAuth returns true for shared service account user', async () => {
    dbMocks.queryOne
      .mockResolvedValueOnce({
        user_id: 2,
        assignment_mode: 'shared_admin',
        shared_admin_user_id: 1,
        auth_type: 'service_account',
        configured_by: 1,
        created_at: '',
        updated_at: '',
      })
      .mockResolvedValueOnce({
        id: 'sa-1',
        mcc_customer_id: '1234567890',
        developer_token: 'token',
        service_account_email: 'sa@test.iam.gserviceaccount.com',
      })

    await expect(hasConfiguredGoogleAdsAuth(2)).resolves.toBe(true)
    expect(dbMocks.queryOne).toHaveBeenCalledTimes(2)
  })

  it('hasConfiguredGoogleAdsAuth returns true for shared oauth user via admin refresh token', async () => {
    dbMocks.queryOne
      .mockResolvedValueOnce({
        user_id: 2,
        assignment_mode: 'shared_admin',
        shared_admin_user_id: 1,
        auth_type: 'oauth',
        configured_by: 1,
        created_at: '',
        updated_at: '',
      })
      .mockResolvedValueOnce({
        user_id: 1,
        refresh_token: 'refresh-token',
        is_active: 1,
      })

    await expect(hasConfiguredGoogleAdsAuth(2)).resolves.toBe(true)
  })

  it('resolveGoogleAdsApiAccessLevel reads service account level from admin for shared user', async () => {
    dbMocks.queryOne
      .mockResolvedValueOnce({
        user_id: 2,
        assignment_mode: 'shared_admin',
        shared_admin_user_id: 1,
        auth_type: 'service_account',
        configured_by: 1,
        created_at: '',
        updated_at: '',
      })
      .mockResolvedValueOnce({
        id: 'sa-1',
        mcc_customer_id: '1234567890',
        developer_token: 'token',
        service_account_email: 'sa@test.iam.gserviceaccount.com',
        api_access_level: 'basic',
      })

    await expect(resolveGoogleAdsApiAccessLevel(2)).resolves.toBe('basic')
  })

  it('hasConfiguredGoogleAdsAuth returns false for shared oauth when admin only has service account', async () => {
    dbMocks.queryOne
      .mockResolvedValueOnce({
        user_id: 2,
        assignment_mode: 'shared_admin',
        shared_admin_user_id: 1,
        auth_type: 'oauth',
        configured_by: 1,
        created_at: '',
        updated_at: '',
      })
      .mockResolvedValueOnce(null)

    await expect(hasConfiguredGoogleAdsAuth(2)).resolves.toBe(false)
    expect(dbMocks.queryOne).toHaveBeenCalledTimes(2)
  })
})
