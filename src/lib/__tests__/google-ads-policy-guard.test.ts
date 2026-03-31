import { describe, expect, it } from 'vitest'
import {
  buildGoogleAdsPolicyPromptGuardrails,
  extractGoogleAdsPolicySensitiveTerms,
  resolveGoogleAdsPolicyGuardMode,
  sanitizeGoogleAdsPolicyText,
  sanitizeKeywordListForGoogleAdsPolicy,
  sanitizeKeywordObjectsForGoogleAdsPolicy
} from '../google-ads-policy-guard'

describe('google-ads-policy-guard', () => {
  it('extracts sensitive health terms from mixed content', () => {
    const terms = extractGoogleAdsPolicySensitiveTerms([
      'RingConn sleep apnea monitoring',
      'Clinical diagnosis and treatment assistant',
      'Political affiliation insights for christian users'
    ])

    expect(terms).toContain('sleep apnea')
    expect(terms).toContain('clinical')
    expect(terms).toContain('diagnosis')
    expect(terms).toContain('treatment')
    expect(terms).toContain('political affiliation')
    expect(terms).toContain('religion')
  })

  it('sanitizes policy-sensitive text with replacements', () => {
    const result = sanitizeGoogleAdsPolicyText('Clinical sleep apnea diagnosis for patients', { maxLength: 200 })

    expect(result.changed).toBe(true)
    expect(result.text.toLowerCase()).toContain('consumer')
    expect(result.text.toLowerCase()).toContain('sleep quality')
    expect(result.text.toLowerCase()).toContain('insights')
    expect(result.text.toLowerCase()).toContain('user')
    expect(result.matchedTerms).toContain('sleep apnea')
  })

  it('sanitizes sensitive inference sentence patterns', () => {
    const result = sanitizeGoogleAdsPolicyText('Do you suffer from sleep apnea? This plan is for patients like you.')

    expect(result.text.toLowerCase()).not.toContain('do you suffer')
    expect(result.text.toLowerCase()).not.toContain('patients like you')
    expect(result.text.toLowerCase()).toContain('sleep quality')
    expect(result.matchedTerms).toContain('sensitive inference')
  })

  it('sanitizes keyword string lists', () => {
    const result = sanitizeKeywordListForGoogleAdsPolicy([
      'ringconn sleep apnea monitoring',
      'clinical sleep diagnosis ring',
      'novilla pain relief spinal support'
    ])

    expect(result.changedCount).toBeGreaterThan(0)
    expect(result.items[0].toLowerCase()).toContain('sleep quality')
    expect(result.items[1].toLowerCase()).not.toContain('diagnos')
    expect(result.items[2].toLowerCase()).not.toContain('pain relief')
    expect(result.items[2].toLowerCase()).not.toContain('spinal support')
  })

  it('drops hard-block keyword categories', () => {
    const result = sanitizeKeywordListForGoogleAdsPolicy([
      'ringconn sleep apnea monitoring',
      'christian sleep tracker',
      'teen sleep tracker'
    ])

    expect(result.items).toHaveLength(1)
    expect(result.droppedCount).toBe(2)
    expect(result.matchedTerms).toContain('religion')
    expect(result.matchedTerms).toContain('minors')
  })

  it('uses mode-specific hard block strategy', () => {
    const balanced = sanitizeKeywordListForGoogleAdsPolicy(
      ['sleep tracker for divorce recovery'],
      { mode: 'balanced' }
    )
    const strict = sanitizeKeywordListForGoogleAdsPolicy(
      ['sleep tracker for divorce recovery'],
      { mode: 'strict' }
    )

    expect(balanced.items).toHaveLength(1)
    expect(strict.items).toHaveLength(0)
    expect(strict.matchedTerms).toContain('personal hardship')
  })

  it('resolves policy guard mode with safe default', () => {
    expect(resolveGoogleAdsPolicyGuardMode('strict')).toBe('strict')
    expect(resolveGoogleAdsPolicyGuardMode('preserve_volume')).toBe('preserve-volume')
    expect(resolveGoogleAdsPolicyGuardMode('unknown')).toBe('balanced')
  })

  it('sanitizes keyword object lists while preserving metadata', () => {
    const result = sanitizeKeywordObjectsForGoogleAdsPolicy([
      { keyword: 'sleep apnea ring', searchVolume: 1200, source: 'TEST' },
      { keyword: 'clinical diagnosis ring', searchVolume: 800, source: 'TEST' }
    ])

    expect(result.changedCount).toBe(2)
    expect(result.items).toHaveLength(2)
    expect(result.items[0].searchVolume).toBe(1200)
    expect(result.items[0].keyword.toLowerCase()).toContain('sleep quality')
  })

  it('builds prompt guardrail section with hard excludes', () => {
    const section = buildGoogleAdsPolicyPromptGuardrails('English', ['sleep apnea', 'diagnosis'])

    expect(section).toContain('GOOGLE ADS POLICY GUARDRAIL')
    expect(section).toContain('HARD EXCLUDE TERMS')
    expect(section).toContain('sleep apnea')
  })
})
