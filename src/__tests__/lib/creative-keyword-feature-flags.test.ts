import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isCreativeKeywordAiSourceSubtypeEnabled,
  isCreativeKeywordSupplementThresholdGateEnabled,
} from '@/lib/keywords/server'

describe('creative-keyword-feature-flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('enables keyword refactor flags by default', () => {
    expect(isCreativeKeywordSupplementThresholdGateEnabled()).toBe(true)
    expect(isCreativeKeywordAiSourceSubtypeEnabled()).toBe(true)
  })

  it('supports explicit false/off values for rollback', () => {
    vi.stubEnv('CREATIVE_KEYWORD_SUPPLEMENT_THRESHOLD_GATE_ENABLED', 'off')
    vi.stubEnv('CREATIVE_KEYWORD_AI_SOURCE_SUBTYPE_ENABLED', '0')

    expect(isCreativeKeywordSupplementThresholdGateEnabled()).toBe(false)
    expect(isCreativeKeywordAiSourceSubtypeEnabled()).toBe(false)
  })

  it('supports explicit true/on values', () => {
    vi.stubEnv('CREATIVE_KEYWORD_SUPPLEMENT_THRESHOLD_GATE_ENABLED', 'on')
    vi.stubEnv('CREATIVE_KEYWORD_AI_SOURCE_SUBTYPE_ENABLED', '1')

    expect(isCreativeKeywordSupplementThresholdGateEnabled()).toBe(true)
    expect(isCreativeKeywordAiSourceSubtypeEnabled()).toBe(true)
  })
})
