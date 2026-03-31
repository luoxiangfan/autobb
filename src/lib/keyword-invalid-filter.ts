/**
 * 关键词无效过滤规则（共享）
 */

const INVALID_KEYWORD_PATTERNS = [
  // "unknown" 系列 - 来自抓取失败时使用 "unknown" 作为种子词扩展
  /^unknown$/i,
  /^unknown\s+/i,
  /\s+unknown$/i,
  /\bunknown\s+(caller|number|movie|pokemon|synonym|meaning|mother|amazon|charge)\b/i,

  // 其他明显无效的模式
  /^(test|testing|sample|example|placeholder)$/i,
  /^(null|undefined|n\/a|na|none)$/i,

  // 过于通用的单词
  /^(the|a|an|and|or|of|to|for|with|in|on|at|by|from)$/i,
]

/**
 * 检查关键词是否无效（应被过滤）
 * @param keyword - 要检查的关键词
 * @returns true 如果关键词无效，应被过滤
 */
export function isInvalidKeyword(keyword: string): boolean {
  if (!keyword || keyword.trim().length === 0) return true

  const trimmed = keyword.trim().toLowerCase()

  // 检查是否匹配任何无效模式
  for (const pattern of INVALID_KEYWORD_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true
    }
  }

  // 检查关键词是否过短（单字符）
  if (trimmed.length < 2) return true

  // 检查关键词是否全是数字或特殊字符
  if (/^[\d\W]+$/.test(trimmed)) return true

  return false
}

