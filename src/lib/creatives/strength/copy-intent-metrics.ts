import type { HeadlineAsset, DescriptionAsset } from '../server'
import type { CanonicalCreativeType } from '../server'
import { normalizeCreativeBucketSlot } from '../server'
import { containsLocalizedPhrase, resolveLanguageKey } from './keyword-matching'
export type CopyIntentTag = 'brand' | 'scenario' | 'solution' | 'transactional' | 'other'

const COPY_INTENT_BRAND_WORDS: Record<string, string[]> = {
  en: [
    'official',
    'authentic',
    'trusted',
    'certified',
    'warranty',
    'support',
    'guarantee',
    'verified',
  ],
  de: [
    'offiziell',
    'original',
    'authentisch',
    'vertrauenswürdig',
    'zertifiziert',
    'garantie',
    'gewährleistung',
    'support',
    'geprüft',
  ],
  it: [
    'ufficiale',
    'originale',
    'autentico',
    'affidabile',
    'certificato',
    'garanzia',
    'assistenza',
    'supporto',
    'verificato',
  ],
}

const COPY_INTENT_TRANSACTIONAL_WORDS: Record<string, string[]> = {
  en: ['buy', 'shop', 'order', 'price', 'deal', 'discount', 'offer', 'save', 'get', 'quote'],
  de: ['jetzt kaufen', 'kaufen', 'bestellen', 'preis', 'angebot', 'rabatt', 'sparen', 'holen'],
  it: [
    'acquista ora',
    'acquista',
    'compra',
    'ordina',
    'prezzo',
    'offerta',
    'sconto',
    'risparmia',
    'ottieni',
  ],
}

const COPY_INTENT_SCENARIO_WORDS: Record<string, string[]> = {
  en: [
    'for',
    'when',
    'during',
    'project',
    'repair',
    'install',
    'build',
    'fix',
    'home',
    'garden',
    'yard',
    'fence',
    'deck',
    'job',
    'bedroom',
    'kitchen',
    'sleep',
    'night',
    'daily',
    'everyday',
    'office',
    'room',
    'heat',
    'summer',
    'strain',
    'migraine',
  ],
  de: [
    'für',
    'wenn',
    'während',
    'projekt',
    'reparatur',
    'install',
    'bauen',
    'zuhause',
    'heim',
    'garten',
    'küche',
    'schlafzimmer',
    'büro',
    'werkstatt',
    'schlaf',
    'nacht',
    'alltag',
    'sommer',
    'hitze',
    'belastung',
  ],
  it: [
    'per',
    'quando',
    'durante',
    'progetto',
    'ripar',
    'install',
    'casa',
    'cucina',
    'camera',
    'ufficio',
    'bagno',
    'appartamento',
    'sonno',
    'notte',
    'quotidiano',
    'estate',
    'caldo',
    'stress',
  ],
}

const COPY_INTENT_SOLUTION_WORDS: Record<string, string[]> = {
  en: [
    'solution',
    'solve',
    'built',
    'designed',
    'helps',
    'easy',
    'durable',
    'reliable',
    'heavy duty',
    'powerful',
    'lightweight',
    'filter',
    'purify',
    'cooling',
    'relief',
    'relieve',
    'relax',
    'quiet',
    'dehumidifier',
    'dehumidify',
    'alkaline',
    'mineral',
    'tankless',
    'osmosis',
    'filtration',
    'memory foam',
    'pressure relief',
    'sleep support',
    'strain relief',
  ],
  de: [
    'lösung',
    'löst',
    'hilft',
    'einfach',
    'langlebig',
    'zuverlässig',
    'robust',
    'leistungsstark',
    'filter',
    'reinigt',
    'kühlt',
    'entfernt',
    'reduziert',
    'entlastung',
    'beruhigt',
    'leise',
    'entfeuchtet',
    'alkalisch',
    'mineral',
    'tanklos',
    'umkehrosmose',
    'filtration',
  ],
  it: [
    'soluzione',
    'risolve',
    'aiuta',
    'facile',
    'duraturo',
    'affidabile',
    'potente',
    'leggero',
    'filtro',
    'purifica',
    'raffredda',
    'rimuove',
    'riduce',
    'sollievo',
    'rilassa',
    'silenzioso',
    'deumidifica',
    'alcalino',
    'minerale',
    'osmosi',
    'filtrazione',
    'senza serbatoio',
  ],
}

const COPY_INTENT_MODEL_SPEC_WORDS: Record<string, string[]> = {
  en: [
    'model',
    'series',
    'version',
    'generation',
    'gen',
    'size',
    'spec',
    'specs',
    'inch',
    'memory foam',
    'king size',
    'queen size',
    'medium firm',
  ],
  de: ['modell', 'serie', 'version', 'generation', 'größe', 'spezifikation', 'zoll'],
  it: ['modello', 'serie', 'versione', 'generazione', 'misura', 'specifiche', 'pollici'],
}

const MODEL_ALNUM_CODE_PATTERN = /\b(?=[a-z0-9-]{3 })(?=.*[a-z])(?=.*\d)[a-z0-9-]+\b/i
const MODEL_NUMERIC_SPEC_PATTERN =
  /\b\d{1,4}\s*(?:inch|in|cm|mm|gpd|btu|mah|wh|w|kw|v|ah|ft|oz|lb|lbs|kg|g|qt|quart|cup|cups|hz)\b/i

export function normalizeBucketTypeForCopyMetrics(
  bucketType?: 'A' | 'B' | 'C' | 'D' | 'S'
): 'A' | 'B' | 'D' | 'UNSPECIFIED' {
  const slot = normalizeCreativeBucketSlot(bucketType ?? null)
  return slot ?? 'UNSPECIFIED'
}

export function normalizeCreativeTypeForCopyMetrics(
  creativeType?: CanonicalCreativeType
): CanonicalCreativeType | null {
  if (
    creativeType === 'brand_intent' ||
    creativeType === 'model_intent' ||
    creativeType === 'product_intent'
  ) {
    return creativeType
  }
  return null
}

export function hasModelSpecAnchorSignal(text: string, languageKey: string): boolean {
  const normalized = String(text || '').toLowerCase()
  if (!normalized) return false
  if (MODEL_ALNUM_CODE_PATTERN.test(normalized)) return true
  if (MODEL_NUMERIC_SPEC_PATTERN.test(normalized)) return true
  return containsLocalizedPhrase(normalized, COPY_INTENT_MODEL_SPEC_WORDS, languageKey)
}

export function classifyCopyIntentTag(text: string, languageKey: string): CopyIntentTag {
  const normalized = String(text || '').toLowerCase()
  if (!normalized) return 'other'
  if (containsLocalizedPhrase(normalized, COPY_INTENT_BRAND_WORDS, languageKey)) return 'brand'
  if (containsLocalizedPhrase(normalized, COPY_INTENT_TRANSACTIONAL_WORDS, languageKey))
    return 'transactional'
  if (containsLocalizedPhrase(normalized, COPY_INTENT_SCENARIO_WORDS, languageKey))
    return 'scenario'
  if (containsLocalizedPhrase(normalized, COPY_INTENT_SOLUTION_WORDS, languageKey))
    return 'solution'
  return 'other'
}

export function buildKeywordIntentSignals(
  keywords: string[],
  languageKey: string,
  isEnglish: boolean
): {
  scenario: number
  solution: number
  transactional: number
} {
  const normalizedKeywords = Array.from(
    new Set(
      (keywords || [])
        .map((keyword) =>
          String(keyword || '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  )
  if (normalizedKeywords.length === 0) {
    return {
      scenario: 0,
      solution: 0,
      transactional: 0,
    }
  }

  const countMatches = (dict: Record<string, string[]>) =>
    normalizedKeywords.reduce(
      (count, keyword) => count + (containsLocalizedPhrase(keyword, dict, languageKey) ? 1 : 0),
      0
    )

  const denominator = isEnglish ? 3 : 2
  return {
    scenario: Math.min(1, countMatches(COPY_INTENT_SCENARIO_WORDS) / denominator),
    solution: Math.min(1, countMatches(COPY_INTENT_SOLUTION_WORDS) / denominator),
    transactional: Math.min(1, countMatches(COPY_INTENT_TRANSACTIONAL_WORDS) / denominator),
  }
}

export function calculateCopyIntentMetrics(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  bucketType?: 'A' | 'B' | 'C' | 'D' | 'S',
  targetLanguage?: string,
  keywords?: string[],
  creativeType?: CanonicalCreativeType
): {
  expectedBucket: 'A' | 'B' | 'D' | 'UNSPECIFIED'
  typeIntentAlignmentScore: number
  copyIntentCoverage: number
} {
  const languageKey = resolveLanguageKey(targetLanguage)
  const isEnglish = languageKey === 'en'
  const expectedBucket = normalizeBucketTypeForCopyMetrics(bucketType)
  const normalizedCreativeType = normalizeCreativeTypeForCopyMetrics(creativeType)
  const texts = [...headlines.map((h) => h.text), ...descriptions.map((d) => d.text)]
  const tags = texts.map((text) => classifyCopyIntentTag(text, languageKey))
  const count = (tag: CopyIntentTag) => tags.filter((t) => t === tag).length

  const brandCount = count('brand')
  const scenarioCount = count('scenario')
  const solutionCount = count('solution')
  const transactionalCount = count('transactional')

  const coverageKinds = [
    brandCount > 0,
    scenarioCount > 0,
    solutionCount > 0,
    transactionalCount > 0,
  ].filter(Boolean).length
  const copyIntentCoverage = Math.round((coverageKinds / 4) * 100)

  const trustSignal = Math.min(1, brandCount / (isEnglish ? 2 : 1))
  const transactionalSignal = Math.min(1, transactionalCount / (isEnglish ? 2 : 1))
  const scenarioSignal = Math.min(1, scenarioCount / (isEnglish ? 2 : 1))
  const solutionSignal = Math.min(1, solutionCount / (isEnglish ? 2 : 1))
  const keywordIntentSignals = buildKeywordIntentSignals(keywords || [], languageKey, isEnglish)
  const combinedScenarioSignal = Math.max(scenarioSignal, keywordIntentSignals.scenario)
  const combinedSolutionSignal = Math.max(solutionSignal, keywordIntentSignals.solution)
  const combinedTransactionalSignal = Math.max(
    transactionalSignal,
    keywordIntentSignals.transactional
  )
  const valueSignal = Math.min(
    1,
    (combinedTransactionalSignal + combinedSolutionSignal) / (isEnglish ? 3 : 2)
  )
  const modelSpecTextCount = texts.filter((text) =>
    hasModelSpecAnchorSignal(text, languageKey)
  ).length
  const modelSpecKeywordCount = (keywords || []).filter((keyword) =>
    hasModelSpecAnchorSignal(keyword, languageKey)
  ).length
  const modelSpecSignal = Math.min(
    1,
    (modelSpecTextCount + modelSpecKeywordCount) / (isEnglish ? 3 : 2)
  )
  const modelCommercialSignal = Math.max(combinedTransactionalSignal, combinedSolutionSignal)
  const scenarioSolutionSignal = Math.min(
    1,
    combinedScenarioSignal * 0.55 + combinedSolutionSignal * 0.45
  )

  let alignmentRaw = 60 // bucket未指定时的基准
  if (expectedBucket === 'A') {
    alignmentRaw = trustSignal * 75 + combinedTransactionalSignal * 25
  } else if (expectedBucket === 'B') {
    if (normalizedCreativeType === 'model_intent') {
      const modelAnchorStrong = modelSpecSignal >= (isEnglish ? 0.34 : 0.3)
      if (modelAnchorStrong) {
        alignmentRaw =
          modelSpecSignal * 55 +
          modelCommercialSignal * 25 +
          combinedScenarioSignal * 10 +
          combinedSolutionSignal * 10
      } else {
        alignmentRaw = scenarioSolutionSignal * 72 + modelCommercialSignal * 28
        if (
          Math.max(keywordIntentSignals.scenario, keywordIntentSignals.solution) >= 0.34 &&
          modelCommercialSignal >= 0.34
        ) {
          alignmentRaw = Math.max(alignmentRaw, 72)
        }
      }
    } else {
      alignmentRaw = combinedScenarioSignal * 55 + combinedSolutionSignal * 45
    }
  } else if (expectedBucket === 'D') {
    alignmentRaw = combinedTransactionalSignal * 70 + valueSignal * 30
  } else {
    alignmentRaw = Math.min(100, 40 + copyIntentCoverage * 0.6)
  }

  const typeIntentAlignmentScore = Math.round(Math.max(0, Math.min(100, alignmentRaw)))

  return {
    expectedBucket,
    typeIntentAlignmentScore,
    copyIntentCoverage,
  }
}
