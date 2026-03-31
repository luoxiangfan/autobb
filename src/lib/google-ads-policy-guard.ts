interface PolicyReplacementRule {
  term: string
  replacement: string
  patterns: RegExp[]
}

interface PolicyHardBlockRule {
  term: string
  patterns: RegExp[]
  modes: GoogleAdsPolicyGuardMode[]
}

export type GoogleAdsPolicyGuardMode = 'strict' | 'balanced' | 'preserve-volume'

const POLICY_GUARD_MODE_ENV_KEY = 'GOOGLE_ADS_POLICY_GUARD_MODE'

export interface PolicyTextSanitizeResult {
  text: string
  changed: boolean
  matchedTerms: string[]
}

export interface PolicyKeywordSanitizeResult<T> {
  items: T[]
  changedCount: number
  droppedCount: number
  matchedTerms: string[]
}

const INFERENCE_REPLACEMENT_RULES: PolicyReplacementRule[] = [
  {
    term: 'sensitive inference',
    replacement: 'looking to improve',
    patterns: [
      /\bdo\s+you\s+(?:suffer\s+from|have|struggle\s+with|live\s+with)\b/giu,
      /\bare\s+you\s+(?:diagnosed\s+with|suffering\s+from)\b/giu
    ]
  },
  {
    term: 'patient status inference',
    replacement: 'for wellness-focused users',
    patterns: [/\bfor\s+patients?\s+like\s+you\b/giu]
  },
  {
    term: 'sensitive personal status',
    replacement: 'your wellness goals',
    patterns: [/\byour\s+(?:condition|diagnosis|disease|medical\s+history|debt)\b/giu]
  }
]

const POLICY_REPLACEMENT_RULES: PolicyReplacementRule[] = [
  // Health / medical
  {
    term: 'sleep apnea',
    replacement: 'sleep quality',
    patterns: [/\bsleep[\s-]*apnea\b/giu, /睡眠呼吸暂停/gu]
  },
  {
    term: 'apnea',
    replacement: 'sleep quality',
    patterns: [/\bapnea\b/giu]
  },
  {
    term: 'hypertension',
    replacement: 'blood pressure trends',
    patterns: [/\bhypertension\b/giu, /高血压/gu]
  },
  {
    term: 'arrhythmia',
    replacement: 'heart rhythm trends',
    patterns: [/\barrhythmia\b/giu, /心律失常/gu]
  },
  {
    term: 'diabetes',
    replacement: 'wellness',
    patterns: [/\bdiabet(?:es|ic)\b/giu, /糖尿病/gu]
  },
  {
    term: 'insomnia',
    replacement: 'sleep quality',
    patterns: [/\binsomnia\b/giu, /失眠/gu]
  },
  {
    term: 'pain relief',
    replacement: 'everyday comfort',
    patterns: [/\bpain[\s-]*relief\b/giu, /止痛|镇痛|缓解疼痛/gu]
  },
  {
    term: 'spinal support',
    replacement: 'targeted support',
    patterns: [/\bspinal[\s-]*support\b/giu, /脊椎支撑|脊柱支撑/gu]
  },
  {
    term: 'disease',
    replacement: 'wellness',
    patterns: [/\bdisease\b/giu, /\bdisorder\b/giu, /\bsyndrome\b/giu, /疾病|病症|综合征/gu]
  },
  {
    term: 'diagnosis',
    replacement: 'insights',
    patterns: [/\bdiagnos(?:e|is|ed|ing)\b/giu, /诊断|确诊/gu]
  },
  {
    term: 'treatment',
    replacement: 'support',
    patterns: [/\btreat(?:ment|ing|ed|s)?\b/giu, /治疗|疗效/gu]
  },
  {
    term: 'cure',
    replacement: 'support',
    patterns: [/\bcure(?:d|s)?\b/giu, /治愈/gu]
  },
  {
    term: 'medication',
    replacement: 'routine',
    patterns: [/\bmedication\b/giu, /\bprescription\b/giu, /\bdrug(?:s)?\b/giu, /用药|处方|药物/gu]
  },
  {
    term: 'patient',
    replacement: 'user',
    patterns: [/\bpatient(?:s)?\b/giu, /病患|患者/gu]
  },
  {
    term: 'clinical',
    replacement: 'consumer',
    patterns: [/\bclinical\b/giu, /临床/gu]
  },

  // Personal hardship / vulnerable status
  {
    term: 'financial hardship',
    replacement: 'financial wellness',
    patterns: [/\bdebt(?:s)?\b/giu, /\bbankrupt(?:cy|cies)\b/giu, /\bunemploy(?:ed|ment)\b/giu, /债务|破产|失业/gu]
  },
  {
    term: 'personal hardship',
    replacement: 'life transitions',
    patterns: [/\bdivorce\b/giu, /\bgrief\b/giu, /\bbereavement\b/giu, /\babuse\b/giu, /\btrauma\b/giu, /离婚|丧亲|受虐|创伤/gu]
  },

  // Sensitive identity
  {
    term: 'political affiliation',
    replacement: 'audience interests',
    patterns: [/\b(?:republican|democrat|liberal|conservative|political\s+affiliation|political\s+views?)\b/giu, /政治立场|党派/gu]
  },
  {
    term: 'religion',
    replacement: 'personal preferences',
    patterns: [/\b(?:christian|muslim|jewish|hindu|buddhist|catholic|religion|faith)\b/giu, /宗教|信仰/gu]
  },
  {
    term: 'ethnicity',
    replacement: 'community preferences',
    patterns: [/\bethnicit(?:y|ies)\b/giu, /\bracial\b/giu, /\bafrican\s+american\b/giu, /\basian\s+american\b/giu, /\bhispanic\b/giu, /\blatino\b/giu, /种族|族裔|民族/gu]
  },
  {
    term: 'sexual orientation',
    replacement: 'personal preferences',
    patterns: [/\b(?:gay|lesbian|bisexual|transgender|non-?binary|queer|sexual\s+orientation|gender\s+identity)\b/giu, /性取向|性少数|跨性别|性别认同/gu]
  },

  // Sexual / minors
  {
    term: 'sexual content',
    replacement: 'wellness',
    patterns: [/\bsexual\b/giu, /\bsex\s+life\b/giu, /性行为|成人内容|色情/gu]
  },
  {
    term: 'minors',
    replacement: 'family wellness',
    patterns: [/\bunder\s*1[38]\b/giu, /\bteen(?:s|ager)?\b/giu, /\bminor(?:s)?\b/giu, /\bchildren?\b/giu, /未成年人|青少年|儿童/gu]
  }
]

const KEYWORD_HARD_BLOCK_RULES: PolicyHardBlockRule[] = [
  {
    term: 'political affiliation',
    patterns: [/\b(?:republican|democrat|liberal|conservative|political\s+affiliation|political\s+views?)\b/giu, /政治立场|党派/gu],
    modes: ['strict', 'balanced', 'preserve-volume']
  },
  {
    term: 'religion',
    patterns: [/\b(?:christian|muslim|jewish|hindu|buddhist|catholic|religion|faith)\b/giu, /宗教|信仰/gu],
    modes: ['strict', 'balanced', 'preserve-volume']
  },
  {
    term: 'ethnicity',
    patterns: [/\bethnicit(?:y|ies)\b/giu, /\bracial\b/giu, /\bafrican\s+american\b/giu, /\basian\s+american\b/giu, /\bhispanic\b/giu, /\blatino\b/giu, /种族|族裔|民族/gu],
    modes: ['strict', 'balanced', 'preserve-volume']
  },
  {
    term: 'sexual orientation',
    patterns: [/\b(?:gay|lesbian|bisexual|transgender|non-?binary|queer|sexual\s+orientation|gender\s+identity)\b/giu, /性取向|性少数|跨性别|性别认同/gu],
    modes: ['strict', 'balanced', 'preserve-volume']
  },
  {
    term: 'sexual content',
    patterns: [/\bsexual\b/giu, /\bsex\s+life\b/giu, /性行为|成人内容|色情/gu],
    modes: ['strict', 'balanced', 'preserve-volume']
  },
  {
    term: 'minors',
    patterns: [/\bunder\s*1[38]\b/giu, /\bteen(?:s|ager)?\b/giu, /\bminor(?:s)?\b/giu, /\bchildren?\b/giu, /未成年人|青少年|儿童/gu],
    modes: ['strict', 'balanced', 'preserve-volume']
  },
  {
    term: 'sensitive inference',
    patterns: [
      /\bdo\s+you\s+(?:suffer\s+from|have|struggle\s+with|live\s+with)\b/giu,
      /\bare\s+you\s+(?:diagnosed\s+with|suffering\s+from)\b/giu,
      /\bfor\s+patients?\s+like\s+you\b/giu,
      /\byour\s+(?:condition|diagnosis|disease|medical\s+history|debt)\b/giu
    ],
    modes: ['strict', 'balanced', 'preserve-volume']
  },
  {
    term: 'personal hardship',
    patterns: [/\bdivorce\b/giu, /\bgrief\b/giu, /\bbereavement\b/giu, /\babuse\b/giu, /\btrauma\b/giu, /\bcriminal\s+record\b/giu, /离婚|丧亲|受虐|创伤|犯罪记录/gu],
    modes: ['strict']
  }
]

function normalizePolicyGuardMode(value: string | undefined | null): GoogleAdsPolicyGuardMode | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'strict') return 'strict'
  if (normalized === 'balanced') return 'balanced'
  if (normalized === 'preserve-volume' || normalized === 'preserve_volume' || normalized === 'preservevolume') {
    return 'preserve-volume'
  }
  return null
}

export function resolveGoogleAdsPolicyGuardMode(input?: GoogleAdsPolicyGuardMode | string | null): GoogleAdsPolicyGuardMode {
  const direct = normalizePolicyGuardMode(input || '')
  if (direct) return direct

  const fromEnv = normalizePolicyGuardMode(process.env[POLICY_GUARD_MODE_ENV_KEY])
  if (fromEnv) return fromEnv

  return 'balanced'
}

function dedupeTerms(terms: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const term of terms) {
    const normalized = term.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(term)
  }
  return out
}

function cleanPolicyText(value: string): string {
  return value
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

function truncateText(text: string, maxLength?: number): string {
  if (!maxLength || maxLength <= 0) return text
  return text.length > maxLength ? text.slice(0, maxLength).trim() : text
}

function ruleMatches(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(text)
  })
}

function collectMatchedTerms(text: string, rules: Array<{ term: string; patterns: RegExp[] }>): string[] {
  return dedupeTerms(
    rules
      .filter((rule) => ruleMatches(text, rule.patterns))
      .map((rule) => rule.term)
  )
}

function applyReplacementRules(
  input: string,
  rules: PolicyReplacementRule[],
  matchedTerms: string[]
): string {
  let out = input

  for (const rule of rules) {
    if (!ruleMatches(out, rule.patterns)) continue
    matchedTerms.push(rule.term)
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0
      out = out.replace(pattern, rule.replacement)
    }
  }

  return out
}

function getHardBlockRulesForMode(mode: GoogleAdsPolicyGuardMode): PolicyHardBlockRule[] {
  return KEYWORD_HARD_BLOCK_RULES.filter((rule) => rule.modes.includes(mode))
}

function matchHardBlockTerms(text: string, mode: GoogleAdsPolicyGuardMode): string[] {
  return collectMatchedTerms(text, getHardBlockRulesForMode(mode))
}

function finalizeSanitizedText(text: string, maxLength?: number): string {
  const cleaned = cleanPolicyText(text)
  const truncated = truncateText(cleaned, maxLength)
  const normalized = cleanPolicyText(truncated)
  return normalized || 'wellness'
}

export function extractGoogleAdsPolicySensitiveTerms(
  texts: string[],
  options?: { mode?: GoogleAdsPolicyGuardMode | string | null }
): string[] {
  const mode = resolveGoogleAdsPolicyGuardMode(options?.mode)
  const joined = texts
    .map((text) => String(text || '').trim())
    .filter((text) => text.length > 0)
    .join('\n')

  if (!joined) return []

  return dedupeTerms([
    ...collectMatchedTerms(joined, INFERENCE_REPLACEMENT_RULES),
    ...collectMatchedTerms(joined, POLICY_REPLACEMENT_RULES),
    ...collectMatchedTerms(joined, getHardBlockRulesForMode(mode))
  ])
}

export function sanitizeGoogleAdsPolicyText(
  input: string,
  options?: { maxLength?: number; mode?: GoogleAdsPolicyGuardMode | string | null }
): PolicyTextSanitizeResult {
  const original = String(input || '')
  if (!original.trim()) {
    return { text: original, changed: false, matchedTerms: [] }
  }

  const matchedTerms: string[] = []
  let sanitized = original

  sanitized = applyReplacementRules(sanitized, INFERENCE_REPLACEMENT_RULES, matchedTerms)
  sanitized = applyReplacementRules(sanitized, POLICY_REPLACEMENT_RULES, matchedTerms)

  sanitized = finalizeSanitizedText(sanitized, options?.maxLength)

  return {
    text: sanitized,
    changed: sanitized !== original,
    matchedTerms: dedupeTerms(matchedTerms)
  }
}

export function sanitizeKeywordListForGoogleAdsPolicy(
  keywords: string[],
  options?: { mode?: GoogleAdsPolicyGuardMode | string | null }
): PolicyKeywordSanitizeResult<string> {
  const mode = resolveGoogleAdsPolicyGuardMode(options?.mode)
  const sanitized: string[] = []
  let changedCount = 0
  let droppedCount = 0
  const matchedTerms: string[] = []

  for (const keyword of keywords || []) {
    const raw = String(keyword || '').trim()
    if (!raw) continue

    const hardBlockMatched = matchHardBlockTerms(raw, mode)
    if (hardBlockMatched.length > 0) {
      droppedCount += 1
      matchedTerms.push(...hardBlockMatched)
      continue
    }

    const result = sanitizeGoogleAdsPolicyText(raw, { mode })
    if (result.changed) {
      changedCount += 1
      matchedTerms.push(...result.matchedTerms)
    }

    const normalized = result.text.trim()
    if (!normalized) {
      droppedCount += 1
      continue
    }

    const hardBlockMatchedAfterSanitize = matchHardBlockTerms(normalized, mode)
    if (hardBlockMatchedAfterSanitize.length > 0) {
      droppedCount += 1
      matchedTerms.push(...hardBlockMatchedAfterSanitize)
      continue
    }

    sanitized.push(normalized)
  }

  return {
    items: sanitized,
    changedCount,
    droppedCount,
    matchedTerms: dedupeTerms(matchedTerms)
  }
}

export function sanitizeKeywordObjectsForGoogleAdsPolicy<T extends { keyword: string }>(
  keywords: T[],
  options?: { mode?: GoogleAdsPolicyGuardMode | string | null }
): PolicyKeywordSanitizeResult<T> {
  const mode = resolveGoogleAdsPolicyGuardMode(options?.mode)
  const sanitized: T[] = []
  let changedCount = 0
  let droppedCount = 0
  const matchedTerms: string[] = []

  for (const item of keywords || []) {
    const rawKeyword = String(item?.keyword || '').trim()
    if (!rawKeyword) continue

    const hardBlockMatched = matchHardBlockTerms(rawKeyword, mode)
    if (hardBlockMatched.length > 0) {
      droppedCount += 1
      matchedTerms.push(...hardBlockMatched)
      continue
    }

    const result = sanitizeGoogleAdsPolicyText(rawKeyword, { mode })
    if (result.changed) {
      changedCount += 1
      matchedTerms.push(...result.matchedTerms)
    }

    const normalizedKeyword = result.text.trim()
    if (!normalizedKeyword) {
      droppedCount += 1
      continue
    }

    const hardBlockMatchedAfterSanitize = matchHardBlockTerms(normalizedKeyword, mode)
    if (hardBlockMatchedAfterSanitize.length > 0) {
      droppedCount += 1
      matchedTerms.push(...hardBlockMatchedAfterSanitize)
      continue
    }

    sanitized.push({
      ...item,
      keyword: normalizedKeyword
    })
  }

  return {
    items: sanitized,
    changedCount,
    droppedCount,
    matchedTerms: dedupeTerms(matchedTerms)
  }
}

export function buildGoogleAdsPolicyPromptGuardrails(
  targetLanguage: string,
  detectedTerms: string[],
  options?: { mode?: GoogleAdsPolicyGuardMode | string | null }
): string {
  const mode = resolveGoogleAdsPolicyGuardMode(options?.mode)
  const language = String(targetLanguage || '').trim() || 'English'
  const terms = dedupeTerms(detectedTerms).slice(0, 20)
  const termLine = terms.length > 0 ? `- HARD EXCLUDE TERMS: ${terms.join(', ')}` : ''
  const modeLine = `- Enforcement mode: ${mode}.`

  return [
    '## GOOGLE ADS POLICY GUARDRAIL (PERSONALIZED ADS)',
    `- Keep all copy in ${language} while staying policy-safe.`,
    modeLine,
    '- Do NOT reference diseases, diagnosis, treatment, cure, medication, or patient status.',
    '- Do NOT reference political affiliation, religion, ethnicity, sexual orientation, or minors.',
    '- Do NOT infer sensitive personal status (for example: "do you suffer from...", "your condition").',
    '- Use neutral wording: wellness, sleep quality, trends, everyday insights.',
    termLine
  ]
    .filter(Boolean)
    .join('\n')
}
