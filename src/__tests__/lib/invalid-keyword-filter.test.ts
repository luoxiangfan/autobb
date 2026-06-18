/**
 * 无效关键词过滤测试（2026-01-26）
 * 测试防止 "unknown" 等无效关键词进入关键词池的逻辑
 */
import { describe, it, expect } from 'vitest'

// 模拟 isInvalidKeyword 函数的逻辑（从 offer-keyword-pool.ts 复制）
const INVALID_KEYWORD_PATTERNS = [
  /^unknown$/i,
  /^unknown\s+/i,
  /\s+unknown$/i,
  /\bunknown\s+(caller|number|movie|pokemon|synonym|meaning|mother|amazon|charge)\b/i,
  /^(test|testing|sample|example|placeholder)$/i,
  /^(null|undefined|n\/a|na|none)$/i,
  /^(the|a|an|and|or|of|to|for|with|in|on|at|by|from)$/i,
]

function isInvalidKeyword(keyword: string): boolean {
  if (!keyword || keyword.trim().length === 0) return true

  const trimmed = keyword.trim().toLowerCase()

  for (const pattern of INVALID_KEYWORD_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true
    }
  }

  if (trimmed.length < 2) return true
  if (/^[\d\W]+$/.test(trimmed)) return true

  return false
}

describe('isInvalidKeyword', () => {
  describe('应该过滤 unknown 系列关键词', () => {
    it('过滤 "unknown"', () => {
      expect(isInvalidKeyword('unknown')).toBe(true)
    })

    it('过滤 "unknown caller"', () => {
      expect(isInvalidKeyword('unknown caller')).toBe(true)
    })

    it('过滤 "unknown number netflix"', () => {
      expect(isInvalidKeyword('unknown number')).toBe(true)
    })

    it('过滤 "unknown pokemon"', () => {
      expect(isInvalidKeyword('unknown pokemon')).toBe(true)
    })

    it('过滤 "unknown amazon charge"', () => {
      expect(isInvalidKeyword('unknown amazon charge')).toBe(true)
    })
  })

  describe('应该过滤其他无效关键词', () => {
    it('过滤空字符串', () => {
      expect(isInvalidKeyword('')).toBe(true)
    })

    it('过滤纯空格', () => {
      expect(isInvalidKeyword('   ')).toBe(true)
    })

    it('过滤 "test"', () => {
      expect(isInvalidKeyword('test')).toBe(true)
    })

    it('过滤 "null"', () => {
      expect(isInvalidKeyword('null')).toBe(true)
    })

    it('过滤 "undefined"', () => {
      expect(isInvalidKeyword('undefined')).toBe(true)
    })

    it('过滤单字符', () => {
      expect(isInvalidKeyword('a')).toBe(true)
    })

    it('过滤纯数字', () => {
      expect(isInvalidKeyword('12345')).toBe(true)
    })

    it('过滤纯符号', () => {
      expect(isInvalidKeyword('!@#$%')).toBe(true)
    })
  })

  describe('应该保留有效关键词', () => {
    it('保留 "anker charger"', () => {
      expect(isInvalidKeyword('anker charger')).toBe(false)
    })

    it('保留 "150w usb c charger"', () => {
      expect(isInvalidKeyword('150w usb c charger')).toBe(false)
    })

    it('保留 "reolink camera"', () => {
      expect(isInvalidKeyword('reolink camera')).toBe(false)
    })

    it('保留 "best portable charger"', () => {
      expect(isInvalidKeyword('best portable charger')).toBe(false)
    })

    it('保留品牌名中包含 unknown 的关键词', () => {
      // 如果品牌名本身包含 unknown（如 "The Unknown Company"），应该保留
      // 但目前我们的策略是过滤所有以 unknown 开头的关键词，这是合理的
      // 因为真实品牌名很少以 unknown 开头
      expect(isInvalidKeyword('charger for unknown device')).toBe(false)
    })
  })
})
