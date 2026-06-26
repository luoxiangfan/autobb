import { describe, expect, it } from 'vitest'
import { patchExpandKeywordsSummaryCoverage } from '@/lib/openclaw/strategy/expand-keyword-coverage'

describe('expand-keyword-coverage', () => {
  it('patches legacy expand summary keyword coverage in text', () => {
    const patched = patchExpandKeywordsSummaryCoverage(
      '当前关键词 0 个，建议新增 28 个关键词提升覆盖（目标 20-30 个）。',
      12
    )
    expect(patched).toBe('当前关键词 12 个，建议新增 28 个关键词提升覆盖（目标 20-30 个）。')
  })

  it('keeps summary unchanged when pattern does not match', () => {
    const summary = '建议新增 28 个关键词提升覆盖（目标 20-30 个）。'
    expect(patchExpandKeywordsSummaryCoverage(summary, 12)).toBe(summary)
  })
})
