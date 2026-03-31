/**
 * 模拟换链接任务执行，排查 IPRocket 错误
 */

import { resolveAffiliateLink } from '../src/lib/url-resolver-enhanced'
import { initializeProxyPool } from '../src/lib/offer-utils'

async function testUrlSwapExecution() {
  console.log('🔍 开始模拟换链接任务执行\n')

  const userId = 1
  const affiliateLink = 'https://pboost.me/t12d1A1BD'
  const targetCountry = 'DE'

  try {
    // 步骤 1: 初始化代理池
    console.log('步骤 1: 初始化代理池...')
    await initializeProxyPool(userId, targetCountry)
    console.log('✅ 代理池初始化成功\n')

    // 步骤 2: 解析推广链接
    console.log('步骤 2: 解析推广链接...')
    console.log(`  链接: ${affiliateLink}`)
    console.log(`  国家: ${targetCountry}`)

    const startTime = Date.now()
    const result = await resolveAffiliateLink(affiliateLink, {
      targetCountry,
      skipCache: true,
    })
    const duration = Date.now() - startTime

    console.log(`✅ 解析成功 (耗时: ${duration}ms)`)
    console.log(`  Final URL: ${result.finalUrl}`)
    console.log(`  Final URL Suffix: ${result.finalUrlSuffix || '(无)'}`)
    console.log(`  解析方法: ${result.resolverUsed || '未知'}`)

  } catch (error: any) {
    console.error('\n❌ 执行失败:')
    console.error(`  错误类型: ${error.constructor.name}`)
    console.error(`  错误消息: ${error.message}`)

    if (error.stack) {
      console.error('\n堆栈跟踪:')
      console.error(error.stack)
    }

    // 检查是否是 IPRocket 相关错误
    if (error.message.includes('IPRocket') || error.message.includes('Business abnormality')) {
      console.error('\n🔴 这是 IPRocket 相关错误')
      console.error('需要进一步排查代理获取逻辑')
    }

    process.exit(1)
  }
}

testUrlSwapExecution()
