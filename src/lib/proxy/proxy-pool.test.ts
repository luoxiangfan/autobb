import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db', () => ({
  getDatabase: vi.fn(),
}))

const fetchProxyIp = vi.fn()
vi.mock('./fetch-proxy-ip', () => ({
  fetchProxyIp,
  getProxyIp: vi.fn(),
}))

import { getDatabase } from '../db'
import { ProxyPoolManager } from './proxy-pool'

describe('ProxyPoolManager country alias matching', () => {
  const queryOne = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    queryOne.mockReset()
    fetchProxyIp.mockReset()

    vi.mocked(getDatabase).mockResolvedValue({
      queryOne,
    } as any)
  })

  it('uses UK proxy config when target country is GB', async () => {
    queryOne.mockResolvedValue({
      value: JSON.stringify([
        {
          country: 'UK',
          url: 'gate.kookeey.info:1000:user:pass',
        },
      ]),
    })

    fetchProxyIp.mockResolvedValue({
      host: '2.2.2.2',
      port: 8000,
      username: 'u',
      password: 'p',
    })

    const manager = new ProxyPoolManager({
      countries: ['GB'],
      maxPoolSize: 1,
    })

    const proxy = await manager.getHealthyProxy('GB')

    expect(proxy).toBeTruthy()
    expect(proxy?.country).toBe('GB')
    expect(fetchProxyIp).toHaveBeenCalledWith('gate.kookeey.info:1000:user:pass')
  })
})

