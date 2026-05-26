import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  processMccChildAccounts,
  type MccChildAccountsSyncContext,
} from '../google-ads-accounts-mcc-children'

const upsertFns = vi.hoisted(() => ({
  upsertAccount: vi.fn(),
}))

const pythonFns = vi.hoisted(() => ({
  executeGAQLQueryPython: vi.fn(),
}))

vi.mock('../google-ads-accounts-cache', () => ({
  upsertAccount: upsertFns.upsertAccount,
}))

vi.mock('@/lib/python-ads-client', () => ({
  executeGAQLQueryPython: pythonFns.executeGAQLQueryPython,
}))

vi.mock('../google-ads-api-tracker', () => ({
  trackApiUsage: vi.fn().mockResolvedValue(undefined),
  ApiOperationType: { SEARCH: 'SEARCH' },
}))

function buildCtx(overrides?: Partial<MccChildAccountsSyncContext>): MccChildAccountsSyncContext {
  const accountMap = new Map<string, unknown>()
  const expandedManagerIds = new Set<string>()
  const pendingManagerIds: string[] = []

  return {
    userId: 1,
    credentials: { refresh_token: 'rt', login_customer_id: '111' },
    authType: 'service_account',
    serviceAccountConfig: { id: 'sa-1' },
    isServiceAccount: true,
    clientId: 'cid',
    clientSecret: 'secret',
    developerToken: 'dev-token-abcdefghijklmnopqrst',
    authScope: { authType: 'service_account', serviceAccountId: 'sa-1' },
    accountMap,
    expandedManagerIds,
    pendingManagerIds,
    recordAccount: (accountData, dbId, last_sync_at) => {
      accountMap.set(accountData.customer_id, { ...accountData, db_account_id: dbId, last_sync_at })
    },
    ...overrides,
  }
}

describe('processMccChildAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertFns.upsertAccount.mockResolvedValue({ id: 1, last_sync_at: '2026-01-01' })
    pythonFns.executeGAQLQueryPython.mockResolvedValue({ results: [] })
  })

  it('skips when manager was already expanded', async () => {
    const ctx = buildCtx()
    ctx.expandedManagerIds.add('999')

    await processMccChildAccounts(ctx, '999')

    expect(pythonFns.executeGAQLQueryPython).not.toHaveBeenCalled()
  })

  it('queries child accounts and marks manager expanded', async () => {
    const ctx = buildCtx()

    await processMccChildAccounts(ctx, '1234567890')

    expect(ctx.expandedManagerIds.has('1234567890')).toBe(true)
    expect(pythonFns.executeGAQLQueryPython).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: '1234567890',
        serviceAccountId: 'sa-1',
      })
    )
  })

  it('upserts enabled non-manager child accounts', async () => {
    const ctx = buildCtx()
    pythonFns.executeGAQLQueryPython.mockResolvedValue({
      results: [
        {
          customer_client: {
            id: '2222222222',
            descriptive_name: 'Child A',
            currency_code: 'USD',
            time_zone: 'UTC',
            manager: false,
            test_account: false,
            status: 'ENABLED',
          },
        },
      ],
    })

    await processMccChildAccounts(ctx, '1234567890')

    expect(upsertFns.upsertAccount).toHaveBeenCalled()
    expect(ctx.accountMap.has('2222222222')).toBe(true)
  })
})
