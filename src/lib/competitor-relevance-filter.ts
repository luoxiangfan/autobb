import type { CompetitorProduct } from './competitor-analyzer'

export type CompetitorRelevanceMode =
  | 'video_conferencing_camera'
  | 'security_camera'
  | 'generic'

export interface CompetitorRelevanceContext {
  mode: CompetitorRelevanceMode
  contextTokenSet: ReadonlySet<string>
  requiredSignals: string[]
  hasContext: boolean
}

const STOP_WORDS = new Set([
  'with', 'from', 'that', 'this', 'your', 'their', 'ours', 'into', 'over', 'under', 'about',
  'the', 'and', 'for', 'are', 'was', 'were', 'you', 'all', 'our', 'its', 'via',
  'inch', 'inches', 'pack', 'piece', 'pieces', 'new', 'model', 'works', 'compatible',
  'smart', 'wireless', 'digital', 'professional', 'ultra', 'high', 'quality',
])

const ACCESSORY_KEYWORDS = [
  'screen protector', 'protector', 'case', 'cover', 'shell', 'sleeve',
  'stylus', 'pencil', 'pen',
  'charger', 'charging cable', 'cable', 'adapter', 'dock',
  'tripod', 'mount', 'stand',
  'bag', 'backpack', 'pouch',
  'replacement part', 'replacement',
]

const VIDEO_CONFERENCING_MODE_TRIGGERS = [
  'video conferencing',
  'conference room',
  'conference camera',
  'webcam',
  'video meeting',
  'zoom',
  'microsoft teams',
  'teams certified',
  'meeting camera',
  'ptz',
]

const VIDEO_CONFERENCING_REQUIRED_SIGNALS = [
  'webcam',
  'conference',
  'conferencing',
  'video meeting',
  'meeting',
  'zoom',
  'teams',
  'ptz',
]

const SECURITY_CAMERA_MODE_TRIGGERS = [
  'security camera',
  'surveillance camera',
  'doorbell camera',
  'cctv',
  'ip camera',
  'outdoor camera',
  'indoor camera',
]

const SECURITY_CAMERA_REQUIRED_SIGNALS = [
  'security',
  'surveillance',
  'doorbell',
  'cctv',
  'ip camera',
  'outdoor',
  'indoor',
]

const PRODUCT_SIGNAL_TOKENS = new Set([
  'camera',
  'webcam',
  'conference',
  'conferencing',
  'vacuum',
  'robot',
  'earbuds',
  'headphones',
  'speaker',
  'soundbar',
  'router',
  'modem',
  'microphone',
  'projector',
  'monitor',
  'doorbell',
  'lock',
  'toothbrush',
  'dryer',
  'trimmer',
  'shaver',
  'blender',
  'microwave',
  'tablet',
  'laptop',
])

function normalizeText(input: string | null | undefined): string {
  return (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(input: string | null | undefined): string[] {
  const normalized = normalizeText(input)
  if (!normalized) return []

  return normalized
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token))
}

function containsAnyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase))
}

function containsSignal(text: string, tokenSet: Set<string>, signal: string): boolean {
  if (signal.includes(' ')) {
    return text.includes(signal)
  }
  return tokenSet.has(signal)
}

export function createCompetitorRelevanceContext(params: {
  productName?: string | null
  category?: string | null
  productCategory?: string | null
  features?: string[]
  aboutThisItem?: string[]
}): CompetitorRelevanceContext {
  const contextParts = [
    params.productName || '',
    params.category || '',
    params.productCategory || '',
    ...(params.features || []).slice(0, 6),
    ...(params.aboutThisItem || []).slice(0, 6),
  ]
  const contextText = normalizeText(contextParts.join(' '))
  const contextTokens = tokenize(contextText)
  const contextTokenSet = new Set(contextTokens)
  const hasContext = contextTokens.length > 0

  let mode: CompetitorRelevanceMode = 'generic'
  if (containsAnyPhrase(contextText, VIDEO_CONFERENCING_MODE_TRIGGERS)) {
    mode = 'video_conferencing_camera'
  } else if (containsAnyPhrase(contextText, SECURITY_CAMERA_MODE_TRIGGERS)) {
    mode = 'security_camera'
  }

  let requiredSignals: string[]
  if (mode === 'video_conferencing_camera') {
    requiredSignals = VIDEO_CONFERENCING_REQUIRED_SIGNALS
  } else if (mode === 'security_camera') {
    requiredSignals = SECURITY_CAMERA_REQUIRED_SIGNALS
  } else {
    const fromContext = contextTokens.filter((token) => PRODUCT_SIGNAL_TOKENS.has(token))
    requiredSignals = Array.from(new Set(fromContext)).slice(0, 8)
    if (requiredSignals.length === 0) {
      requiredSignals = Array.from(new Set(contextTokens)).slice(0, 6)
    }
  }

  return {
    mode,
    contextTokenSet,
    requiredSignals,
    hasContext,
  }
}

export function isCompetitorRelevant(
  competitor: Pick<CompetitorProduct, 'name' | 'brand' | 'features'>,
  context: CompetitorRelevanceContext
): boolean {
  if (!context.hasContext) return true

  const competitorText = normalizeText([
    competitor.name || '',
    competitor.brand || '',
    ...(competitor.features || []),
  ].join(' '))

  if (!competitorText) return false

  const competitorTokenSet = new Set(tokenize(competitorText))
  const signalMatchCount = context.requiredSignals.reduce((count, signal) => {
    return count + (containsSignal(competitorText, competitorTokenSet, signal) ? 1 : 0)
  }, 0)
  const contextOverlapCount = Array.from(context.contextTokenSet).reduce((count, token) => {
    return count + (competitorTokenSet.has(token) ? 1 : 0)
  }, 0)
  const hasAccessoryKeyword = ACCESSORY_KEYWORDS.some((keyword) => competitorText.includes(keyword))

  // Accessory-like items usually overlap on one token (e.g. "camera") but are not true competitors.
  if (hasAccessoryKeyword && contextOverlapCount < 2 && signalMatchCount < 2) {
    return false
  }

  if (context.mode === 'video_conferencing_camera') {
    return signalMatchCount > 0
  }

  if (context.mode === 'security_camera') {
    return signalMatchCount > 0 || contextOverlapCount > 0
  }

  return signalMatchCount > 0 || contextOverlapCount > 0
}

export function filterRelevantCompetitors(
  competitors: CompetitorProduct[],
  context: CompetitorRelevanceContext
): { kept: CompetitorProduct[]; removed: CompetitorProduct[] } {
  const kept: CompetitorProduct[] = []
  const removed: CompetitorProduct[] = []

  for (const competitor of competitors) {
    if (isCompetitorRelevant(competitor, context)) {
      kept.push(competitor)
    } else {
      removed.push(competitor)
    }
  }

  return { kept, removed }
}
