import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  findUserByIdMock,
  generateTokenMock,
  fetchMock,
} = vi.hoisted(() => ({
  findUserByIdMock: vi.fn(),
  generateTokenMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  findUserById: findUserByIdMock,
}))

vi.mock('@/lib/jwt', () => ({
  generateToken: generateTokenMock,
}))

import { fetchAutoadsAsUser } from '@/lib/openclaw/autoads-client'

describe('openclaw autoads client base url', () => {
  const originalInternalAppUrl = process.env.INTERNAL_APP_URL
  const originalPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL
  const originalPort = process.env.PORT

  beforeEach(() => {
    findUserByIdMock.mockReset()
    findUserByIdMock.mockResolvedValue({
      id: 1001,
      email: 'u@example.com',
      role: 'user',
      package_type: 'trial',
    })

    generateTokenMock.mockReset()
    generateTokenMock.mockReturnValue('jwt-test-token')

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    delete process.env.INTERNAL_APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    process.env.PORT = '3000'
  })

  afterEach(() => {
    if (originalInternalAppUrl === undefined) {
      delete process.env.INTERNAL_APP_URL
    } else {
      process.env.INTERNAL_APP_URL = originalInternalAppUrl
    }

    if (originalPublicAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalPublicAppUrl
    }

    if (originalPort === undefined) {
      delete process.env.PORT
    } else {
      process.env.PORT = originalPort
    }

    vi.unstubAllGlobals()
  })

  it('uses INTERNAL_APP_URL when configured', async () => {
    process.env.INTERNAL_APP_URL = 'http://127.0.0.1:4000/'
    process.env.NEXT_PUBLIC_APP_URL = 'https://public.autoads.dev'

    await fetchAutoadsAsUser({
      userId: 1001,
      path: '/api/sync/trigger',
      method: 'POST',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4000/api/sync/trigger')
  })

  it('falls back to loopback instead of NEXT_PUBLIC_APP_URL', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://public.autoads.dev'
    process.env.PORT = '3123'

    await fetchAutoadsAsUser({
      userId: 1001,
      path: '/api/settings',
      method: 'GET',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3123/api/settings')
  })

  it('throws when INTERNAL_APP_URL is invalid', async () => {
    process.env.INTERNAL_APP_URL = 'autoads-internal:3000'

    await expect(
      fetchAutoadsAsUser({
        userId: 1001,
        path: '/api/settings',
        method: 'GET',
      })
    ).rejects.toThrow('Invalid INTERNAL_APP_URL')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
