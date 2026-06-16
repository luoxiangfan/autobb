import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUserOnlySetting: vi.fn(),
  fetchProxyIp: vi.fn(),
}))

vi.mock('@/lib/common/server', () => ({
  getUserOnlySetting: mocks.getUserOnlySetting,
}))

vi.mock('@/lib/proxy/fetch-proxy-ip', () => ({
  fetchProxyIp: mocks.fetchProxyIp,
}))

import { UserIsolatedProxyPoolManager } from '@/lib/proxy/user-isolated-proxy-pool'

describe('UserIsolatedProxyPoolManager country alias matching', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getUserOnlySetting.mockReset()
    mocks.fetchProxyIp.mockReset()
  })

  it('resolves GB request with UK-only proxy setting', async () => {
    mocks.getUserOnlySetting.mockResolvedValue({
      value: JSON.stringify([
        {
          country: 'UK',
          url: 'gate.kookeey.info:1000:user:pass',
        },
      ]),
    })

    mocks.fetchProxyIp.mockResolvedValue({
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
    expect(mocks.fetchProxyIp).toHaveBeenCalledWith('gate.kookeey.info:1000:user:pass')
  })
})
