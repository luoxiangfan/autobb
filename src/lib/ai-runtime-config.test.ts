import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GEMINI_ACTIVE_MODEL, RELAY_GPT_52_MODEL } from './gemini-models'

type SettingValue = { value: any } | null

const settingStore = new Map<string, any>()
const getStoreKey = (category: string, key: string, userId: number) =>
  `${userId}:${category}.${key}`

function getSettingValue(category: string, key: string, userId: number): SettingValue {
  const storeKey = getStoreKey(category, key, userId)
  if (!settingStore.has(storeKey)) return null
  return { value: settingStore.get(storeKey) }
}

vi.mock('./settings', () => ({
  getUserOnlySetting: vi.fn(async (category: string, key: string, userId: number) => {
    return getSettingValue(category, key, userId)
  }),
}))

describe('resolveActiveAIConfig', () => {
  beforeEach(() => {
    settingStore.clear()
  })

  it('resolves relay gpt config using user-saved model and relay key', async () => {
    const userId = 3101
    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'relay')
    settingStore.set(getStoreKey('ai', 'gemini_model', userId), RELAY_GPT_52_MODEL)
    settingStore.set(getStoreKey('ai', 'gemini_relay_api_key', userId), 'relay-key-1')

    const { resolveActiveAIConfig } = await import('./ai-runtime-config')
    const config = await resolveActiveAIConfig(userId)

    expect(config.type).toBe('gemini-api')
    expect(config.provider).toBe('relay')
    expect(config.model).toBe(RELAY_GPT_52_MODEL)
    expect(config.endpoint).toBe('https://aicode.cat/v1/responses')
    expect(config.geminiAPI?.provider).toBe('relay')
    expect(config.geminiAPI?.apiKey).toBe('relay-key-1')
  })

  it('does not fallback to official key when relay provider has no relay key', async () => {
    const userId = 3102
    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'relay')
    settingStore.set(getStoreKey('ai', 'gemini_model', userId), RELAY_GPT_52_MODEL)
    settingStore.set(getStoreKey('ai', 'gemini_api_key', userId), 'official-key-only')

    const { resolveActiveAIConfig } = await import('./ai-runtime-config')
    const config = await resolveActiveAIConfig(userId)

    expect(config.type).toBeNull()
    expect(config.provider).toBe('relay')
    expect(config.model).toBe(RELAY_GPT_52_MODEL)
    expect(config.endpoint).toBe('https://aicode.cat/v1/responses')
    expect(config.geminiAPI).toBeUndefined()
  })

  it('normalizes legacy provider value to official mode', async () => {
    const userId = 3103
    settingStore.set(getStoreKey('ai', 'gemini_provider', userId), 'legacy-provider')
    settingStore.set(getStoreKey('ai', 'gemini_model', userId), GEMINI_ACTIVE_MODEL)
    settingStore.set(getStoreKey('ai', 'gemini_api_key', userId), 'official-key-1')

    const { resolveActiveAIConfig } = await import('./ai-runtime-config')
    const config = await resolveActiveAIConfig(userId)

    expect(config.type).toBe('gemini-api')
    expect(config.provider).toBe('official')
    expect(config.model).toBe(GEMINI_ACTIVE_MODEL)
    expect(config.endpoint).toBe('https://generativelanguage.googleapis.com')
    expect(config.geminiAPI?.provider).toBe('official')
    expect(config.geminiAPI?.apiKey).toBe('official-key-1')
  })
})
