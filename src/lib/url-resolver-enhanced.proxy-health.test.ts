import { describe, it, expect, vi, beforeEach } from 'vitest'

const getProxyIp = vi.fn(async () => ({
  host: '1.2.3.4',
  port: 3128,
  username: 'u',
  password: 'p',
  fullAddress: '1.2.3.4:3128',
}))

vi.mock('@/lib/proxy/fetch-proxy-ip', () => ({
  getProxyIp,
}))

const agentCtor = vi.fn()
vi.mock('https-proxy-agent', () => ({
  HttpsProxyAgent: function (address: string) {
    agentCtor(address)
    return {} as any
  },
}))

const axiosHead = vi.fn(async () => ({}))
vi.mock('axios', () => ({
  default: { head: axiosHead },
}))

describe('ProxyPoolManager.checkProxyHealth', () => {
  beforeEach(() => {
    getProxyIp.mockClear()
    agentCtor.mockClear()
    axiosHead.mockClear()
  })

  it('resolves provider URL (IPRocket) to proxy address before creating agent', async () => {
    const { ProxyPoolManager } = await import('./url-resolver-enhanced')
    const pool = new ProxyPoolManager()

    const providerUrl = 'https://api.iprocket.io/api?username=x&password=y&cc=US&ips=1&proxyType=http&responseType=txt'
    const ok = await pool.checkProxyHealth(providerUrl, 1000)

    expect(ok).toBe(true)
    expect(getProxyIp).toHaveBeenCalledWith(providerUrl, false)
    expect(agentCtor).toHaveBeenCalledWith('http://u:p@1.2.3.4:3128')
    expect(axiosHead).toHaveBeenCalled()
  })

  it('does not call getProxyIp for direct proxy URLs', async () => {
    const { ProxyPoolManager } = await import('./url-resolver-enhanced')
    const pool = new ProxyPoolManager()

    const directProxyUrl = 'http://user:pass@8.8.8.8:8080'
    const ok = await pool.checkProxyHealth(directProxyUrl, 1000)

    expect(ok).toBe(true)
    expect(getProxyIp).not.toHaveBeenCalled()
    expect(agentCtor).toHaveBeenCalledWith(directProxyUrl)
    expect(axiosHead).toHaveBeenCalled()
  })
})

