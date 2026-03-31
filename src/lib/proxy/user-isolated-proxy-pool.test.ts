import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUserOnlySetting = vi.fn()
vi.mock('../settings', () => ({
  getUserOnlySetting,
}))

const fetchProxyIp = vi.fn()
vi.mock('./fetch-proxy-ip', () => ({
  fetchProxyIp,
}))

import { UserIsolatedProxyPoolManager } from './user-isolated-proxy-pool'

describe('UserIsolatedProxyPoolManager country alias matching', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getUserOnlySetting.mockReset()
    fetchProxyIp.mockReset()
  })

  it('resolves GB request with UK-only proxy setting', async () => {
    getUserOnlySetting.mockResolvedValue({
      value: JSON.stringify([
        {
          country: 'UK',
          url: 'gate.kookeey.info:1000:user:pass',
        },
      ]),
    })

    fetchProxyIp.mockResolvedValue({
      host: '1.1.1.1',
      port: 9000,
      username: 'u',
      password: 'p',
    })

    const manager = new UserIsolatedProxyPoolManager({
      maxPoolSize: 1,
    })

    const proxy = await manager.getHealthyProxy(88, 'GB')

    expect(proxy).toBeTruthy()
    expect(proxy?.country).toBe('GB')
    expect(fetchProxyIp).toHaveBeenCalledWith('gate.kookeey.info:1000:user:pass')
  })
})

