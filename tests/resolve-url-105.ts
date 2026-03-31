#!/usr/bin/env tsx
/**
 * 使用Playwright解析短链接，查看实际目标URL
 */

import { chromium } from 'playwright'

async function resolveUrl() {
  console.log('🔗 使用浏览器解析URL: https://pboost.me/UKTs4I6\n')

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  })
  const page = await context.newPage()

  try {
    // 访问短链接
    console.log('📍 正在访问短链接...')
    await page.goto('https://pboost.me/UKTs4I6', {
      waitUntil: 'networkidle',
      timeout: 30000
    })

    // 等待重定向完成
    await page.waitForTimeout(3000)

    // 获取最终URL
    const finalUrl = page.url()
    console.log(`✅ 解析成功！`)
    console.log(`   原始URL: https://pboost.me/UKTs4I6`)
    console.log(`   目标URL: ${finalUrl}`)

    // 判断URL类型
    const isAmazon = finalUrl.includes('amazon.com') || finalUrl.includes('amazon.')
    const isStorePage = finalUrl.includes('/stores/') || finalUrl.includes('/store/')
    console.log(`\n📊 URL类型分析:`)
    console.log(`   - 是Amazon: ${isAmazon}`)
    console.log(`   - 是Store页面: ${isStorePage}`)
    console.log(`   - 场景类型: ${isAmazon && isStorePage ? '店铺' : isAmazon ? '单品' : '未知'}`)
  } catch (error: any) {
    console.error('❌ 解析失败:', error.message)
  } finally {
    await browser.close()
  }
}

resolveUrl()
