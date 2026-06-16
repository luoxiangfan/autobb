import { beforeEach, describe, expect, it, vi } from 'vitest'

const createMock = vi.fn()
const postMock = vi.fn()
const getUserOnlySettingMock = vi.fn()
const redisGetMock = vi.fn()
const redisSetMock = vi.fn()
const redisDelMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: createMock,
  },
  create: createMock,
}))

vi.mock('../common/server', () => ({
  getUserOnlySetting: getUserOnlySettingMock,
}))

vi.mock('../common/server', () => ({
  getRedisClient: vi.fn(() => null),
}))

describe('gemini-axios daily quota breaker', () => {
  beforeEach(() => {
    vi.resetModules()
    createMock.mockReset().mockReturnValue({ post: postMock })
    postMock.mockReset()
    getUserOnlySettingMock
      .mockReset()
      .mockImplementation(async (_category: string, key: string) => {
        if (key === 'gemini_provider') return { value: 'official' }
        if (key === 'gemini_api_key') return { value: 'test-key' }
        return null
      })
    redisGetMock.mockReset()
    redisSetMock.mockReset()
    redisDelMock.mockReset()
  })

  it('opens a breaker on daily quota 429 and short-circuits subsequent requests', async () => {
    postMock.mockRejectedValue({
      response: {
        status: 429,
        headers: {},
        data: {
          error: {
            code: 429,
            message:
              'Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 10000. Please retry in 3600s.',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [
                  {
                    quotaMetric:
                      'generativelanguage.googleapis.com/generate_requests_per_model_per_day',
                    quotaId: 'GenerateRequestsPerDayPerProjectPerModel',
                  },
                ],
              },
              {
                '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                retryDelay: '3600s',
              },
            ],
          },
        },
      },
      message: 'Request failed with status code 429',
    })

    const { generateContent } = await import('../ai/server')

    await expect(generateContent({ prompt: 'hello' }, 1)).rejects.toThrow('每日配额已耗尽')
    await expect(generateContent({ prompt: 'hello again' }, 1)).rejects.toThrow('每日配额已耗尽')

    expect(postMock).toHaveBeenCalledTimes(1)
  })
})
