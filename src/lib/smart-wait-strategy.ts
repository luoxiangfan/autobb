/**
 * 智能等待策略
 *
 * 目标: 减少30%等待时间
 * 原理: 根据页面复杂度动态调整等待策略
 * KISS: 简单的启发式规则，无机器学习
 */

import { Page } from 'playwright'

/**
 * 页面复杂度评估
 */
interface PageComplexity {
  complexity: 'simple' | 'medium' | 'complex'
  estimatedLoadTime: number      // 预估加载时间（毫秒）
  recommendedWaitTime: number    // 推荐额外等待时间（毫秒）
  recommendedTimeout: number     // 推荐总超时时间（毫秒）
}

/**
 * 根据URL评估页面复杂度
 */
export function assessPageComplexity(url: string): PageComplexity {
  const urlLower = url.toLowerCase()

  // 简单页面：静态内容、搜索引擎
  if (
    urlLower.includes('google.com') ||
    urlLower.includes('bing.com') ||
    urlLower.includes('wikipedia.org') ||
    urlLower.endsWith('.html') ||
    urlLower.endsWith('.txt')
  ) {
    return {
      complexity: 'simple',
      estimatedLoadTime: 2000,
      recommendedWaitTime: 1000,
      recommendedTimeout: 30000,
    }
  }

  // 🔥 P0修复：短链接服务需要更长超时（反爬虫验证 + 多次重定向）
  // 常见短链接服务：bit.ly, tinyurl, ow.ly, rebrand.ly, pboost.me, etc.
  const shortLinkDomains = [
    'bit.ly', 'tinyurl.com', 'ow.ly', 'rebrand.ly', 'pboost.me',
    'short.link', 'is.gd', 'buff.ly', 't.co', 'goo.gl', 'clk.',
    'fbuy.me', 'amzn.to', 'flip.it', 'linktr.ee', 'soo.gd'
  ]
  if (shortLinkDomains.some(domain => urlLower.includes(domain))) {
    return {
      complexity: 'complex',
      estimatedLoadTime: 15000,
      recommendedWaitTime: 10000,
      recommendedTimeout: 180000,  // 🔥 3分钟超时，应对短链接服务的反爬虫验证
    }
  }

  // 复杂页面：电商、社交媒体、SPA应用
  if (
    urlLower.includes('amazon.') ||  // 🔥 修复：支持所有Amazon域名（.com/.it/.de/.fr等）
    urlLower.includes('ebay.com') ||
    urlLower.includes('facebook.com') ||
    urlLower.includes('twitter.com') ||
    urlLower.includes('instagram.com') ||
    urlLower.includes('app.') ||
    urlLower.includes('/app/')
  ) {
    return {
      complexity: 'complex',
      estimatedLoadTime: 8000,
      recommendedWaitTime: 5000,
      recommendedTimeout: 120000,  // 🔥 增加到120秒，应对慢速代理和多次重定向
    }
  }

  // 中等复杂度：默认情况
  return {
    complexity: 'medium',
    estimatedLoadTime: 4000,
    recommendedWaitTime: 2000,
    recommendedTimeout: 90000,  // 🔥 增加到90秒，应对代理延迟和页面加载慢
  }
}

/**
 * 智能等待页面加载完成
 *
 * 相比固定的waitUntil: 'networkidle'，这个策略更灵活：
 * 1. 根据页面复杂度动态调整
 * 2. 使用多个信号判断加载完成
 * 3. 提前检测完成，避免不必要的等待
 */
export async function smartWaitForLoad(
  page: Page,
  url: string,
  options?: {
    maxWaitTime?: number        // 最大等待时间
    checkInterval?: number      // 检查间隔
  }
): Promise<{
  waited: number                // 实际等待时间
  loadComplete: boolean         // 是否加载完成
  signals: string[]             // 检测到的完成信号
}> {
  const complexity = assessPageComplexity(url)
  const maxWaitTime = options?.maxWaitTime || complexity.recommendedWaitTime
  const checkInterval = options?.checkInterval || 500

  const startTime = Date.now()
  const signals: string[] = []

  // 等待基础DOM加载
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 })
    signals.push('dom-loaded')
  } catch (error) {
    console.warn('DOM加载超时')
  }

  // 🔥 优化：并行检测多个完成信号，而不是串行等待
  const checkPromises: Promise<string | null>[] = []

  // 信号1: 网络空闲检测（短超时，不阻塞）
  checkPromises.push(
    page.waitForLoadState('networkidle', { timeout: Math.min(complexity.estimatedLoadTime, 3000) })
      .then(() => 'network-idle' as string)
      .catch(() => null)
  )

  // 信号2: 文档就绪状态 (快速检测)
  checkPromises.push(
    page.evaluate(() => {
      return new Promise<string>((resolve) => {
        if (document.readyState === 'complete') {
          resolve('document-ready')
        } else {
          document.addEventListener('readystatechange', () => {
            if (document.readyState === 'complete') resolve('document-ready')
          })
          // 超时保护
          setTimeout(() => resolve('document-ready'), 2000)
        }
      })
    }).catch(() => null)
  )

  // 信号3: 主要内容已渲染（轮询检测，但更积极）
  checkPromises.push(
    (async () => {
      const endTime = startTime + Math.min(maxWaitTime, 3000)  // 🔥 最多轮询3秒
      const shortInterval = 200  // 🔥 缩短检查间隔到200ms

      while (Date.now() < endTime) {
        try {
          const hasContent = await page.evaluate(() => {
            const body = document.body
            // 🔥 降低内容长度要求，Amazon页面DOM加载后即可
            return body && body.textContent && body.textContent.trim().length > 50
          })

          if (hasContent) {
            return 'content-rendered' as string
          }

          await page.waitForTimeout(shortInterval)
        } catch (error) {
          return null
        }
      }
      return null
    })()
  )

  // 🔥 优化：等待任意一个信号完成即可，不需要全部完成
  const firstSignal = await Promise.race(checkPromises).catch(() => null)
  if (firstSignal) {
    signals.push(firstSignal)
  }

  // 给额外的500ms让其他资源加载（图片、CSS等）
  await page.waitForTimeout(500)

  // 收集所有已完成的信号（非阻塞）
  const allSignals = await Promise.allSettled(checkPromises)
  allSignals.forEach((result) => {
    if (result.status === 'fulfilled' && result.value && !signals.includes(result.value)) {
      signals.push(result.value)
    }
  })

  const loadComplete = signals.length > 0

  const waited = Date.now() - startTime

  return {
    waited,
    loadComplete,
    signals,
  }
}

/**
 * 智能等待特定元素出现
 *
 * 使用自适应超时，避免过长等待
 */
export async function smartWaitForSelector(
  page: Page,
  selector: string,
  url: string
): Promise<{
  found: boolean
  waited: number
}> {
  const complexity = assessPageComplexity(url)
  const timeout = Math.min(complexity.recommendedTimeout / 2, 15000) // 最多15秒

  const startTime = Date.now()

  try {
    await page.waitForSelector(selector, { timeout })
    return {
      found: true,
      waited: Date.now() - startTime,
    }
  } catch (error) {
    return {
      found: false,
      waited: Date.now() - startTime,
    }
  }
}

/**
 * 批量智能等待（等待任一元素出现）
 */
export async function smartWaitForAnySelector(
  page: Page,
  selectors: string[],
  url: string
): Promise<{
  foundSelector: string | null
  waited: number
}> {
  const complexity = assessPageComplexity(url)
  const timeout = Math.min(complexity.recommendedTimeout / 2, 15000)

  const startTime = Date.now()

  try {
    // 使用Promise.race等待任一选择器
    const results = await Promise.race(
      selectors.map((selector) =>
        page
          .waitForSelector(selector, { timeout })
          .then(() => selector)
          .catch(() => null)
      )
    )

    return {
      foundSelector: results,
      waited: Date.now() - startTime,
    }
  } catch (error) {
    return {
      foundSelector: null,
      waited: Date.now() - startTime,
    }
  }
}

/**
 * 获取优化统计
 */
let totalWaitTime = 0
let totalOptimizedWaitTime = 0
let callCount = 0

export function recordWaitOptimization(
  originalWaitTime: number,
  optimizedWaitTime: number
): void {
  totalWaitTime += originalWaitTime
  totalOptimizedWaitTime += optimizedWaitTime
  callCount++
}

export function getWaitOptimizationStats(): {
  totalCalls: number
  avgOriginalWait: number
  avgOptimizedWait: number
  timeSaved: number
  improvementPercent: number
} {
  if (callCount === 0) {
    return {
      totalCalls: 0,
      avgOriginalWait: 0,
      avgOptimizedWait: 0,
      timeSaved: 0,
      improvementPercent: 0,
    }
  }

  const avgOriginal = totalWaitTime / callCount
  const avgOptimized = totalOptimizedWaitTime / callCount
  const timeSaved = totalWaitTime - totalOptimizedWaitTime
  const improvement = ((timeSaved / totalWaitTime) * 100)

  return {
    totalCalls: callCount,
    avgOriginalWait: Math.round(avgOriginal),
    avgOptimizedWait: Math.round(avgOptimized),
    timeSaved: Math.round(timeSaved),
    improvementPercent: Math.round(improvement),
  }
}
