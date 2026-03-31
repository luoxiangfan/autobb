interface KeywordSourceAuditLike {
  totalKeywords?: unknown
  withSearchVolumeKeywords?: unknown
  zeroVolumeKeywords?: unknown
  volumeUnavailableKeywords?: unknown
  noVolumeMode?: unknown
  fallbackMode?: unknown
  contextFallbackStrategy?: unknown
  contextFilterStats?: unknown
  byRawSource?: unknown
  creativeAffinityByLabel?: unknown
  creativeAffinityByLevel?: unknown
  sourceQuotaAudit?: unknown
  supplementationSources?: unknown
  selectionMetrics?: unknown
  pipeline?: unknown
}

interface KeywordSupplementationLike {
  triggered?: unknown
  beforeCount?: unknown
  afterCount?: unknown
  addedKeywords?: unknown
  supplementCapApplied?: unknown
}

function toCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, number> = {}

  for (const [rawKey, rawValue] of Object.entries(value as Record<string, any>)) {
    const key = String(rawKey || '').trim()
    if (!key) continue
    const count = Number(
      typeof rawValue === 'number'
        ? rawValue
        : (rawValue as any)?.count
    )
    if (!Number.isFinite(count) || count <= 0) continue
    result[key] = Math.floor(count)
  }

  return result
}

function topCountItems(value: unknown, topK = 3): Array<{ key: string; count: number }> {
  return Object.entries(toCountMap(value))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, Math.floor(topK)))
    .map(([key, count]) => ({ key, count }))
}

function toSafeNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toSafeBoolean(value: unknown): boolean {
  return Boolean(value)
}

function toRatioMetric(value: unknown): { count: number; ratio: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { count: 0, ratio: 0 }
  }

  return {
    count: toSafeNumber((value as any).count),
    ratio: toSafeNumber((value as any).ratio),
  }
}

function toTopFilterReasonsFromQuotaAudit(sourceQuotaAudit: Record<string, any>): Array<{ reason: string; count: number }> {
  const lowTrust = toSafeNumber((sourceQuotaAudit.blockedByCap as any)?.lowTrust)
  const ai = toSafeNumber((sourceQuotaAudit.blockedByCap as any)?.ai)
  const aiLlmRaw = toSafeNumber((sourceQuotaAudit.blockedByCap as any)?.aiLlmRaw)

  return [
    { reason: 'blocked_low_trust_cap', count: lowTrust },
    { reason: 'blocked_ai_cap', count: ai },
    { reason: 'blocked_ai_llm_raw_cap', count: aiLlmRaw },
  ]
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
}

export function summarizeKeywordSourceAudit(
  audit: KeywordSourceAuditLike,
  keywordSupplementation?: KeywordSupplementationLike
): Record<string, any> {
  const sourceQuotaAudit = (
    audit?.sourceQuotaAudit && typeof audit.sourceQuotaAudit === 'object' && !Array.isArray(audit.sourceQuotaAudit)
      ? audit.sourceQuotaAudit as Record<string, any>
      : {}
  )
  const contextFilterStats = (
    audit?.contextFilterStats && typeof audit.contextFilterStats === 'object' && !Array.isArray(audit.contextFilterStats)
      ? audit.contextFilterStats as Record<string, any>
      : {}
  )
  const selectionMetrics = (
    audit?.selectionMetrics && typeof audit.selectionMetrics === 'object' && !Array.isArray(audit.selectionMetrics)
      ? audit.selectionMetrics as Record<string, any>
      : {}
  )
  const addedKeywords = Array.isArray(keywordSupplementation?.addedKeywords)
    ? keywordSupplementation?.addedKeywords
    : []
  const removedByContextMismatch = toSafeNumber(contextFilterStats.removedByContextMismatch)
  const removedByIntentTightening = toSafeNumber(contextFilterStats.removedByIntentTightening)
  const initialCandidateCount = toSafeNumber((audit?.pipeline as any)?.initialCandidateCount)
  const postSupplementCandidateCount = toSafeNumber((audit?.pipeline as any)?.postSupplementCandidateCount)
  const contextIntentTighteningDenominator = Math.max(
    1,
    initialCandidateCount,
    postSupplementCandidateCount
  )
  const contextIntentTighteningRemovalCount = removedByContextMismatch + removedByIntentTightening
  const contextIntentTighteningRemovalRatio = Math.min(
    1,
    contextIntentTighteningRemovalCount / contextIntentTighteningDenominator
  )
  const selectionFallbackTriggered = toSafeBoolean((audit?.pipeline as any)?.selectionFallbackTriggered)
  const nonEmptyRescueTriggered = toSafeBoolean((audit?.pipeline as any)?.nonEmptyRescueTriggered)
  const relaxedFilteringTriggered = toSafeBoolean((audit?.pipeline as any)?.relaxedFilteringTriggered)

  return {
    totalKeywords: toSafeNumber(audit?.totalKeywords),
    withSearchVolumeKeywords: toSafeNumber(audit?.withSearchVolumeKeywords),
    zeroVolumeKeywords: toSafeNumber(audit?.zeroVolumeKeywords),
    volumeUnavailableKeywords: toSafeNumber(audit?.volumeUnavailableKeywords),
    noVolumeMode: toSafeBoolean(audit?.noVolumeMode),
    fallbackMode: toSafeBoolean(audit?.fallbackMode),
    contextFallbackStrategy: String(audit?.contextFallbackStrategy || 'unknown'),
    gateStates: {
      supplementTriggered: toSafeBoolean(keywordSupplementation?.triggered),
      supplementBeforeCount: toSafeNumber(keywordSupplementation?.beforeCount),
      supplementAfterCount: toSafeNumber(keywordSupplementation?.afterCount),
      supplementAddedCount: addedKeywords.length,
      supplementCapApplied: toSafeBoolean(keywordSupplementation?.supplementCapApplied),
      sourceQuotaDeferredRefillTriggered: toSafeBoolean(sourceQuotaAudit.deferredRefillTriggered),
    },
    topSupplementationSources: topCountItems(audit?.supplementationSources, 3),
    topRawSources: topCountItems(audit?.byRawSource, 3),
    topCreativeAffinityLabels: topCountItems(audit?.creativeAffinityByLabel, 3),
    topCreativeAffinityLevels: topCountItems(audit?.creativeAffinityByLevel, 3),
    topFilterReasons: toTopFilterReasonsFromQuotaAudit(sourceQuotaAudit),
    contextFilterStats: {
      removedByContextMismatch,
      removedByForbidden: toSafeNumber(contextFilterStats.removedByForbidden),
      removedByQuality: toSafeNumber(contextFilterStats.removedByQuality),
      removedByModelFamily: toSafeNumber(contextFilterStats.removedByModelFamily),
      removedByIntentTightening,
    },
    selectionMetrics: {
      contractSatisfied: toSafeBoolean(selectionMetrics.contractSatisfied),
      requiredKeywords: toRatioMetric(selectionMetrics.requiredKeywords),
      fallbackKeywords: toRatioMetric(selectionMetrics.fallbackKeywords),
      modelFamilyGuardKeywords: toRatioMetric(selectionMetrics.modelFamilyGuardKeywords),
      pureBrandKeywords: toRatioMetric(selectionMetrics.pureBrandKeywords),
      nonPureBrandKeywords: toRatioMetric(selectionMetrics.nonPureBrandKeywords),
      dNonPureBrandKeywords: toRatioMetric(selectionMetrics.dNonPureBrandKeywords),
      hardModelKeywords: toRatioMetric(selectionMetrics.hardModelKeywords),
      softFamilyKeywords: toRatioMetric(selectionMetrics.softFamilyKeywords),
      finalRescueKeywords: toRatioMetric(selectionMetrics.finalRescueKeywords),
    },
    pipeline: {
      initialCandidateCount,
      initialContextFilteredCount: toSafeNumber((audit?.pipeline as any)?.initialContextFilteredCount),
      postSupplementCandidateCount,
      postSupplementContextFilteredCount: toSafeNumber((audit?.pipeline as any)?.postSupplementContextFilteredCount),
      finalCandidatePoolCount: toSafeNumber((audit?.pipeline as any)?.finalCandidatePoolCount),
      selectionFallbackTriggered,
      selectionFallbackSource: String((audit?.pipeline as any)?.selectionFallbackSource || 'unknown'),
      selectionFallbackReason: String((audit?.pipeline as any)?.selectionFallbackReason || 'unknown'),
      contractSatisfiedAfterFallback: toSafeBoolean((audit?.pipeline as any)?.contractSatisfiedAfterFallback),
      finalInvariantTriggered: toSafeBoolean((audit?.pipeline as any)?.finalInvariantTriggered),
      finalInvariantCandidateCount: toSafeNumber((audit?.pipeline as any)?.finalInvariantCandidateCount),
      nonEmptyRescueTriggered,
      nonEmptyRescueCandidateCount: toSafeNumber((audit?.pipeline as any)?.nonEmptyRescueCandidateCount),
      relaxedFilteringTriggered,
      relaxedFilteringAddedCount: toSafeNumber((audit?.pipeline as any)?.relaxedFilteringAddedCount),
      relaxedFilteringTargetCount: toSafeNumber((audit?.pipeline as any)?.relaxedFilteringTargetCount),
      relaxedFilteringPostFilterRatio: toSafeNumber((audit?.pipeline as any)?.relaxedFilteringPostFilterRatio),
      supplementAppliedAfterFilter: toSafeBoolean((audit?.pipeline as any)?.supplementAppliedAfterFilter),
    },
    alertSignals: {
      contextIntentTighteningRemovalCount,
      contextIntentTighteningRemovalRatio,
      highContextIntentTighteningRemoval: contextIntentTighteningRemovalRatio > 0.8,
      fallbackOrRescueTriggered: selectionFallbackTriggered || nonEmptyRescueTriggered,
      relaxedFilteringTriggered,
    },
    sourceQuotaAudit: {
      acceptedCount: toSafeNumber(sourceQuotaAudit.acceptedCount),
      deferredCount: toSafeNumber(sourceQuotaAudit.deferredCount),
      blockedByCap: {
        lowTrust: toSafeNumber((sourceQuotaAudit.blockedByCap as any)?.lowTrust),
        ai: toSafeNumber((sourceQuotaAudit.blockedByCap as any)?.ai),
        aiLlmRaw: toSafeNumber((sourceQuotaAudit.blockedByCap as any)?.aiLlmRaw),
      },
      deferredRefillTriggered: toSafeBoolean(sourceQuotaAudit.deferredRefillTriggered),
      deferredRefillCount: toSafeNumber(sourceQuotaAudit.deferredRefillCount),
      underfillBeforeRefill: toSafeNumber(sourceQuotaAudit.underfillBeforeRefill),
    },
  }
}

export function logKeywordSourceAudit(params: {
  scopeLabel: string
  audit: KeywordSourceAuditLike
  keywordSupplementation?: KeywordSupplementationLike
  creativeType?: string | null
  bucket?: string | null
}): void {
  const enabledFlag = String(process.env.CREATIVE_KEYWORD_AUDIT_LOG_ENABLED || '1').trim().toLowerCase()
  const enabled = !['0', 'false', 'off', 'no'].includes(enabledFlag)
  if (!enabled) return

  const payload = {
    scopeLabel: params.scopeLabel,
    creativeType: params.creativeType || null,
    bucket: params.bucket || null,
    summary: summarizeKeywordSourceAudit(params.audit, params.keywordSupplementation),
  }

  console.log(`[KeywordSourceAudit] ${JSON.stringify(payload)}`)
}
