/**
 * 抓取失败检测测试（2026-01-26）
 * 测试HTTP 407代理认证失败和其他抓取错误的检测逻辑
 */
import { describe, it, expect } from 'vitest'

// 模拟 detectScrapingFailure 函数的逻辑（从 offer-extraction.ts 复制）
interface DebugInfo {
  scrapedDataAvailable: boolean
  brandAutoDetected: boolean
  isAmazonStore: boolean
  isAmazonProductPage: boolean
  isIndependentStore: boolean
  productsExtracted: number
  scrapeMethod: string
  scrapingError?: string
  amazonProductDataExtracted?: boolean
  storeDataExtracted?: boolean
  independentStoreDataExtracted?: boolean
}

interface ExtractData {
  debug: DebugInfo
}

function detectScrapingFailure(
  data: ExtractData,
  offerId: number
): { failed: boolean; reason?: string } {
  const debug = data.debug

  // 检测代理认证失败（HTTP 407）
  if (debug.scrapingError) {
    const errorLower = debug.scrapingError.toLowerCase()

    // HTTP 407 代理认证失败
    if (errorLower.includes('407') || errorLower.includes('proxy authentication')) {
      return {
        failed: true,
        reason: `HTTP 407 代理认证失败: ${debug.scrapingError.substring(0, 100)}`
      }
    }

    // 其他代理连接错误
    if (errorLower.includes('proxy connection') ||
        errorLower.includes('err_proxy') ||
        errorLower.includes('err_tunnel')) {
      return {
        failed: true,
        reason: `代理连接错误: ${debug.scrapingError.substring(0, 100)}`
      }
    }

    // ERR_EMPTY_RESPONSE 通常表示服务器拒绝代理
    if (errorLower.includes('err_empty_response')) {
      return {
        failed: true,
        reason: `服务器拒绝连接: ${debug.scrapingError.substring(0, 100)}`
      }
    }
  }

  // 检测Amazon产品页但未能提取产品数据
  if (debug.isAmazonProductPage && debug.amazonProductDataExtracted === false) {
    if (debug.scrapingError) {
      return {
        failed: true,
        reason: `Amazon产品页抓取失败: amazonProductDataExtracted=false, error=${debug.scrapingError.substring(0, 100)}`
      }
    }
  }

  return { failed: false }
}

describe('detectScrapingFailure', () => {
  describe('应该检测HTTP 407代理认证失败', () => {
    it('检测 "HTTP 407 error"', () => {
      const result = detectScrapingFailure({
        debug: {
          scrapedDataAvailable: false,
          brandAutoDetected: false,
          isAmazonStore: false,
          isAmazonProductPage: true,
          isIndependentStore: false,
          productsExtracted: 0,
          scrapeMethod: 'playwright-product',
          scrapingError: 'Error: HTTP 407 error',
          amazonProductDataExtracted: false,
        }
      }, 2327)
      expect(result.failed).toBe(true)
      expect(result.reason).toContain('HTTP 407')
    })

    it('检测 "Proxy Authentication Required"', () => {
      const result = detectScrapingFailure({
        debug: {
          scrapedDataAvailable: false,
          brandAutoDetected: false,
          isAmazonStore: false,
          isAmazonProductPage: true,
          isIndependentStore: false,
          productsExtracted: 0,
          scrapeMethod: 'playwright-product',
          scrapingError: 'Proxy Authentication Required',
          amazonProductDataExtracted: false,
        }
      }, 2327)
      expect(result.failed).toBe(true)
      expect(result.reason).toContain('HTTP 407')
    })
  })

  describe('应该检测其他代理连接错误', () => {
    it('检测 "Proxy connection ended"', () => {
      const result = detectScrapingFailure({
        debug: {
          scrapedDataAvailable: false,
          brandAutoDetected: false,
          isAmazonStore: false,
          isAmazonProductPage: false,
          isIndependentStore: false,
          productsExtracted: 0,
          scrapeMethod: 'playwright-product',
          scrapingError: 'Proxy connection ended unexpectedly',
        }
      }, 1234)
      expect(result.failed).toBe(true)
      expect(result.reason).toContain('代理连接错误')
    })

    it('检测 "ERR_PROXY_CONNECTION_FAILED"', () => {
      const result = detectScrapingFailure({
        debug: {
          scrapedDataAvailable: false,
          brandAutoDetected: false,
          isAmazonStore: false,
          isAmazonProductPage: false,
          isIndependentStore: false,
          productsExtracted: 0,
          scrapeMethod: 'playwright-product',
          scrapingError: 'net::ERR_PROXY_CONNECTION_FAILED',
        }
      }, 1234)
      expect(result.failed).toBe(true)
    })

    it('检测 "ERR_TUNNEL_CONNECTION_FAILED"', () => {
      const result = detectScrapingFailure({
        debug: {
          scrapedDataAvailable: false,
          brandAutoDetected: false,
          isAmazonStore: false,
          isAmazonProductPage: false,
          isIndependentStore: false,
          productsExtracted: 0,
          scrapeMethod: 'playwright-product',
          scrapingError: 'ERR_TUNNEL_CONNECTION_FAILED',
        }
      }, 1234)
      expect(result.failed).toBe(true)
    })

    it('检测 "ERR_EMPTY_RESPONSE"', () => {
      const result = detectScrapingFailure({
        debug: {
          scrapedDataAvailable: false,
          brandAutoDetected: false,
          isAmazonStore: false,
          isAmazonProductPage: false,
          isIndependentStore: false,
          productsExtracted: 0,
          scrapeMethod: 'playwright-product',
          scrapingError: 'page.goto: net::ERR_EMPTY_RESPONSE',
        }
      }, 1234)
      expect(result.failed).toBe(true)
      expect(result.reason).toContain('服务器拒绝')
    })
  })

  describe('应该检测Amazon产品页抓取失败', () => {
    it('检测 Amazon产品页 + amazonProductDataExtracted=false + scrapingError', () => {
      const result = detectScrapingFailure({
        debug: {
          scrapedDataAvailable: false,
          brandAutoDetected: false,
          isAmazonStore: false,
          isAmazonProductPage: true,
          isIndependentStore: false,
          productsExtracted: 0,
          scrapeMethod: 'playwright-product',
          scrapingError: 'Unknown error occurred',
          amazonProductDataExtracted: false,
        }
      }, 2327)
      expect(result.failed).toBe(true)
      expect(result.reason).toContain('Amazon产品页抓取失败')
    })
  })

  describe('应该通过正常情况', () => {
    it('通过：无错误的正常抓取', () => {
      const result = detectScrapingFailure({
        debug: {
          scrapedDataAvailable: true,
          brandAutoDetected: true,
          isAmazonStore: false,
          isAmazonProductPage: true,
          isIndependentStore: false,
          productsExtracted: 0,
          scrapeMethod: 'playwright-product',
          amazonProductDataExtracted: true,
        }
      }, 1234)
      expect(result.failed).toBe(false)
    })

    it('通过：Amazon店铺页（非产品页）', () => {
      const result = detectScrapingFailure({
        debug: {
          scrapedDataAvailable: true,
          brandAutoDetected: true,
          isAmazonStore: true,
          isAmazonProductPage: false,
          isIndependentStore: false,
          productsExtracted: 10,
          scrapeMethod: 'playwright-store',
          storeDataExtracted: true,
        }
      }, 1234)
      expect(result.failed).toBe(false)
    })

    it('通过：独立站页面', () => {
      const result = detectScrapingFailure({
        debug: {
          scrapedDataAvailable: true,
          brandAutoDetected: true,
          isAmazonStore: false,
          isAmazonProductPage: false,
          isIndependentStore: true,
          productsExtracted: 0,
          scrapeMethod: 'playwright-independent',
          independentStoreDataExtracted: true,
        }
      }, 1234)
      expect(result.failed).toBe(false)
    })
  })
})
