import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDatabaseMock } = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
}))

const { collectUserFeishuAccountsMock } = vi.hoisted(() => ({
  collectUserFeishuAccountsMock: vi.fn(),
}))

vi.mock('../db', () => ({
  getDatabase: getDatabaseMock,
}))

vi.mock('../openclaw/feishu-accounts', () => ({
  parseFeishuAccountUserId: (accountId?: string | null) => {
    if (!accountId) return null
    const normalized = accountId.trim()
    if (!normalized.startsWith('user-')) return null
    const parsed = Number(normalized.slice('user-'.length))
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  },
  collectUserFeishuBindingAccounts: collectUserFeishuAccountsMock,
}))

import {
  resolveOpenclawUserFromBinding,
  resolveOpenclawUserFromBindingDebug,
} from '../openclaw/bindings'

describe('openclaw bindings isolation', () => {
  const previousAuthMode = process.env.OPENCLAW_FEISHU_AUTH_MODE
  const previousRequireTenant = process.env.OPENCLAW_FEISHU_REQUIRE_TENANT_KEY
  const previousStrictAutoBind = process.env.OPENCLAW_FEISHU_STRICT_AUTO_BIND

  beforeEach(() => {
    getDatabaseMock.mockReset()
    collectUserFeishuAccountsMock.mockReset()
    collectUserFeishuAccountsMock.mockResolvedValue({})
    process.env.OPENCLAW_FEISHU_AUTH_MODE = 'compat'
    process.env.OPENCLAW_FEISHU_REQUIRE_TENANT_KEY = 'true'
    process.env.OPENCLAW_FEISHU_STRICT_AUTO_BIND = 'true'
  })

  afterEach(() => {
    if (previousAuthMode === undefined) {
      delete process.env.OPENCLAW_FEISHU_AUTH_MODE
    } else {
      process.env.OPENCLAW_FEISHU_AUTH_MODE = previousAuthMode
    }

    if (previousRequireTenant === undefined) {
      delete process.env.OPENCLAW_FEISHU_REQUIRE_TENANT_KEY
    } else {
      process.env.OPENCLAW_FEISHU_REQUIRE_TENANT_KEY = previousRequireTenant
    }

    if (previousStrictAutoBind === undefined) {
      delete process.env.OPENCLAW_FEISHU_STRICT_AUTO_BIND
    } else {
      process.env.OPENCLAW_FEISHU_STRICT_AUTO_BIND = previousStrictAutoBind
    }
  })

  it('returns user id directly from feishu accountId', async () => {
    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_xxx', {
      accountId: 'user-42',
    })

    expect(result).toBe(42)
    expect(getDatabaseMock).not.toHaveBeenCalled()
  })

  it('requires tenant key for feishu sender binding', async () => {
    collectUserFeishuAccountsMock.mockResolvedValue({})

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_xxx', {
      tenantKey: '   ',
    })

    expect(result).toBeNull()
    expect(getDatabaseMock).not.toHaveBeenCalled()
    expect(collectUserFeishuAccountsMock).toHaveBeenCalledTimes(1)
  })

  it('resolves feishu user only from tenant-scoped binding', async () => {
    collectUserFeishuAccountsMock.mockResolvedValue({})

    const queryOne = vi.fn().mockResolvedValue({ user_id: 7 })
    getDatabaseMock.mockResolvedValue({ queryOne })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_xxx', {
      tenantKey: 'tenant-abc',
    })

    expect(result).toBe(7)
    expect(queryOne).toHaveBeenCalledTimes(1)
    expect(queryOne.mock.calls[0]?.[1]).toEqual(['feishu', 'tenant-abc', 'ou_xxx', 'ou_xxx'])
    expect(collectUserFeishuAccountsMock).not.toHaveBeenCalled()
  })

  it('falls back to unique feishu allowlist match without tenant key', async () => {
    collectUserFeishuAccountsMock.mockResolvedValue({
      'user-7': { allowFrom: ['ou_abc'] },
      'user-9': { allowFrom: ['ou_other'] },
    })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_abc', {
      tenantKey: '   ',
    })

    expect(result).toBe(7)
    expect(getDatabaseMock).not.toHaveBeenCalled()
    expect(collectUserFeishuAccountsMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to unique feishu allowlist match when tenant-scoped binding misses', async () => {
    collectUserFeishuAccountsMock.mockResolvedValue({
      'user-11': { allowFrom: ['feishu:ou_fallback'] },
    })

    const queryOne = vi.fn().mockResolvedValue(null)
    getDatabaseMock.mockResolvedValue({ queryOne })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_fallback', {
      tenantKey: 'tenant-abc',
    })

    expect(result).toBe(11)
    expect(queryOne).toHaveBeenCalledTimes(1)
    expect(collectUserFeishuAccountsMock).toHaveBeenCalledTimes(1)
  })

  it('returns null when feishu allowlist matches multiple users', async () => {
    collectUserFeishuAccountsMock.mockResolvedValue({
      'user-7': { allowFrom: ['ou_dup'] },
      'user-8': { allowFrom: ['ou_dup'] },
    })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_dup', {
      tenantKey: null,
    })

    expect(result).toBeNull()
    expect(getDatabaseMock).not.toHaveBeenCalled()
  })

  it('keeps non-feishu fallback lookup when scoped binding misses', async () => {
    const queryOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user_id: 9 })
    getDatabaseMock.mockResolvedValue({ queryOne })

    const result = await resolveOpenclawUserFromBinding('slack', 'u_123', {
      tenantKey: 'tenant-xyz',
    })

    expect(result).toBe(9)
    expect(queryOne).toHaveBeenCalledTimes(2)
  })

  it('uses strict mode: requires tenant key when configured', async () => {
    process.env.OPENCLAW_FEISHU_AUTH_MODE = 'strict'
    process.env.OPENCLAW_FEISHU_REQUIRE_TENANT_KEY = 'true'

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_abc', {
      accountId: 'user-7',
      tenantKey: null,
    })

    expect(result).toBeNull()
    expect(getDatabaseMock).not.toHaveBeenCalled()
  })

  it('uses strict mode: allows configured allowlist sender without tenant key', async () => {
    process.env.OPENCLAW_FEISHU_AUTH_MODE = 'strict'
    process.env.OPENCLAW_FEISHU_REQUIRE_TENANT_KEY = 'true'
    collectUserFeishuAccountsMock.mockResolvedValue({
      'user-7': { authMode: 'strict', allowFrom: ['ou_abc'] },
    })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_abc', {
      accountId: 'user-7',
      tenantKey: null,
    })

    expect(result).toBe(7)
    expect(getDatabaseMock).not.toHaveBeenCalled()
  })

  it('uses strict mode: resolves main account callback by unique allowlist', async () => {
    process.env.OPENCLAW_FEISHU_AUTH_MODE = 'strict'
    process.env.OPENCLAW_FEISHU_REQUIRE_TENANT_KEY = 'true'
    collectUserFeishuAccountsMock.mockResolvedValue({
      'user-7': { authMode: 'strict', allowFrom: ['ou_main'] },
    })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_main', {
      accountId: 'main',
      tenantKey: null,
    })

    expect(result).toBe(7)
    expect(getDatabaseMock).not.toHaveBeenCalled()
  })

  it('uses strict mode: resolves via tenant binding', async () => {
    process.env.OPENCLAW_FEISHU_AUTH_MODE = 'strict'
    collectUserFeishuAccountsMock.mockResolvedValue({
      'user-7': { authMode: 'strict' },
    })

    const queryOne = vi.fn().mockResolvedValue({ user_id: 7 })
    getDatabaseMock.mockResolvedValue({ queryOne, exec: vi.fn() })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_abc', {
      accountId: 'user-7',
      tenantKey: 'tenant-1',
    })

    expect(result).toBe(7)
    expect(queryOne).toHaveBeenCalledTimes(1)
    expect(collectUserFeishuAccountsMock).toHaveBeenCalledTimes(1)
  })

  it('uses strict mode: auto-binds when tenant binding is missing', async () => {
    process.env.OPENCLAW_FEISHU_AUTH_MODE = 'strict'
    process.env.OPENCLAW_FEISHU_STRICT_AUTO_BIND = 'true'

    const queryOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    const exec = vi.fn().mockResolvedValue({ changes: 1 })
    getDatabaseMock.mockResolvedValue({ queryOne, exec, type: 'postgres' })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_new', {
      accountId: 'user-11',
      tenantKey: 'tenant-11',
    })

    expect(result).toBe(11)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0]?.[0]).toContain('INSERT INTO openclaw_user_bindings')
  })

  it('uses strict mode: tolerates duplicate insert from concurrent auto-bind', async () => {
    process.env.OPENCLAW_FEISHU_AUTH_MODE = 'strict'
    process.env.OPENCLAW_FEISHU_STRICT_AUTO_BIND = 'true'

    const duplicate = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    })
    const queryOne = vi.fn()
      .mockResolvedValueOnce(null) // findFeishuTenantBinding
      .mockResolvedValueOnce(null) // ensureStrictFeishuBinding existing (scoped)
      .mockResolvedValueOnce({ id: 101, user_id: 11 }) // scopedAfterConflict
    const exec = vi.fn().mockRejectedValueOnce(duplicate)
    getDatabaseMock.mockResolvedValue({ queryOne, exec, type: 'postgres' })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_race', {
      accountId: 'user-11',
      tenantKey: 'tenant-race',
    })

    expect(result).toBe(11)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('uses strict mode: rejects duplicate insert when legacy binding belongs to another user', async () => {
    process.env.OPENCLAW_FEISHU_AUTH_MODE = 'strict'
    process.env.OPENCLAW_FEISHU_STRICT_AUTO_BIND = 'true'

    const duplicate = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    })
    const queryOne = vi.fn()
      .mockResolvedValueOnce(null) // findFeishuTenantBinding
      .mockResolvedValueOnce(null) // ensureStrictFeishuBinding existing (scoped)
      .mockResolvedValueOnce(null) // scopedAfterConflict
      .mockResolvedValueOnce({ id: 5, user_id: 9 }) // legacyGlobal
    const exec = vi.fn().mockRejectedValueOnce(duplicate)
    getDatabaseMock.mockResolvedValue({ queryOne, exec, type: 'postgres' })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_conflict_legacy', {
      accountId: 'user-11',
      tenantKey: 'tenant-11',
    })

    expect(result).toBeNull()
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('uses strict mode: blocks conflicting existing binding', async () => {
    process.env.OPENCLAW_FEISHU_AUTH_MODE = 'strict'

    const queryOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 99, user_id: 5 })
    const exec = vi.fn()
    getDatabaseMock.mockResolvedValue({ queryOne, exec, type: 'postgres' })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_conflict', {
      accountId: 'user-7',
      tenantKey: 'tenant-7',
    })

    expect(result).toBeNull()
    expect(exec).not.toHaveBeenCalled()
  })

  it('returns debug reason for strict require tenant key rejection', async () => {
    process.env.OPENCLAW_FEISHU_AUTH_MODE = 'strict'
    process.env.OPENCLAW_FEISHU_REQUIRE_TENANT_KEY = 'true'
    collectUserFeishuAccountsMock.mockResolvedValue({
      'user-7': { authMode: 'strict', allowFrom: ['ou_abc'] },
    })

    const resolution = await resolveOpenclawUserFromBindingDebug('feishu', 'ou_not_allowed', {
      accountId: 'user-7',
      tenantKey: null,
    })

    expect(resolution.userId).toBeNull()
    expect(resolution.reason).toBe('strict_require_tenant_key')
    expect(resolution.tenantKeyProvided).toBe(false)
    expect(resolution.authMode).toBe('strict')
  })

  it('returns debug reason for strict auto bind success', async () => {
    process.env.OPENCLAW_FEISHU_AUTH_MODE = 'strict'
    process.env.OPENCLAW_FEISHU_STRICT_AUTO_BIND = 'true'

    const queryOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    const exec = vi.fn().mockResolvedValue({ changes: 1 })
    getDatabaseMock.mockResolvedValue({ queryOne, exec, type: 'postgres' })

    const resolution = await resolveOpenclawUserFromBindingDebug('feishu', 'ou_new', {
      accountId: 'user-11',
      tenantKey: 'tenant-11',
    })

    expect(resolution.userId).toBe(11)
    expect(resolution.reason).toBe('strict_auto_bind_success')
    expect(resolution.tenantKeyProvided).toBe(true)
    expect(resolution.authMode).toBe('strict')
  })

  it('returns debug reason for compat feishu no match', async () => {
    process.env.OPENCLAW_FEISHU_AUTH_MODE = 'compat'
    collectUserFeishuAccountsMock.mockResolvedValue({})

    const resolution = await resolveOpenclawUserFromBindingDebug('feishu', 'ou_missing', {
      tenantKey: null,
    })

    expect(resolution.userId).toBeNull()
    expect(resolution.reason).toBe('channel_binding_no_match')
    expect(resolution.authMode).toBe('compat')
  })
})
