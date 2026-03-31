type GoogleAdsFieldPathElement = {
  field_name?: string
  fieldName?: string
  index?: number
}

type GoogleAdsLocation = {
  field_path_elements?: GoogleAdsFieldPathElement[]
  fieldPathElements?: GoogleAdsFieldPathElement[]
}

type GoogleAdsPolicyViolationDetails = {
  external_policy_description?: string
  externalPolicyDescription?: string
  external_policy_name?: string
  externalPolicyName?: string
  is_exemptible?: boolean
  isExemptible?: boolean
  key?: {
    policy_name?: string
    policyName?: string
    violating_text?: string
    violatingText?: string
  }
}

type GoogleAdsPolicyTopicEntry = {
  topic?: string
  type?: string
  evidences?: unknown[]
  constraints?: unknown[]
}

type GoogleAdsPolicyFindingDetails = {
  policy_topic_entries?: GoogleAdsPolicyTopicEntry[]
  policyTopicEntries?: GoogleAdsPolicyTopicEntry[]
}

type GoogleAdsError = {
  message?: string
  error_code?: Record<string, unknown>
  errorCode?: Record<string, unknown>
  trigger?: { string_value?: string; stringValue?: string }
  location?: GoogleAdsLocation
  details?: {
    policy_violation_details?: GoogleAdsPolicyViolationDetails
    policyViolationDetails?: GoogleAdsPolicyViolationDetails
    policy_finding_details?: GoogleAdsPolicyFindingDetails
    policyFindingDetails?: GoogleAdsPolicyFindingDetails
  }
}

type GoogleAdsFailure = {
  errors?: GoogleAdsError[]
  request_id?: string
  requestId?: string
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}

function truncateList(items: string[], maxItems: number): string[] {
  if (items.length <= maxItems) return items
  return [...items.slice(0, maxItems), `+${items.length - maxItems}`]
}

function extractEvidenceTexts(evidences: unknown): string[] {
  const results: string[] = []
  const maxDepth = 6
  const maxItems = 24
  const keyRegex = /(text|url|website|domain|keyword|query|phrase|product|brand)/i

  const visit = (value: unknown, keyHint: string | null, depth: number) => {
    if (results.length >= maxItems || depth > maxDepth) return
    if (typeof value === 'string') {
      if (!keyHint || !keyRegex.test(keyHint)) return
      const cleaned = normalizeWhitespace(value)
      if (!cleaned || cleaned.length > 200) return
      results.push(cleaned)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, keyHint, depth + 1)
        if (results.length >= maxItems) break
      }
      return
    }
    if (value && typeof value === 'object') {
      for (const [key, val] of Object.entries(value)) {
        visit(val, key, depth + 1)
        if (results.length >= maxItems) break
      }
    }
  }

  visit(evidences, null, 0)
  return uniq(results)
}

function getFieldPath(location: GoogleAdsLocation | undefined): string | undefined {
  const elements = location?.field_path_elements ?? location?.fieldPathElements
  if (!elements || !Array.isArray(elements) || elements.length === 0) return undefined

  const parts: string[] = []
  for (const element of elements) {
    const fieldName = element?.field_name ?? element?.fieldName
    if (!fieldName) continue
    if (typeof element?.index === 'number') {
      parts.push(`${fieldName}[${element.index}]`)
    } else {
      parts.push(fieldName)
    }
  }
  return parts.length ? parts.join('.') : undefined
}

function isGoogleAdsFailure(value: unknown): value is GoogleAdsFailure {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as any).errors))
}

function isAccountNotEnabledError(errors: GoogleAdsError[]): boolean {
  return errors.some((error) => {
    const message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
    if (message.includes('not yet enabled') || message.includes('deactivated')) return true

    const errorCode = error.error_code ?? error.errorCode
    if (!errorCode || typeof errorCode !== 'object') return false

    const values = Object.values(errorCode).map((value) => String(value).toUpperCase())
    const keys = Object.keys(errorCode).map((key) => key.toUpperCase())
    return [...values, ...keys].some((value) => value.includes('CUSTOMER_NOT_ENABLED'))
  })
}

export function formatGoogleAdsApiError(
  error: unknown,
  opts?: { maxViolatingTexts?: number }
): string {
  const maxViolatingTexts = typeof opts?.maxViolatingTexts === 'number'
    ? opts.maxViolatingTexts
    : 6

  const fallbackMessage = (() => {
    if (error instanceof Error && error.message) return normalizeWhitespace(error.message)
    if (typeof error === 'string') return normalizeWhitespace(error)
    return 'Google Ads API error'
  })()

  if (!isGoogleAdsFailure(error)) return fallbackMessage

  const requestId = (error.request_id ?? error.requestId)
  const errors = (error.errors || []).filter(Boolean)

  const policyViolations = errors
    .map((e) => {
      const details = e.details?.policy_violation_details ?? e.details?.policyViolationDetails
      if (!details) return null
      const key = details.key || {}
      const violatingText =
        key.violating_text ??
        key.violatingText ??
        e.trigger?.string_value ??
        e.trigger?.stringValue

      return {
        message: typeof e.message === 'string' ? normalizeWhitespace(e.message) : undefined,
        policyName: details.key?.policy_name ?? details.key?.policyName,
        externalPolicyName: details.external_policy_name ?? details.externalPolicyName,
        externalPolicyDescription: details.external_policy_description ?? details.externalPolicyDescription,
        isExemptible: details.is_exemptible ?? details.isExemptible,
        violatingText: typeof violatingText === 'string' ? normalizeWhitespace(violatingText) : undefined,
        fieldPath: getFieldPath(e.location),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  if (policyViolations.length > 0) {
    const grouped = new Map<string, typeof policyViolations>()
    for (const v of policyViolations) {
      const groupKey = [
        v.externalPolicyName || '',
        v.policyName || '',
        v.externalPolicyDescription || '',
        String(Boolean(v.isExemptible)),
      ].join('|')
      const existing = grouped.get(groupKey)
      if (existing) existing.push(v)
      else grouped.set(groupKey, [v])
    }

    const groupSummaries = Array.from(grouped.values()).map((group) => {
      const first = group[0]
      const policyLabel = first.externalPolicyName || first.policyName || 'Policy violation'
      const policyNameSuffix = first.externalPolicyName && first.policyName
        ? ` / ${first.policyName}`
        : (first.policyName ? ` (${first.policyName})` : '')

      const violatingTexts = truncateList(
        uniq(group.map(g => g.violatingText).filter((t): t is string => Boolean(t))),
        maxViolatingTexts
      )

      const fieldPaths = uniq(group.map(g => g.fieldPath).filter((p): p is string => Boolean(p)))
      const noun = fieldPaths.length > 0 && fieldPaths.every(p => p.includes('keyword.text'))
        ? '关键词'
        : '触发文本'

      const parts: string[] = []
      parts.push(`${policyLabel}${policyNameSuffix}`)
      if (violatingTexts.length > 0) parts.push(`${noun}: ${violatingTexts.join(', ')}`)
      const description = first.externalPolicyDescription ? normalizeWhitespace(first.externalPolicyDescription) : ''
      if (description) parts.push(description)
      parts.push(`可申请豁免: ${first.isExemptible ? '是' : '否'}`)
      return parts.join('；')
    })

    const reqPart = requestId ? `；RequestId=${requestId}` : ''
    return `Google Ads 政策违规：${groupSummaries.join('；')}${reqPart}`
  }

  const policyFindings = errors
    .map((e) => {
      const details = e.details?.policy_finding_details ?? e.details?.policyFindingDetails
      const entries = details?.policy_topic_entries ?? details?.policyTopicEntries
      if (!entries || !Array.isArray(entries)) return []
      return entries.map((entry) => ({
        topic: typeof entry?.topic === 'string' ? normalizeWhitespace(entry.topic) : undefined,
        type: typeof entry?.type === 'string' ? normalizeWhitespace(entry.type) : undefined,
        evidences: extractEvidenceTexts(entry?.evidences),
        fieldPath: getFieldPath(e.location),
      }))
    })
    .flat()

  if (policyFindings.length > 0) {
    const grouped = new Map<string, typeof policyFindings>()
    for (const finding of policyFindings) {
      const groupKey = `${finding.topic || ''}|${finding.type || ''}`
      const existing = grouped.get(groupKey)
      if (existing) existing.push(finding)
      else grouped.set(groupKey, [finding])
    }

    const groupSummaries = Array.from(grouped.values()).map((group) => {
      const first = group[0]
      const topicLabel = first.topic || 'Policy topic'
      const typeSuffix = first.type ? ` (类型: ${first.type})` : ''
      const evidenceTexts = truncateList(
        uniq(group.flatMap(item => item.evidences || [])),
        maxViolatingTexts
      )
      const fieldPaths = truncateList(
        uniq(group.map(item => item.fieldPath).filter((p): p is string => Boolean(p))),
        3
      )

      const parts: string[] = []
      parts.push(`${topicLabel}${typeSuffix}`)
      if (evidenceTexts.length > 0) {
        parts.push(`触发文本: ${evidenceTexts.join(', ')}`)
      } else if (fieldPaths.length > 0) {
        parts.push(`触发字段: ${fieldPaths.join(', ')}`)
      }
      return parts.join('；')
    })

    const reqPart = requestId ? `；RequestId=${requestId}` : ''
    return `Google Ads 政策审核未通过：${groupSummaries.join('；')}${reqPart}`
  }

  if (isAccountNotEnabledError(errors)) {
    const reqPart = requestId ? `；RequestId=${requestId}` : ''
    return `账号状态异常（未启用/已停用），请联系管理员或在 Google Ads 中恢复后重试。${reqPart}`
  }

  const messages = uniq(
    errors
      .map(e => (typeof e.message === 'string' ? normalizeWhitespace(e.message) : ''))
      .filter(Boolean)
  )

  if (messages.length > 0) {
    const reqPart = requestId ? `；RequestId=${requestId}` : ''
    return `${truncateList(messages, 3).join('；')}${reqPart}`
  }

  return requestId ? `${fallbackMessage}；RequestId=${requestId}` : fallbackMessage
}
