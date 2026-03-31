/**
 * Auth mustChangePassword 行为测试
 * src/lib/__tests__/auth-must-change-password.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let mockDb: any
let loginWithPassword: typeof import('../auth').loginWithPassword
let generateTokenMock: any

vi.mock('../db', () => ({
  getDatabase: async () => mockDb,
}))

vi.mock('../crypto', () => ({
  verifyPassword: vi.fn(async () => true),
  hashPassword: vi.fn(async () => 'hash'),
}))

vi.mock('../auth-security', () => ({
  checkAccountLockout: vi.fn(async () => undefined),
  recordFailedLogin: vi.fn(async () => undefined),
  resetFailedAttempts: vi.fn(async () => undefined),
  logLoginAttempt: vi.fn(async () => undefined),
}))

vi.mock('../jwt', () => ({
  generateToken: vi.fn(() => 'token'),
  verifyToken: vi.fn(() => null),
}))

function makeUser(overrides: Partial<import('../auth').User> = {}): import('../auth').User {
  return {
    id: 1,
    username: 'autoads',
    email: 'autoads@example.com',
    password_hash: 'hash',
    display_name: 'Autoads',
    google_id: null,
    profile_picture: null,
    role: 'admin',
    package_type: 'trial',
    package_expires_at: null,
    must_change_password: 1,
    is_active: 1,
    last_login_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    failed_login_count: 0,
    locked_until: null,
    last_failed_login: null,
    ...overrides,
  }
}

describe('loginWithPassword mustChangePassword', () => {
  beforeEach(() => {
    mockDb = {
      type: 'sqlite',
      queryOne: vi.fn(),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
    }
  })

  beforeEach(async () => {
    vi.resetModules()
    ;({ loginWithPassword } = await import('../auth'))
    ;({ generateToken: generateTokenMock } = await import('../jwt'))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('管理员账号不强制修改密码', async () => {
    mockDb.queryOne.mockResolvedValueOnce(makeUser({ role: 'admin', must_change_password: 1 }))

    const resp = await loginWithPassword('autoads', 'pw')

    expect(resp.token).toBe('token')
    expect(resp.mustChangePassword).toBe(false)
    expect(generateTokenMock).toHaveBeenCalledWith(expect.objectContaining({ mustChangePassword: false }))
  })

  it('非管理员账号会强制修改密码', async () => {
    mockDb.queryOne.mockResolvedValueOnce(makeUser({ role: 'user', must_change_password: 1 }))

    const resp = await loginWithPassword('user', 'pw')

    expect(resp.mustChangePassword).toBe(true)
    expect(generateTokenMock).toHaveBeenCalledWith(expect.objectContaining({ mustChangePassword: true }))
  })
})

