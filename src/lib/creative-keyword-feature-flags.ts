function envEnabled(name: string, defaultEnabled = true): boolean {
  const value = String(process.env[name] ?? '').trim().toLowerCase()
  if (!value) return defaultEnabled
  if (['0', 'false', 'off', 'no'].includes(value)) return false
  if (['1', 'true', 'on', 'yes'].includes(value)) return true
  return defaultEnabled
}

/**
 * 对应方案文档：keyword.source_priority_unified.enabled
 */
export function isCreativeKeywordSourcePriorityUnifiedEnabled(): boolean {
  return envEnabled('CREATIVE_KEYWORD_SOURCE_PRIORITY_UNIFIED_ENABLED', true)
}

/**
 * 对应方案文档：keyword.supplement.threshold_gate.enabled
 */
export function isCreativeKeywordSupplementThresholdGateEnabled(): boolean {
  return envEnabled('CREATIVE_KEYWORD_SUPPLEMENT_THRESHOLD_GATE_ENABLED', true)
}

/**
 * 对应方案文档：keyword.ai_source_subtype.enabled
 */
export function isCreativeKeywordAiSourceSubtypeEnabled(): boolean {
  return envEnabled('CREATIVE_KEYWORD_AI_SOURCE_SUBTYPE_ENABLED', true)
}
