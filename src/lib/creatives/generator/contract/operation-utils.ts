import { generateContent } from '../../../ai/server'
import { recordTokenUsage, estimateTokenCost } from '../../../ai/server'
import { headlineContainsKeyword } from './keyword-usage'

export async function recordAdCreativeOperationTokenUsage(input: {
  userId: number
  operationType: string
  aiResponse: Awaited<ReturnType<typeof generateContent>>
}): Promise<void> {
  if (!input.aiResponse.usage) return

  const cost = estimateTokenCost(
    input.aiResponse.model,
    input.aiResponse.usage.inputTokens,
    input.aiResponse.usage.outputTokens
  )
  await recordTokenUsage({
    userId: input.userId,
    model: input.aiResponse.model,
    operationType: input.operationType,
    inputTokens: input.aiResponse.usage.inputTokens,
    outputTokens: input.aiResponse.usage.outputTokens,
    totalTokens: input.aiResponse.usage.totalTokens,
    cost,
    apiType: input.aiResponse.apiType,
  })
}

export function enforceKeywordEmbedding(
  headlines: string[],
  keywords: string[],
  minCount: number,
  maxLength: number,
  protectedIndexes: number[] = [0]
): { updated: string[]; fixed: number } {
  const updated = [...headlines]
  let embeddedCount = updated.filter((h) => headlineContainsKeyword(h, keywords)).length
  let fixed = 0

  if (embeddedCount >= minCount) {
    return { updated, fixed }
  }

  const candidateKeywords = keywords
    .map((k) => k.trim())
    .filter((k) => k.length > 0 && k.length <= 14)
    .sort((a, b) => a.length - b.length)

  if (candidateKeywords.length === 0) {
    return { updated, fixed }
  }

  for (let i = 0; i < updated.length && embeddedCount < minCount; i += 1) {
    if (protectedIndexes.includes(i)) continue
    if (/\?$/g.test(updated[i])) continue
    if (headlineContainsKeyword(updated[i], keywords)) continue

    let replaced = false
    for (const kw of candidateKeywords) {
      const prefix = `${kw} ${updated[i]}`.trim()
      if (prefix.length <= maxLength) {
        updated[i] = prefix
        replaced = true
        break
      }
      const suffix = `${updated[i]} ${kw}`.trim()
      if (suffix.length <= maxLength) {
        updated[i] = suffix
        replaced = true
        break
      }
    }

    if (replaced) {
      embeddedCount += 1
      fixed += 1
    }
  }

  return { updated, fixed }
}
