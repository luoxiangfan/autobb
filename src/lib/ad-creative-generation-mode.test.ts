import { describe, expect, it } from 'vitest'
import {
  AD_CREATIVE_GENERATION_MODE_DEFAULT,
  AD_CREATIVE_GENERATION_MODE_SELECT_LABELS,
  getAdCreativeGenerationModeLabel,
  getAdCreativeGenerationModeProfile,
  getGenerationModeFromRequestBody,
  normalizeAdCreativeGenerationMode,
  resolveCreativeGenerationRuntime,
  resolveStoredGenerationMode,
} from './ad-creative-generation-mode'
import { AD_CREATIVE_MAX_AUTO_RETRIES } from './ad-creative-quality-constants'

describe('ad-creative-generation-mode', () => {
  it('defaults to original mode', () => {
    expect(normalizeAdCreativeGenerationMode(undefined)).toBe(AD_CREATIVE_GENERATION_MODE_DEFAULT)
    expect(normalizeAdCreativeGenerationMode('bogus')).toBe('original')
  })

  it('parses aliases from request body', () => {
    expect(getGenerationModeFromRequestBody({ generationMode: '快速' })).toEqual({
      provided: true,
      mode: 'fast',
    })
    expect(getGenerationModeFromRequestBody({ generation_mode: '均衡' })).toEqual({
      provided: true,
      mode: 'balanced',
    })
    expect(getGenerationModeFromRequestBody({ generation_mode: '标准' })).toEqual({
      provided: true,
      mode: 'original',
    })
    expect(getGenerationModeFromRequestBody({ generationMode: '完整' })).toEqual({
      provided: true,
      mode: 'original',
    })
    expect(getGenerationModeFromRequestBody({ generation_mode: 'invalid' })).toEqual({
      provided: true,
      invalid: true,
    })
  })

  it('maps profiles to speed-oriented settings', () => {
    expect(getAdCreativeGenerationModeProfile('fast')).toMatchObject({
      maxRetries: 0,
      delayMs: 0,
      enableSupplementation: false,
      skipCompetitivePositioningAi: true,
    })
    expect(getAdCreativeGenerationModeProfile('balanced')).toMatchObject({
      maxRetries: 1,
      delayMs: 500,
      enableSupplementation: true,
      skipSupplementAiRanking: true,
    })
    expect(getAdCreativeGenerationModeProfile('original').maxRetries).toBe(AD_CREATIVE_MAX_AUTO_RETRIES)
  })

  it('resolveCreativeGenerationRuntime defaults to original when mode omitted', () => {
    const { runtime, invalidMode } = resolveCreativeGenerationRuntime({})
    expect(invalidMode).toBe(false)
    expect(runtime.mode).toBe('original')
    expect(runtime.profile.maxRetries).toBe(AD_CREATIVE_MAX_AUTO_RETRIES)
  })

  it('resolveCreativeGenerationRuntime caps maxRetries by mode profile', () => {
    const fast = resolveCreativeGenerationRuntime({ generationMode: 'fast', maxRetries: 3 })
    expect(fast.invalidMode).toBe(false)
    expect(fast.runtime.maxRetries).toBe(0)

    const balanced = resolveCreativeGenerationRuntime({ generation_mode: 'balanced', maxRetries: 99 })
    expect(balanced.runtime.maxRetries).toBe(1)

    const invalid = resolveCreativeGenerationRuntime({ generationMode: 'nope' })
    expect(invalid.invalidMode).toBe(true)
  })

  it('resolveStoredGenerationMode preserves unknown raw values', () => {
    expect(resolveStoredGenerationMode('fast')).toBe('fast')
    expect(resolveStoredGenerationMode('legacy_unknown_mode')).toBe('legacy_unknown_mode')
    expect(resolveStoredGenerationMode(null)).toBeNull()
  })

  it('getAdCreativeGenerationModeLabel shows raw value for unknown modes', () => {
    expect(getAdCreativeGenerationModeLabel('legacy_unknown_mode')).toBe('legacy_unknown_mode')
  })

  it('select labels are short and do not duplicate description prefix', () => {
    expect(AD_CREATIVE_GENERATION_MODE_SELECT_LABELS.original).toBe('标准（默认）')
    expect(AD_CREATIVE_GENERATION_MODE_SELECT_LABELS.fast).toBe('快速')
  })

  it('resolveCreativeGenerationRuntime applies balanced profile caps', () => {
    const balanced = resolveCreativeGenerationRuntime({ generationMode: 'balanced', maxRetries: 99 })
    expect(balanced.invalidMode).toBe(false)
    expect(balanced.runtime.mode).toBe('balanced')
    expect(balanced.runtime.maxRetries).toBe(1)
    expect(balanced.runtime.profile.enableSupplementation).toBe(true)
    expect(balanced.runtime.profile.skipCompetitivePositioningAi).toBe(true)
  })
})
