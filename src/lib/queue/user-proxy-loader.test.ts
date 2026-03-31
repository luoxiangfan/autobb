import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
}))

import { getDatabase } from '@/lib/db'
import { convertUserProxiesToQueueFormat, getProxyForCountry } from './user-proxy-loader'

describe('user-proxy-loader', () => {
  const queryOne = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    queryOne.mockReset()

    vi.mocked(getDatabase).mockResolvedValue({
      queryOne,
    } as any)
  })

  it('supports host:port:user:pass proxy format', () => {
    const result = convertUserProxiesToQueueFormat([
      {
        country: 'US',
        url: 'gate.kookeey.info:1000:user_abc:pwd_xyz',
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      host: 'gate.kookeey.info',
      port: 1000,
      username: 'user_abc',
      password: 'pwd_xyz',
      protocol: 'http',
      country: 'US',
      originalUrl: 'gate.kookeey.info:1000:user_abc:pwd_xyz',
    })
  })

  it('matches GB target against UK-only proxy config via aliases', async () => {
    queryOne.mockResolvedValue({
      value: JSON.stringify([
        {
          country: 'UK',
          url: 'proxy.uk.example:8080:user:pass',
        },
      ]),
      encrypted_value: null,
      is_sensitive: false,
    })

    const proxy = await getProxyForCountry('GB', 88)

    expect(proxy).toBeTruthy()
    expect(proxy?.originalUrl).toBe('proxy.uk.example:8080:user:pass')
    expect(proxy?.country).toBe('GB')
  })
})

