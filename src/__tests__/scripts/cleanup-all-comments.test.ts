import { describe, expect, it } from 'vitest'
import {
  countBrokenRegexQuantifiers,
  findBrokenRegexQuantifiers,
  maskRegexQuantifiers,
  unmaskRegexQuantifiers,
} from '../../../scripts/lib/regex-quantifier-guard.mjs'
import { processLine, splitTrailingComment } from '../../../scripts/cleanup-all-comments.mjs'

describe('regex-quantifier-guard', () => {
  it('detects corrupted quantifiers with a space before closing brace', () => {
    expect(findBrokenRegexQuantifiers('/\\b[A-Z]{2 }\\b/g')).toEqual(['{2 }'])
    expect(countBrokenRegexQuantifiers('/\\d{2,}/g')).toBe(0)
  })

  it('masks and restores valid quantifiers in comment text', () => {
    const input = 'pattern uses {2,} and {20,} tokens'
    const { masked, tokens } = maskRegexQuantifiers(input)
    expect(masked).not.toContain('{2,}')
    const restored = unmaskRegexQuantifiers(masked, tokens)
    expect(restored).toBe(input)
  })
})

describe('cleanup-all-comments', () => {
  it('does not treat // inside double-quoted strings as trailing comments', () => {
    const line = `const url = "https://example.com" // real comment`
    const split = splitTrailingComment(line)
    expect(split?.code).toBe(`const url = "https://example.com"`)
    expect(split?.comment).toBe(' real comment')
  })

  it('preserves regex quantifiers on code lines with trailing comments', () => {
    const line = 'const re = /\\b\\w{4,}\\b/g // four or more letters'
    expect(processLine(line)).toBe(line)
    expect(countBrokenRegexQuantifiers(processLine(line))).toBe(0)
  })

  it('keeps regex quantifier examples inside cleaned comments', () => {
    const line = '// uses quantifier {2,} in docs'
    const processed = processLine(line)
    expect(processed).toContain('{2,}')
    expect(processed).not.toContain('{2 }')
  })

  it('still cleans emoji markers from full-line comments', () => {
    const line = '// 🔥 P0优化（2025-12-11）：修复聚合数据'
    const processed = processLine(line)
    expect(processed).not.toContain('🔥')
    expect(processed).not.toContain('2025-12-11')
    expect(processed).not.toContain('P0')
  })
})
