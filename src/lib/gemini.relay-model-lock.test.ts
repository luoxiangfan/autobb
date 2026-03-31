import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GEMINI_ACTIVE_MODEL, RELAY_GPT_52_MODEL } from './gemini-models'

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
  getSetting: vi.fn(async (category: string, key: string, userId?: number) => {
    return getSettingValue(category, key, userId)
  }),
}))

const axiosGenerate = vi.fn(async (...args: any[]) => {
  const params = args[0]
  return {
    text: 'ok-from-relay',
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    model: params.model,
  }
})

vi.mock('./gemini-axios', () => ({
  generateContent: axiosGenerate,
}))

describe('Gemini relay model lock', () => {
  beforeEach(() => {
    settingStore.clear()
    axiosGenerate.mockClear()
  })

  it('locks relay calls to user-saved model even when caller passes another model', async () => {
    const userId = 1001

    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'relay')
    settingStore.set(getStoreKey('ai', 'gemini_relay_api_key', userId), 'relay-key')
    settingStore.set(getStoreKey('ai', 'gemini_model', userId), RELAY_GPT_52_MODEL)

    const { generateContent } = await import('./gemini')
    const result = await generateContent(
      {
        prompt: 'hello',
        model: GEMINI_ACTIVE_MODEL,
        enableAutoModelSelection: false,
      },
      userId
    )

    expect(axiosGenerate).toHaveBeenCalledTimes(1)
    expect(axiosGenerate.mock.calls[0]?.[0]?.model).toBe(RELAY_GPT_52_MODEL)
    expect(result.model).toBe(RELAY_GPT_52_MODEL)
  })

  it('uses user-saved model when no model/operationType is provided', async () => {
    const userId = 1002

    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'relay')
    settingStore.set(getStoreKey('ai', 'gemini_relay_api_key', userId), 'relay-key')
    settingStore.set(getStoreKey('ai', 'gemini_model', userId), RELAY_GPT_52_MODEL)

    const { generateContent } = await import('./gemini')
    await generateContent(
      {
        prompt: 'hello',
        enableAutoModelSelection: false,
      },
      userId
    )

    expect(axiosGenerate).toHaveBeenCalledTimes(1)
    expect(axiosGenerate.mock.calls[0]?.[0]?.model).toBe(RELAY_GPT_52_MODEL)
  })

  it('always follows the latest saved relay model', async () => {
    const userId = 1003

    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'relay')
    settingStore.set(getStoreKey('ai', 'gemini_relay_api_key', userId), 'relay-key')
    settingStore.set(getStoreKey('ai', 'gemini_model', userId), RELAY_GPT_52_MODEL)

    const { generateContent } = await import('./gemini')

    await generateContent(
      {
        prompt: 'hello',
        model: GEMINI_ACTIVE_MODEL,
        enableAutoModelSelection: false,
      },
      userId
    )
    expect(axiosGenerate.mock.calls[0]?.[0]?.model).toBe(RELAY_GPT_52_MODEL)

    settingStore.set(getStoreKey('ai', 'gemini_model', userId), GEMINI_ACTIVE_MODEL)

    await generateContent(
      {
        prompt: 'hello again',
        model: RELAY_GPT_52_MODEL,
        enableAutoModelSelection: false,
      },
      userId
    )
    expect(axiosGenerate.mock.calls[1]?.[0]?.model).toBe(GEMINI_ACTIVE_MODEL)
  })

  it('keeps user-level isolation and never reuses another user relay config', async () => {
    const userA = 2001
    const userB = 2002

    settingStore.set(getStoreKey('ai', 'gemini_provider', userA), 'relay')
    settingStore.set(getStoreKey('ai', 'gemini_relay_api_key', userA), 'relay-key-a')
    settingStore.set(getStoreKey('ai', 'gemini_model', userA), RELAY_GPT_52_MODEL)

    const { generateContent } = await import('./gemini')

    await expect(generateContent(
      {
        prompt: 'user-b-request',
        enableAutoModelSelection: false,
      },
      userB
    )).rejects.toThrow('AI配置缺失')

    expect(axiosGenerate).toHaveBeenCalledTimes(0)
  })

  it('forces official provider for schema-required calls when official key exists', async () => {
    const userId = 3001

    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'relay')
    settingStore.set(getStoreKey('ai', 'gemini_relay_api_key', userId), 'relay-key')
    settingStore.set(getStoreKey('ai', 'gemini_api_key', userId), 'official-key')
    settingStore.set(getStoreKey('ai', 'gemini_model', userId), RELAY_GPT_52_MODEL)

    const { generateContent } = await import('./gemini')
    await generateContent(
      {
        prompt: 'structured output',
        model: GEMINI_ACTIVE_MODEL,
        enableAutoModelSelection: false,
        responseSchema: { type: 'OBJECT' },
        requireSchemaSupport: true,
      },
      userId
    )

    expect(axiosGenerate).toHaveBeenCalledTimes(1)
    expect(axiosGenerate.mock.calls[0]?.[0]?.model).toBe(GEMINI_ACTIVE_MODEL)
    expect(axiosGenerate.mock.calls[0]?.[2]).toEqual({
      provider: 'official',
      apiKey: 'official-key',
    })
  })

  it('falls back to relay when schema-required calls have no official key', async () => {
    const userId = 3002

    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'relay')
    settingStore.set(getStoreKey('ai', 'gemini_relay_api_key', userId), 'relay-key')
    settingStore.set(getStoreKey('ai', 'gemini_model', userId), RELAY_GPT_52_MODEL)

    const { generateContent } = await import('./gemini')
    await generateContent(
      {
        prompt: 'structured output',
        model: GEMINI_ACTIVE_MODEL,
        enableAutoModelSelection: false,
        responseSchema: { type: 'OBJECT' },
        requireSchemaSupport: true,
      },
      userId
    )

    expect(axiosGenerate).toHaveBeenCalledTimes(1)
    expect(axiosGenerate.mock.calls[0]?.[0]?.model).toBe(RELAY_GPT_52_MODEL)
    expect(axiosGenerate.mock.calls[0]?.[2]).toBeUndefined()
  })
})
