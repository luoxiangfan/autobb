import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSettingMock, getOpenclawGatewayTokenMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
  getOpenclawGatewayTokenMock: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getSetting: getSettingMock,
}))

vi.mock('@/lib/openclaw/auth', () => ({
  getOpenclawGatewayToken: getOpenclawGatewayTokenMock,
}))

import {
  invokeOpenclawTool,
  resolveOpenclawGatewayBaseUrl,
  resetOpenclawGatewayInvokeCachesForTests,
} from './gateway'

describe('openclaw gateway base url', () => {
  beforeEach(() => {
    getSettingMock.mockReset()
    getOpenclawGatewayTokenMock.mockReset()
    getOpenclawGatewayTokenMock.mockResolvedValue('gateway-token')
    delete process.env.OPENCLAW_GATEWAY_URL
    delete process.env.OPENCLAW_GATEWAY_MAX_RETRIES
    delete process.env.OPENCLAW_GATEWAY_TIMEOUT_MS
    vi.unstubAllGlobals()
    resetOpenclawGatewayInvokeCachesForTests()
  })

  it('uses environment override first', async () => {
    process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com/'

    const url = await resolveOpenclawGatewayBaseUrl()

    expect(url).toBe('https://gateway.example.com')
    expect(getSettingMock).not.toHaveBeenCalled()
  })

  it('falls back to default port when setting is blank', async () => {
    getSettingMock.mockImplementation(async (_category: string, key: string) => {
      if (key === 'gateway_port') {
        return { value: '   ' }
      }
      return { value: 'loopback' }
    })

    const url = await resolveOpenclawGatewayBaseUrl()

    expect(url).toBe('http://127.0.0.1:18789')
    expect(getSettingMock).toHaveBeenCalledWith('openclaw', 'gateway_port')
    expect(getSettingMock).toHaveBeenCalledWith('openclaw', 'gateway_bind')
  })

  it('falls back to default port when setting is invalid', async () => {
    getSettingMock.mockImplementation(async (_category: string, key: string) => {
      if (key === 'gateway_port') {
        return { value: '0' }
      }
      return { value: 'loopback' }
    })

    const url = await resolveOpenclawGatewayBaseUrl()

    expect(url).toBe('http://127.0.0.1:18789')
  })

  it('uses configured port when setting is valid', async () => {
    getSettingMock.mockImplementation(async (_category: string, key: string) => {
      if (key === 'gateway_port') {
        return { value: '19001' }
      }
      return { value: 'loopback' }
    })

    const url = await resolveOpenclawGatewayBaseUrl()

    expect(url).toBe('http://127.0.0.1:19001')
  })

  it.each([
    'send',
    'reply',
    'thread-reply',
    'sendAttachment',
    'sendWithEffect',
  ])('invokes gateway for allowlisted message action: %s', async (action) => {
    process.env.OPENCLAW_GATEWAY_URL = 'http://127.0.0.1:18789'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, action }),
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)

    const payload = {
      tool: 'message',
      action,
      args: { channel: 'feishu', target: 'ou_xxx', message: 'hello' },
    }

    const result = await invokeOpenclawTool(payload)

    expect(result).toEqual({ ok: true, action })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:18789/tools/invoke')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer gateway-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    expect(fetchMock.mock.calls[0]?.[1]).toHaveProperty('signal')
  })

  it('rejects non-message tool by local policy before network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      invokeOpenclawTool({
        tool: 'sessions_spawn',
        action: 'run',
      })
    ).rejects.toThrow('OpenClaw tool not allowed by AutoAds policy')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(getOpenclawGatewayTokenMock).not.toHaveBeenCalled()
  })

  it('rejects non-allowlisted message action by local policy before network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      invokeOpenclawTool({
        tool: 'message',
        action: 'delete',
      })
    ).rejects.toThrow('OpenClaw message action not allowed by AutoAds policy')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(getOpenclawGatewayTokenMock).not.toHaveBeenCalled()
  })

  it('throws upstream gateway error text when response is not ok', async () => {
    process.env.OPENCLAW_GATEWAY_URL = 'http://127.0.0.1:18789'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'gateway failed',
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      invokeOpenclawTool({
        tool: 'message',
        action: 'send',
        args: { channel: 'feishu', target: 'ou_xxx', message: 'hello' },
      })
    ).rejects.toThrow('OpenClaw gateway error (500): gateway failed')
  })

  it('retries transient gateway status failures', async () => {
    process.env.OPENCLAW_GATEWAY_URL = 'http://127.0.0.1:18789'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => 'bad gateway',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
        text: async () => '',
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await invokeOpenclawTool(
      {
        tool: 'message',
        action: 'send',
        args: { channel: 'feishu', target: 'ou_xxx', message: 'hello' },
      },
      {
        maxRetries: 1,
        retryBaseDelayMs: 1,
      }
    )

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-transient gateway status failures', async () => {
    process.env.OPENCLAW_GATEWAY_URL = 'http://127.0.0.1:18789'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      invokeOpenclawTool(
        {
          tool: 'message',
          action: 'send',
          args: { channel: 'feishu', target: 'ou_xxx', message: 'hello' },
        },
        {
          maxRetries: 3,
          retryBaseDelayMs: 1,
        }
      )
    ).rejects.toThrow('OpenClaw gateway error (400): bad request')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('adds idempotency header when idempotency key is provided', async () => {
    process.env.OPENCLAW_GATEWAY_URL = 'http://127.0.0.1:18789'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)

    await invokeOpenclawTool(
      {
        tool: 'message',
        action: 'send',
        args: { channel: 'feishu', target: 'ou_xxx', message: 'hello' },
      },
      {
        idempotencyKey: 'daily-report:1:2026-02-14',
      }
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: 'Bearer gateway-token',
        'Content-Type': 'application/json',
        'X-Idempotency-Key': 'daily-report:1:2026-02-14',
      },
    })
  })

  it('coalesces in-flight duplicate invocation by idempotency key', async () => {
    process.env.OPENCLAW_GATEWAY_URL = 'http://127.0.0.1:18789'
    const fetchMock = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return {
        ok: true,
        json: async () => ({ ok: true, at: Date.now() }),
        text: async () => '',
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const payload = {
      tool: 'message' as const,
      action: 'send' as const,
      args: { channel: 'feishu', target: 'ou_xxx', message: 'hello' },
    }
    const options = { idempotencyKey: 'coalesce:1', dedupeWindowMs: 0 }

    const [first, second] = await Promise.all([
      invokeOpenclawTool(payload, options),
      invokeOpenclawTool(payload, options),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
  })

  it('returns cached result within dedupe window for same idempotency key', async () => {
    process.env.OPENCLAW_GATEWAY_URL = 'http://127.0.0.1:18789'
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, value: 1 }),
        text: async () => '',
      })
    vi.stubGlobal('fetch', fetchMock)

    const payload = {
      tool: 'message' as const,
      action: 'send' as const,
      args: { channel: 'feishu', target: 'ou_xxx', message: 'hello' },
    }
    const options = { idempotencyKey: 'window:1', dedupeWindowMs: 60_000 }

    const first = await invokeOpenclawTool(payload, options)
    const second = await invokeOpenclawTool(payload, options)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ ok: true, value: 1 })
    expect(second).toEqual({ ok: true, value: 1 })
  })

  it('retries on abort error and finally throws timeout message', async () => {
    process.env.OPENCLAW_GATEWAY_URL = 'http://127.0.0.1:18789'
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const fetchMock = vi.fn().mockRejectedValue(abortError)
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      invokeOpenclawTool(
        {
          tool: 'message',
          action: 'send',
          args: { channel: 'feishu', target: 'ou_xxx', message: 'hello' },
        },
        {
          timeoutMs: 10,
          maxRetries: 1,
          retryBaseDelayMs: 1,
        }
      )
    ).rejects.toThrow('OpenClaw gateway timeout after 10ms')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
