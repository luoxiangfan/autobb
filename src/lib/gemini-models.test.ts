import { describe, expect, it } from 'vitest'
import {
  GEMINI_ACTIVE_MODEL,
  RELAY_GPT_52_MODEL,
  isModelSupportedByProvider,
  normalizeGeminiModel,
  normalizeModelForProvider,
} from './gemini-models'

describe('gemini-models', () => {
  it('normalizes gpt-5.2 as a supported AI model', () => {
    expect(normalizeGeminiModel(RELAY_GPT_52_MODEL)).toBe(RELAY_GPT_52_MODEL)
  })

  it('falls back to Gemini model when provider is official', () => {
    expect(normalizeModelForProvider(RELAY_GPT_52_MODEL, 'official')).toBe(GEMINI_ACTIVE_MODEL)
    expect(isModelSupportedByProvider(RELAY_GPT_52_MODEL, 'official')).toBe(false)
  })

  it('keeps gpt-5.2 when provider is relay', () => {
    expect(normalizeModelForProvider(RELAY_GPT_52_MODEL, 'relay')).toBe(RELAY_GPT_52_MODEL)
    expect(isModelSupportedByProvider(RELAY_GPT_52_MODEL, 'relay')).toBe(true)
  })
})
