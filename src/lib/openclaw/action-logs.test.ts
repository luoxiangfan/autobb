import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  exec: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: mocks.getDatabase,
}))

import { recordOpenclawAction } from './action-logs'

describe('openclaw action logs redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.exec.mockResolvedValue({ changes: 1 })
    mocks.getDatabase.mockResolvedValue({ exec: mocks.exec })
  })

  it('redacts accessToken/refreshToken/authorization fields before persistence', async () => {
    await recordOpenclawAction({
      userId: 1,
      action: 'GET /api/google-ads-accounts',
      responseBody: JSON.stringify({
        accounts: [
          {
            id: 810,
            accessToken: 'ya29.secret-access-token',
            refreshToken: 'refresh-secret-token',
            authorization: 'Bearer top-secret-token',
          },
        ],
      }),
      status: 'success',
    })

    const args = mocks.exec.mock.calls[0]?.[1]
    const persistedResponseBody = String(args?.[7] || '')

    expect(persistedResponseBody).toContain('"accessToken":"***"')
    expect(persistedResponseBody).toContain('"refreshToken":"***"')
    expect(persistedResponseBody).toContain('"authorization":"***"')
    expect(persistedResponseBody).not.toContain('secret-access-token')
    expect(persistedResponseBody).not.toContain('refresh-secret-token')
    expect(persistedResponseBody).not.toContain('top-secret-token')
  })
})
