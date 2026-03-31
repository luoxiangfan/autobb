export type PlannerNonBrandUseCase = 'pool' | 'demand' | 'model_family'

export interface PlannerNonBrandPolicy {
  pageType?: 'product' | 'store'
  allowNonBrandForPool?: boolean
  allowNonBrandForDemand?: boolean
  allowNonBrandForModelFamily?: boolean
  reason?: string
}

export interface PlannerDecision {
  allowNonBrandFromPlanner?: boolean
  volumeUnavailableFromPlanner?: boolean
  nonBrandPolicy?: PlannerNonBrandPolicy
}

function normalizeUseCaseTag(value: unknown): PlannerNonBrandUseCase | undefined {
  const normalized = String(value || '').trim().toUpperCase()
  if (!normalized) return undefined
  if (normalized.includes('MODEL_FAMILY')) return 'model_family'
  if (normalized.includes('DEMAND')) return 'demand'
  if (normalized.includes('POOL')) return 'pool'
  return undefined
}

export function createPlannerNonBrandPolicy(params?: {
  pageType?: 'product' | 'store'
  enabled?: boolean
}): PlannerNonBrandPolicy {
  const pageType = params?.pageType || 'product'
  const enabled = params?.enabled ?? false

  if (!enabled) {
    return {
      pageType,
      allowNonBrandForPool: false,
      allowNonBrandForDemand: false,
      allowNonBrandForModelFamily: false,
    }
  }

  if (pageType === 'store') {
    return {
      pageType,
      allowNonBrandForPool: true,
      allowNonBrandForDemand: true,
      allowNonBrandForModelFamily: false,
    }
  }

  return {
    pageType,
    allowNonBrandForPool: false,
    allowNonBrandForDemand: true,
    allowNonBrandForModelFamily: true,
  }
}

export function normalizePlannerNonBrandPolicy(
  input?: boolean | PlannerNonBrandPolicy,
  defaultPageType: 'product' | 'store' = 'product'
): PlannerNonBrandPolicy {
  if (typeof input === 'boolean') {
    return {
      pageType: defaultPageType,
      allowNonBrandForPool: input,
      allowNonBrandForDemand: input,
      allowNonBrandForModelFamily: input,
    }
  }

  if (!input) {
    return createPlannerNonBrandPolicy({ pageType: defaultPageType, enabled: false })
  }

  return {
    pageType: input.pageType || defaultPageType,
    allowNonBrandForPool: Boolean(input.allowNonBrandForPool),
    allowNonBrandForDemand: Boolean(input.allowNonBrandForDemand),
    allowNonBrandForModelFamily: Boolean(input.allowNonBrandForModelFamily),
    reason: input.reason,
  }
}

export function plannerNonBrandPolicyEnabled(policy?: PlannerNonBrandPolicy): boolean {
  return Boolean(
    policy?.allowNonBrandForPool
    || policy?.allowNonBrandForDemand
    || policy?.allowNonBrandForModelFamily
  )
}

export function plannerNonBrandPolicyAllows(
  policy: PlannerNonBrandPolicy | undefined,
  useCase: PlannerNonBrandUseCase | undefined
): boolean {
  if (!policy) return false
  if (!useCase) return plannerNonBrandPolicyEnabled(policy)
  if (useCase === 'pool') return Boolean(policy.allowNonBrandForPool)
  if (useCase === 'demand') return Boolean(policy.allowNonBrandForDemand)
  return Boolean(policy.allowNonBrandForModelFamily)
}

export function resolvePlannerNonBrandUseCaseFromMetadata(input: {
  source?: string
  sourceType?: string
  sourceSubtype?: string
  rawSource?: string
  derivedTags?: unknown
}): PlannerNonBrandUseCase | undefined {
  const tags = Array.isArray(input.derivedTags) ? input.derivedTags : []
  for (const tag of tags) {
    const useCase = normalizeUseCaseTag(tag)
    if (useCase) return useCase
  }

  const fields = [
    input.sourceSubtype,
    input.sourceType,
    input.rawSource,
    input.source,
  ]
  for (const field of fields) {
    const useCase = normalizeUseCaseTag(field)
    if (useCase) return useCase
  }

  return undefined
}

export function isKeywordPlannerSource(input: {
  source?: string
  sourceType?: string
  sourceSubtype?: string
  rawSource?: string
}): boolean {
  const fields = [
    input.rawSource,
    input.sourceSubtype,
    input.sourceType,
    input.source,
  ]

  return fields.some((field) => String(field || '').trim().toUpperCase().startsWith('KEYWORD_PLANNER'))
}

export function shouldAllowPlannerNonBrandKeyword(input: {
  source?: string
  sourceType?: string
  sourceSubtype?: string
  rawSource?: string
  derivedTags?: unknown
}, policy?: PlannerNonBrandPolicy): boolean {
  if (!isKeywordPlannerSource(input)) return false
  const normalizedPolicy = normalizePlannerNonBrandPolicy(policy)
  return plannerNonBrandPolicyAllows(
    normalizedPolicy,
    resolvePlannerNonBrandUseCaseFromMetadata(input)
  )
}

export function syncPlannerDecisionPolicy(
  decision: PlannerDecision | undefined,
  policy: PlannerNonBrandPolicy
): void {
  if (!decision) return
  decision.nonBrandPolicy = policy
  decision.allowNonBrandFromPlanner = plannerNonBrandPolicyEnabled(policy)
}
