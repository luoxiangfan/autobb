#!/usr/bin/env npx tsx

import { resolveAffiliateLinkWithPlaywright } from '../src/lib/url-resolver-playwright'

async function diagnoseYeahPromosResolution() {
  const url = 'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url='

  console.log('🔍 诊断YeahPromos URL解析')
  console.log('━'.repeat(80))
  console.log(`URL: ${url}`)
  console.log('')

  try {
    console.log('⏳ 调用 resolveAffiliateLinkWithPlaywright...')
    const result = await resolveAffiliateLinkWithPlaywright(url, undefined, 10000, 'US')

    console.log('')
    console.log('✅ 解析成功!')
    console.log('━'.repeat(80))
    console.log(`Final URL: ${result.finalUrl}`)
    console.log(`Final URL Suffix: ${result.finalUrlSuffix}`)
    console.log(`Page Title: ${result.pageTitle}`)
    console.log(`Status Code: ${result.statusCode}`)
    console.log(`Redirect Count: ${result.redirectCount}`)
    console.log('')
    console.log('🔄 Redirect Chain:')
    result.redirectChain.forEach((step, index) => {
      console.log(`  [${index}] ${step}`)
    })
    console.log('━'.repeat(80))

    // 判断是否成功解析到目标站点
    if (result.finalUrl.includes('yeahpromos.com')) {
      console.log('❌ 问题: Final URL仍然是YeahPromos，没有跳转到目标站点')
    } else if (result.finalUrl.includes('diamondsfactory.ca')) {
      console.log('✅ 成功: Final URL是DiamondFactory目标站点')
    } else {
      console.log(`⚠️  Final URL是其他站点: ${result.finalUrl}`)
    }

  } catch (error: any) {
    console.error('❌ 解析失败:', error.message)
    if (error.stack) {
      console.error('堆栈:', error.stack)
    }
  }
}

diagnoseYeahPromosResolution()
