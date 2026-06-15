import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  getProxyIp: vi.fn(async () => ({
    host: '1.2.3.4',
    port: 3128,
    username: 'u',
    password: 'p',
    fullAddress: '1.2.3.4:3128',
  })),
  assertUserExecutionAllowed: vi.fn(),
}))

vi.mock('@/lib/click-farm', () => ({
  updateTaskStats: vi.fn(async () => {}),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: mocks.queryOne,
  })),
}))

vi.mock('@/lib/proxy/fetch-proxy-ip', () => ({
  getProxyIp: mocks.getProxyIp,
}))

vi.mock('@/lib/campaign', () => ({
  assertUserExecutionAllowed: mocks.assertUserExecutionAllowed,
}))

const agentCtor = vi.fn()
vi.mock('https-proxy-agent', () => ({
  HttpsProxyAgent: function (address: string) {
    agentCtor(address)
    // minimal agent shape for axios
    return {} as any
  },
}))

const axiosGet = vi.fn(async () => ({ data: { destroy: () => {} } }))
vi.mock('axios', () => ({
  default: { get: axiosGet },
}))

describe('click-farm proxy resolution', () => {
  beforeEach(() => {
    mocks.queryOne.mockReset()
    mocks.queryOne.mockResolvedValue({ status: 'running' })
    mocks.assertUserExecutionAllowed.mockResolvedValue(undefined)
    mocks.getProxyIp.mockClear()
    agentCtor.mockClear()
    axiosGet.mockClear()
  })

  it('resolves IPRocket provider URL via getProxyIp (cached) and builds proxy agent address', async () => {
    const mod = await import('@/lib/queue/executors/click-farm-executor')
    const task = {
      id: 't1',
      type: 'click-farm',
      userId: 1,
      status: 'pending',
      priority: 'normal',
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 0,
      data: {
        taskId: 'cf-task',
        url: 'https://example.com',
        proxyUrl:
          'https://api.iprocket.io/api?username=x&password=y&cc=ROW&ips=1&proxyType=http&responseType=txt',
        offerId: 1,
        timezone: 'America/New_York',
        refererConfig: { type: 'none' },
      },
    } as any

    const result = await mod.executeClickFarmTask(task)

    expect(result.success).toBe(true)
    expect(mocks.getProxyIp).toHaveBeenCalledWith(task.data.proxyUrl, false, 1)
    expect(agentCtor).toHaveBeenCalledWith('http://u:p@1.2.3.4:3128')
    expect(axiosGet).toHaveBeenCalled()
  })

  it('skips execution when click-farm task status is paused', async () => {
    mocks.queryOne.mockResolvedValue({ status: 'paused' })

    const mod = await import('@/lib/queue/executors/click-farm-executor')
    const task = {
      id: 't2',
      type: 'click-farm',
      userId: 1,
      status: 'pending',
      priority: 'normal',
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 0,
      data: {
        taskId: 'cf-paused-task',
        url: 'https://example.com',
        proxyUrl: 'http://127.0.0.1:8080',
        offerId: 1,
        timezone: 'America/New_York',
        refererConfig: { type: 'none' },
      },
    } as any

    const result = await mod.executeClickFarmTask(task)

    expect(result.success).toBe(false)
    expect(result.traffic).toBe(0)
    expect(axiosGet).not.toHaveBeenCalled()
  })
})
