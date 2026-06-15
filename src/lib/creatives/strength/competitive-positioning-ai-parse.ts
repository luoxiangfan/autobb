/**
 * Competitive positioning AI JSON parsing helpers.
 */

export type CompetitivePositioningAIScores = {
  priceAdvantage: number
  uniqueMarketPosition: number
  competitiveComparison: number
  valueEmphasis: number
  confidence: number
}

function stripMarkdownCodeFences(text: string): string {
  return text
    .replace(/```json\s*/gi, '')
    .replace(/```javascript\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()
}

/**
 * 从文本中提取首个完整JSON对象（忽略对象后的解释文本）
 */
function extractFirstJsonObject(text: string): string | null {
  const firstBrace = text.indexOf('{')
  if (firstBrace === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  let objectStart = -1

  for (let i = firstBrace; i < text.length; i++) {
    const char = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      if (depth === 0) {
        objectStart = i
      }
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0 && objectStart >= 0) {
        return text.slice(objectStart, i + 1)
      }
    }
  }

  return null
}

export function parseCompetitivePositioningAiScores(
  responseText: string
): CompetitivePositioningAIScores {
  const cleanedText = stripMarkdownCodeFences(responseText)

  try {
    const parsed = JSON.parse(cleanedText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('AI响应不是JSON对象')
    }
    return parsed as CompetitivePositioningAIScores
  } catch {
    const jsonObject = extractFirstJsonObject(cleanedText)
    if (!jsonObject) {
      throw new Error('AI响应未包含可解析的JSON对象')
    }

    const parsed = JSON.parse(jsonObject)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('AI响应不是JSON对象')
    }
    return parsed as CompetitivePositioningAIScores
  }
}
