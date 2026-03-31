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

describe('gemini-axios MAX_TOKENS runaway handling', () => {
  beforeEach(() => {
    vi.resetModules()
    createMock.mockReset().mockReturnValue({ post: postMock })
    postMock.mockReset()
    getUserOnlySettingMock.mockReset().mockImplementation(async (_category: string, key: string) => {
      if (key === 'gemini_provider') return { value: 'official' }
      if (key === 'gemini_api_key') return { value: 'test-key' }
      return null
    })
  })

  it('skips token bump retry when MAX_TOKENS output is detected as runaway', async () => {
    const runawayTail = `${'1738770420-1200000000-'.repeat(80)}`
    postMock.mockResolvedValueOnce({
      data: {
        candidates: [
          {
            finishReason: 'MAX_TOKENS',
            content: {
              role: 'model',
              parts: [
                {
                  text: `{"headlines":[{"text":"ok"}],"descriptions":[{"text":"ok"}]}${runawayTail}`,
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 16368,
          totalTokenCount: 17368,
        },
      },
    })

    const { generateContent } = await import('./gemini-axios')

    let thrown: any
    try {
      await generateContent({
        prompt: 'test prompt',
        maxOutputTokens: 16384,
      }, 1)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeTruthy()
    expect(thrown.code).toBe('MAX_TOKENS')
    expect(thrown.isRunawayCandidate).toBe(true)
    expect(postMock).toHaveBeenCalledTimes(1)
  })
})
