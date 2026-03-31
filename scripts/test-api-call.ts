#!/usr/bin/env tsx
/**
 * 测试 Keyword Planner API 调用
 */

import { getKeywordSearchVolumes } from '../src/lib/keyword-planner'

async function main() {
  console.log('=== 测试 Keyword Planner API ===\n')

  const testKeywords = [
    'dr mercola',
    'mercola',
    'dr mercola supplements'
  ]

  console.log(`测试关键词: ${testKeywords.join(', ')}\n`)

  try {
    const results = await getKeywordSearchVolumes(
      testKeywords,
      'US',
      'en',
      1,  // user_id
      'oauth',
      undefined
    )

    console.log('\n=== API 返回结果 ===\n')
    console.table(results.map((r: any) => ({
      keyword: r.keyword,
      avgMonthlySearches: r.avgMonthlySearches || 0,
      competition: r.competition || 'N/A',
      volumeUnavailableReason: r.volumeUnavailableReason || 'N/A'
    })))

    // 检查是否有问题
    const allZero = results.every((r: any) => !r.avgMonthlySearches || r.avgMonthlySearches === 0)
    const hasReason = results.some((r: any) => r.volumeUnavailableReason)

    console.log('\n=== 诊断结果 ===\n')
    console.log(`所有搜索量都是 0: ${allZero ? '❌ 是' : '✅ 否'}`)
    console.log(`有 volumeUnavailableReason: ${hasReason ? '❌ 是' : '✅ 否'}`)

    if (hasReason) {
      console.log('\n⚠️ 检测到 volumeUnavailableReason:')
      results.forEach((r: any) => {
        if (r.volumeUnavailableReason) {
          console.log(`  - ${r.keyword}: ${r.volumeUnavailableReason}`)
        }
      })
    }

    if (allZero && !hasReason) {
      console.log('\n⚠️ 所有搜索量都是 0，但没有 volumeUnavailableReason')
      console.log('可能的原因:')
      console.log('  1. 关键词质量太差，Keyword Planner 没有数据')
      console.log('  2. API 调用参数有问题')
      console.log('  3. Developer Token 权限问题（但没有正确检测）')
    }

  } catch (error: any) {
    console.error('\n❌ API 调用失败:')
    console.error(error.message)
    console.error(error.stack)
  }
}

main().catch(console.error)
