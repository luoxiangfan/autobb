/**
 * 测试换链接任务执行时 IPRocket API 调用频率
 *
 * 目的：验证在 URL 解析重试过程中，IPRocket API 被调用的频率
 */

import { getDatabase } from '../src/lib/db'

async function testUrlSwapIprocketCalls() {
  console.log('='.repeat(80))
  console.log('测试换链接任务执行时 IPRocket API 调用频率')
  console.log('='.repeat(80))

  const db = await getDatabase()

  // 1. 查询最近失败的换链接任务
  console.log('\n📊 查询最近失败的换链接任务...')
  const failedTasks = await db.query(`
    SELECT
      id,
      offer_id,
      user_id,
      status,
      error_message,
      created_at,
      updated_at
    FROM url_swap_tasks
    WHERE error_message LIKE '%IPRocket%业务异常%'
    ORDER BY updated_at DESC
    LIMIT 5
  `)

  console.log(`\n找到 ${failedTasks.length} 个失败任务`)

  if (failedTasks.length === 0) {
    console.log('❌ 没有找到相关失败任务')
    return
  }

  // 2. 分析错误信息
  console.log('\n📋 失败任务详情:')
  for (const task of failedTasks) {
    console.log(`\n任务 ID: ${task.id}`)
    console.log(`Offer ID: ${task.offer_id}`)
    console.log(`用户 ID: ${task.user_id}`)
    console.log(`状态: ${task.status}`)
    console.log(`创建时间: ${task.created_at}`)
    console.log(`更新时间: ${task.updated_at}`)
    console.log(`错误信息: ${task.error_message}`)
  }

  // 3. 分析问题
  console.log('\n' + '='.repeat(80))
  console.log('🔍 问题分析')
  console.log('='.repeat(80))

  console.log(`
根据代码分析，发现以下调用链：

1. URL 解析重试循环（url-resolver-enhanced.ts:788）
   - 默认重试 5 次（短链接）
   - 每次重试都会调用 resolveWithPlaywright

2. resolveWithPlaywright（url-resolver-playwright.ts:722）
   - 调用 getBrowserFromPool

3. getBrowserFromPool（url-resolver-playwright.ts:159）
   - 调用 pool.acquire(proxyUrl, proxyCredentials, targetCountry)

4. PlaywrightPool.acquire（playwright-pool.ts:452）
   - 如果没有空闲实例，调用 createAndRegisterInstance

5. createAndRegisterInstance（playwright-pool.ts:556）
   - 调用 createInstance

6. createInstance（playwright-pool.ts:705）
   - 调用 getProxyIp(proxyUrl, true)  // forceRefresh=true
   - 这会调用 fetchProxyIp
   - 最终调用 provider.extractCredentials(proxyUrl)
   - extractCredentials 会请求 IPRocket API

**关键问题：**
- 如果 Playwright 连接池已满（maxInstances=8）
- 并且有多个换链接任务并发执行
- 每个任务重试 5 次
- 每次重试可能需要创建新的 Playwright 实例
- 每次创建实例都会调用 IPRocket API

**触发高频调用的场景：**
1. 多个换链接任务并发执行（例如 10 个任务）
2. 每个任务重试 5 次
3. Playwright 连接池已满，需要频繁创建新实例
4. 在短时间内（几秒钟）可能产生 10+ 次 IPRocket API 调用
5. 如果调用间隔小于 50ms，会触发 IPRocket 风控

**解决方案：**
1. 在 createInstance 中添加 IPRocket API 调用频率限制
2. 使用代理凭证缓存，避免重复调用 API
3. 增加 Playwright 连接池大小，减少创建新实例的频率
4. 在 fetchProxyIp 中添加全局调用频率限制
  `)

  console.log('\n' + '='.repeat(80))
  console.log('✅ 分析完成')
  console.log('='.repeat(80))
}

testUrlSwapIprocketCalls().catch(console.error)
