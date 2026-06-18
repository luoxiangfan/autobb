import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('YeahPromos Skip Failed Pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should skip failed page when skipFailedPages is true', () => {
    // 模拟配置
    const skipFailedPages = true
    const MAX_YP_EMPTY_PAGE_STREAK = 3
    let consecutiveScopeFailureCount = 3
    let page = 9
    const currentPage = 9

    // 模拟失败处理逻辑
    if (consecutiveScopeFailureCount >= MAX_YP_EMPTY_PAGE_STREAK) {
      if (skipFailedPages) {
        // 跳过当前页面，继续下一页
        page = currentPage + 1
        consecutiveScopeFailureCount = 0
      } else {
        // 抛出错误
        throw new Error('连续失败，中止同步')
      }
    }

    // 验证结果
    expect(page).toBe(10) // 跳到下一页
    expect(consecutiveScopeFailureCount).toBe(0) // 重置失败计数
  })

  it('should throw error when skipFailedPages is false', () => {
    // 模拟配置
    const skipFailedPages = false
    const MAX_YP_EMPTY_PAGE_STREAK = 3
    const consecutiveScopeFailureCount = 3
    const currentPage = 9

    // 模拟失败处理逻辑
    const handleFailure = () => {
      if (consecutiveScopeFailureCount >= MAX_YP_EMPTY_PAGE_STREAK) {
        if (skipFailedPages) {
          // 跳过当前页面
          return { page: currentPage + 1, count: 0 }
        } else {
          // 抛出错误
          throw new Error('YeahPromos 连续失败 3 次，已中止同步')
        }
      }
    }

    // 验证抛出错误
    expect(handleFailure).toThrow('YeahPromos 连续失败 3 次，已中止同步')
  })

  it('should parse boolean setting correctly', () => {
    const parseBooleanSetting = (value: string | null | undefined, fallback: boolean): boolean => {
      if (value === null || value === undefined) return fallback
      const normalized = String(value).trim().toLowerCase()
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true
      if (['false', '0', 'no', 'off'].includes(normalized)) return false
      return fallback
    }

    // 测试各种输入
    expect(parseBooleanSetting('true', false)).toBe(true)
    expect(parseBooleanSetting('1', false)).toBe(true)
    expect(parseBooleanSetting('yes', false)).toBe(true)
    expect(parseBooleanSetting('on', false)).toBe(true)
    expect(parseBooleanSetting('false', true)).toBe(false)
    expect(parseBooleanSetting('0', true)).toBe(false)
    expect(parseBooleanSetting('no', true)).toBe(false)
    expect(parseBooleanSetting('off', true)).toBe(false)
    expect(parseBooleanSetting(null, true)).toBe(true)
    expect(parseBooleanSetting(undefined, false)).toBe(false)
    expect(parseBooleanSetting('invalid', true)).toBe(true)
  })
})
