import { beforeEach, describe, expect, it, vi } from 'vitest'

const createMock = vi.fn()
const postMock = vi.fn()
const getUserOnlySettingMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: createMock,
  },
  create: createMock,
}))

vi.mock('./settings', () => ({
  getUserOnlySetting: getUserOnlySettingMock,
}))

vi.mock('./redis-client', () => ({
  getRedisClient: vi.fn(() => null),
}))

describe('gemini-axios usage parsing', () => {
  beforeEach(() => {
    vi.resetModules()
    createMock.mockReset().mockReturnValue({ post: postMock })
    postMock.mockReset()
    getUserOnlySettingMock.mockReset().mockImplementation(async (_category: string, key: string) => {
      if (key === 'gemini_provider') return { value: 'relay' }
      if (key === 'gemini_relay_api_key') return { value: 'relay-key' }
      return null
    })
  })

  it('parses camelCase usage from relay /v1/messages responses', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        content: [{ type: 'text', text: 'hello from relay messages' }],
        usage: {
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
        },
        model: 'gemini-3-flash-preview',
      },
    })

    const { generateContent } = await import('./gemini-axios')
    const result = await generateContent(
      {
        model: 'gemini-3-flash-preview',
        prompt: 'ping',
      },
      1
    )

    expect(result.text).toContain('hello')
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    })
  })

  it('parses camelCase usage from relay /v1/responses SSE completed event', async () => {
    postMock.mockResolvedValueOnce({
      data: [
        'data: {"type":"response.output_text.delta","delta":"hel"}',
        'data: {"type":"response.output_text.done","text":"hello from responses"}',
        'data: {"type":"response.completed","response":{"model":"gpt-5.2","usage":{"inputTokens":30,"outputTokens":12,"totalTokens":42}}}',
        'data: [DONE]',
      ].join('\n'),
    })

    const { generateContent } = await import('./gemini-axios')
    const result = await generateContent(
      {
        model: 'gpt-5.2',
        prompt: 'ping',
      },
      1
    )

    expect(result.text).toContain('hello')
    expect(result.model).toBe('gpt-5.2')
    expect(result.usage).toEqual({
      inputTokens: 30,
      outputTokens: 12,
      totalTokens: 42,
    })
  })

  it('keeps usage when relay SSE omits completed event but includes usage in stream payload', async () => {
    postMock.mockResolvedValueOnce({
      data: [
        'data: {"type":"response.output_text.done","text":"fallback text","usage":{"prompt_tokens":9,"completion_tokens":4,"total_tokens":13}}',
        'data: [DONE]',
      ].join('\n'),
    })

    const { generateContent } = await import('./gemini-axios')
    const result = await generateContent(
      {
        model: 'gpt-5.2',
        prompt: 'ping',
      },
      1
    )

    expect(result.text).toContain('fallback text')
    expect(result.usage).toEqual({
      inputTokens: 9,
      outputTokens: 4,
      totalTokens: 13,
    })
  })

})
