import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isCreativeKeywordAiSourceSubtypeEnabled,
  isCreativeKeywordSourcePriorityUnifiedEnabled,
  isCreativeKeywordSupplementThresholdGateEnabled,
} from '../creative-keyword-feature-flags'

describe('creative-keyword-feature-flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('enables all keyword refactor flags by default', () => {
    expect(isCreativeKeywordSourcePriorityUnifiedEnabled()).toBe(true)
    expect(isCreativeKeywordSupplementThresholdGateEnabled()).toBe(true)
    expect(isCreativeKeywordAiSourceSubtypeEnabled()).toBe(true)
  })

  it('supports explicit false/off values for rollback', () => {
    vi.stubEnv('CREATIVE_KEYWORD_SOURCE_PRIORITY_UNIFIED_ENABLED', 'false')
    vi.stubEnv('CREATIVE_KEYWORD_SUPPLEMENT_THRESHOLD_GATE_ENABLED', 'off')
    vi.stubEnv('CREATIVE_KEYWORD_AI_SOURCE_SUBTYPE_ENABLED', '0')

    expect(isCreativeKeywordSourcePriorityUnifiedEnabled()).toBe(false)
    expect(isCreativeKeywordSupplementThresholdGateEnabled()).toBe(false)
    expect(isCreativeKeywordAiSourceSubtypeEnabled()).toBe(false)
  })

  it('supports explicit true/on values', () => {
    vi.stubEnv('CREATIVE_KEYWORD_SOURCE_PRIORITY_UNIFIED_ENABLED', 'true')
    vi.stubEnv('CREATIVE_KEYWORD_SUPPLEMENT_THRESHOLD_GATE_ENABLED', 'on')
    vi.stubEnv('CREATIVE_KEYWORD_AI_SOURCE_SUBTYPE_ENABLED', '1')

    expect(isCreativeKeywordSourcePriorityUnifiedEnabled()).toBe(true)
    expect(isCreativeKeywordSupplementThresholdGateEnabled()).toBe(true)
    expect(isCreativeKeywordAiSourceSubtypeEnabled()).toBe(true)
  })
})
