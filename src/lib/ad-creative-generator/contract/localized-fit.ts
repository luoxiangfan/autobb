import { truncateSnippetByWords } from '../utils'
import { applyDescriptionTextGuardrail } from './text-guardrails'

export function fitLocalizedDescription(base: string, cta: string, maxLength: number): string {
  const cleanBase = String(base || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
  if (!cleanBase) return cta
  let candidate = `${cleanBase}. ${cta}`.trim()
  if (candidate.length <= maxLength) return candidate

  const budget = Math.max(8, maxLength - cta.length - 2)
  const trimmedBase = truncateSnippetByWords(cleanBase, budget).replace(/[.!?]+$/, '')
  candidate = `${trimmedBase}. ${cta}`.trim()
  if (candidate.length <= maxLength) return candidate
  return applyDescriptionTextGuardrail(candidate, maxLength)
}

export function fitLocalizedHeadline(base: string, maxLength: number): string {
  const cleaned = String(base || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= maxLength) return cleaned
  return truncateSnippetByWords(cleaned, maxLength)
}
