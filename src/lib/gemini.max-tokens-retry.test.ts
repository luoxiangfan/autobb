import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GEMINI_ACTIVE_MODEL } from './gemini-models'

type SettingValue = { value: any } | null

const settingStore = new Map<string, any>()
const getStoreKey = (category: string, key: string, userId?: number) =>
  `${userId ?? 'global'}:${category}.${key}`

const getSettingValue = (category: string, key: string, userId?: number): SettingValue => {
  const storeKey = getStoreKey(category, key, userId)
  if (!settingStore.has(storeKey)) return null
  return { value: settingStore.get(storeKey) }
}

vi.mock('./settings', () => ({
  getUserOnlySetting: vi.fn(async (category: string, key: string, userId: number) => {
    return getSettingValue(category, key, userId)
  }),
}))

const axiosGenerate = vi.fn()

vi.mock('./gemini-axios', () => ({
  generateContent: axiosGenerate,
}))

describe('Gemini MAX_TOKENS retry bump', () => {
  beforeEach(() => {
    settingStore.clear()
    axiosGenerate.mockReset()
    vi.resetModules()
  })

  it('retries ad creative generation with the upstream suggested token bump', async () => {
    const userId = 3001
    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'official')
    settingStore.set(getStoreKey('ai', 'gemini_api_key', userId), 'official-key')

    const maxTokensError: any = new Error('Gemini API 输出达到token限制被截断。请增加maxOutputTokens参数。')
    maxTokensError.code = 'MAX_TOKENS'
    maxTokensError.retryMaxOutputTokens = 32768

    axiosGenerate
      .mockRejectedValueOnce(maxTokensError)
      .mockResolvedValueOnce({
        text: '{"headlines":[],"descriptions":[],"keywords":[]}',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        model: GEMINI_ACTIVE_MODEL,
      })

    const { generateContent } = await import('./gemini')
    await generateContent({
      prompt: 'test prompt',
      operationType: 'ad_creative_generation_main',
      model: GEMINI_ACTIVE_MODEL,
      maxOutputTokens: 16384,
    }, userId)

    expect(axiosGenerate).toHaveBeenCalledTimes(2)
    expect(axiosGenerate.mock.calls[0]?.[0]?.maxOutputTokens).toBe(16384)
    expect(axiosGenerate.mock.calls[1]?.[0]?.maxOutputTokens).toBe(32768)
    expect(axiosGenerate.mock.calls[1]?.[0]?.model).toBe(GEMINI_ACTIVE_MODEL)
  })

  it('does not repeat the same prompt bump when upstream marks the MAX_TOKENS failure as runaway', async () => {
    const userId = 3002
    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'official')
    settingStore.set(getStoreKey('ai', 'gemini_api_key', userId), 'official-key')

    const maxTokensError: any = new Error('Gemini API 输出达到token限制被截断。请增加maxOutputTokens参数。')
    maxTokensError.code = 'MAX_TOKENS'
    maxTokensError.retryMaxOutputTokens = 32768
    maxTokensError.isRunawayCandidate = true

    axiosGenerate.mockRejectedValueOnce(maxTokensError)

    const { generateContent } = await import('./gemini')

    await expect(generateContent({
      prompt: 'test prompt',
      operationType: 'ad_creative_generation_main',
      model: GEMINI_ACTIVE_MODEL,
      maxOutputTokens: 16384,
    }, userId)).rejects.toThrow('Gemini API 输出达到token限制被截断')

    expect(axiosGenerate).toHaveBeenCalledTimes(1)
    expect(axiosGenerate.mock.calls[0]?.[0]?.maxOutputTokens).toBe(16384)
  })

  it('uses emergency constrained retry for relay ad creative MAX_TOKENS runaway', async () => {
    const userId = 3005
    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'relay')
    settingStore.set(getStoreKey('ai', 'gemini_relay_api_key', userId), 'relay-key')
    settingStore.set(getStoreKey('ai', 'gemini_model', userId), GEMINI_ACTIVE_MODEL)

    const maxTokensError: any = new Error('Gemini API 输出达到token限制被截断。请增加maxOutputTokens参数。')
    maxTokensError.code = 'MAX_TOKENS'
    maxTokensError.retryMaxOutputTokens = 32768
    maxTokensError.isRunawayCandidate = true

    axiosGenerate
      .mockRejectedValueOnce(maxTokensError)
      .mockResolvedValueOnce({
        text: '{"headlines":[],"descriptions":[],"keywords":[],"callouts":[],"sitelinks":[]}',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        model: GEMINI_ACTIVE_MODEL,
      })

    const { generateContent } = await import('./gemini')
    await generateContent({
      prompt: 'test prompt',
      operationType: 'ad_creative_generation_main',
      model: GEMINI_ACTIVE_MODEL,
      maxOutputTokens: 16384,
      responseSchema: {
        type: 'OBJECT',
        properties: {
          headlines: { type: 'ARRAY' },
        },
      },
    }, userId)

    expect(axiosGenerate).toHaveBeenCalledTimes(2)
    expect(axiosGenerate.mock.calls[0]?.[0]?.maxOutputTokens).toBe(16384)
    expect(axiosGenerate.mock.calls[1]?.[0]?.maxOutputTokens).toBe(8192)
    expect(axiosGenerate.mock.calls[1]?.[0]?.temperature).toBe(0.2)
    expect(String(axiosGenerate.mock.calls[1]?.[0]?.prompt || '')).toContain('## EMERGENCY OUTPUT CONTRACT (CRITICAL)')
  })

  it('auto-disables thinking for structured responseSchema tasks on gemini-3 models', async () => {
    const userId = 3003
    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'official')
    settingStore.set(getStoreKey('ai', 'gemini_api_key', userId), 'official-key')

    axiosGenerate.mockResolvedValueOnce({
      text: '{"ok":true}',
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      model: GEMINI_ACTIVE_MODEL,
    })

    const { generateContent } = await import('./gemini')
    await generateContent({
      prompt: 'return json',
      model: GEMINI_ACTIVE_MODEL,
      enableAutoModelSelection: false,
      responseSchema: {
        type: 'OBJECT',
        properties: {
          ok: { type: 'BOOLEAN' },
        },
        required: ['ok'],
      },
    }, userId)

    expect(axiosGenerate).toHaveBeenCalledTimes(1)
    expect(axiosGenerate.mock.calls[0]?.[0]?.thinkingBudget).toBe(0)
  })

  it('respects explicit thinkingBudget for structured responseSchema tasks', async () => {
    const userId = 3004
    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'official')
    settingStore.set(getStoreKey('ai', 'gemini_api_key', userId), 'official-key')

    axiosGenerate.mockResolvedValueOnce({
      text: '{"ok":true}',
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      model: GEMINI_ACTIVE_MODEL,
    })

    const { generateContent } = await import('./gemini')
    await generateContent({
      prompt: 'return json',
      model: GEMINI_ACTIVE_MODEL,
      enableAutoModelSelection: false,
      thinkingBudget: 256,
      responseSchema: {
        type: 'OBJECT',
        properties: {
          ok: { type: 'BOOLEAN' },
        },
        required: ['ok'],
      },
    }, userId)

    expect(axiosGenerate).toHaveBeenCalledTimes(1)
    expect(axiosGenerate.mock.calls[0]?.[0]?.thinkingBudget).toBe(256)
  })
})
