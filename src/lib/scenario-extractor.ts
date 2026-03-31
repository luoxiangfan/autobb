/**
 * Scenario Extractor: Auto-extract user scenarios from review_analysis
 *
 * Key principle: ONLY use data from review_analysis (collected during offer creation)
 * Graceful degradation: If review_analysis is null/empty, return empty scenarios
 */

export interface ExtractedScenario {
  scenario: string
  frequency: 'high' | 'medium' | 'low'
  keywords: string[]
  source: 'review' | 'ai_generated'
}

export interface ExtractedUserQuestion {
  question: string
  priority: number  // 1-10
  category: 'feature' | 'price' | 'comparison' | 'problem'
}

export interface ExtractedScenarios {
  scenarios: ExtractedScenario[]
  painPoints: string[]
  userQuestions: ExtractedUserQuestion[]
}

interface ReviewAnalysisResult {
  useCases?: Array<{
    scenario: string
    mentions: number
    keywords?: string[]
  }>
  painPoints?: Array<{
    issue: string
    severity?: 'critical' | 'moderate' | 'minor'
  }>
  quantitativeHighlights?: Array<{
    metric: string
    value: string
    adCopy?: string
  }>
  [key: string]: any
}

/**
 * Extract scenarios from review_analysis data
 * Returns empty result if review_analysis is null/invalid
 */
export function extractScenariosFromReviews(
  reviewAnalysisJson: string | null
): ExtractedScenarios {
  // Graceful degradation: no review data → empty scenarios
  if (!reviewAnalysisJson) {
    return {
      scenarios: [],
      painPoints: [],
      userQuestions: []
    }
  }

  try {
    const reviewAnalysis: ReviewAnalysisResult = JSON.parse(reviewAnalysisJson)

    const scenarios: ExtractedScenario[] = []
    const painPoints: string[] = []
    const userQuestions: ExtractedUserQuestion[] = []

    // 1. Extract scenarios from useCases
    if (reviewAnalysis.useCases && Array.isArray(reviewAnalysis.useCases)) {
      for (const useCase of reviewAnalysis.useCases) {
        if (!useCase.scenario) continue

        scenarios.push({
          scenario: useCase.scenario,
          frequency: useCase.mentions > 10 ? 'high' : useCase.mentions > 5 ? 'medium' : 'low',
          keywords: useCase.keywords || extractKeywordsFromScenario(useCase.scenario),
          source: 'review'
        })
      }
    }

    // 2. Extract pain points
    if (reviewAnalysis.painPoints && Array.isArray(reviewAnalysis.painPoints)) {
      for (const painPoint of reviewAnalysis.painPoints) {
        if (painPoint.issue) {
          painPoints.push(painPoint.issue)

          // Generate question from pain point
          // "difficult installation" → "Is this easy to install?"
          const question = convertPainPointToQuestion(painPoint.issue)
          if (question) {
            userQuestions.push({
              question,
              priority: painPoint.severity === 'critical' ? 10 : painPoint.severity === 'moderate' ? 7 : 4,
              category: 'problem'
            })
          }
        }
      }
    }

    // 3. Generate questions from quantitative highlights
    if (reviewAnalysis.quantitativeHighlights && Array.isArray(reviewAnalysis.quantitativeHighlights)) {
      for (const highlight of reviewAnalysis.quantitativeHighlights) {
        if (highlight.metric) {
          userQuestions.push({
            question: `What is the ${highlight.metric.toLowerCase()}?`,
            priority: 8,
            category: 'feature'
          })
        }
      }
    }

    return { scenarios, painPoints, userQuestions }
  } catch (error) {
    console.error('Failed to parse review_analysis:', error)
    // Graceful degradation: parse error → empty scenarios
    return {
      scenarios: [],
      painPoints: [],
      userQuestions: []
    }
  }
}

/**
 * Extract keywords from scenario text
 * Simple implementation: split by spaces and filter common words
 */
function extractKeywordsFromScenario(scenario: string): string[] {
  const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'can'])

  return scenario
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !commonWords.has(word))
    .slice(0, 5)  // Top 5 keywords
}

/**
 * Convert pain point to user question
 * Examples:
 * - "difficult installation" → "Is this easy to install?"
 * - "short battery life" → "How long does the battery last?"
 * - "poor customer service" → "Is customer service reliable?"
 */
function convertPainPointToQuestion(painPoint: string): string | null {
  const lower = painPoint.toLowerCase()

  // Pattern matching for common pain points
  if (lower.includes('install') || lower.includes('setup')) {
    return 'Is this easy to install?'
  }
  if (lower.includes('battery')) {
    return 'How long does the battery last?'
  }
  if (lower.includes('durable') || lower.includes('quality') || lower.includes('break')) {
    return 'Is this durable and long-lasting?'
  }
  if (lower.includes('customer service') || lower.includes('support')) {
    return 'Is customer service reliable?'
  }
  if (lower.includes('shipping') || lower.includes('delivery')) {
    return 'How fast is shipping?'
  }
  if (lower.includes('size') || lower.includes('fit')) {
    return 'Does this fit as expected?'
  }
  if (lower.includes('price') || lower.includes('expensive') || lower.includes('cheap')) {
    return 'Is this good value for money?'
  }

  // Generic fallback
  return `How to avoid: ${painPoint}?`
}
