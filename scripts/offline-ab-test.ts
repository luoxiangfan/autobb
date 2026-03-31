/**
 * A/B Test 功能下线脚本
 *
 * 执行内容：
 * 1. 删除 A/B Test 相关的数据库表
 * 2. 记录下线操作
 */

import { getDatabase } from '../src/lib/db'

async function offlineABTestFeature() {
  console.log('🚫 开始下线 A/B Test 功能\n')

  const db = await getDatabase()

  try {
    // 检查数据量
    console.log('📊 检查数据量...')
    const abTestCount = await db.query('SELECT COUNT(*) as count FROM ab_tests') as Array<{ count: number }>
    const variantsCount = await db.query('SELECT COUNT(*) as count FROM ab_test_variants') as Array<{ count: number }>

    console.log(`  - ab_tests: ${abTestCount[0].count} 条记录`)
    console.log(`  - ab_test_variants: ${variantsCount[0].count} 条记录`)

    if (abTestCount[0].count > 0 || variantsCount[0].count > 0) {
      console.log('\n⚠️  警告: 表中存在数据！')
      console.log('请确认是否继续删除（建议先备份）\n')
    } else {
      console.log('✅ 表中无数据，可以安全删除\n')
    }

    // 删除表
    console.log('🗑️  删除 A/B Test 相关表...')

    // 1. 先删除依赖表
    await db.exec('DROP TABLE IF EXISTS ab_test_variants')
    console.log('  ✅ 已删除 ab_test_variants 表')

    // 2. 删除主表
    await db.exec('DROP TABLE IF EXISTS ab_tests')
    console.log('  ✅ 已删除 ab_tests 表')

    // 3. 删除相关视图（如果有）
    const views = await db.query(`
      SELECT name FROM sqlite_master
      WHERE type='view' AND name LIKE '%ab_test%'
    `) as Array<{ name: string }>

    for (const view of views) {
      await db.exec(`DROP VIEW IF EXISTS ${view.name}`)
      console.log(`  ✅ 已删除视图 ${view.name}`)
    }

    // 4. 删除相关索引（如果有独立索引）
    const indexes = await db.query(`
      SELECT name FROM sqlite_master
      WHERE type='index' AND name LIKE '%ab_test%'
    `) as Array<{ name: string }>

    for (const index of indexes) {
      await db.exec(`DROP INDEX IF EXISTS ${index.name}`)
      console.log(`  ✅ 已删除索引 ${index.name}`)
    }

    console.log('\n✅ A/B Test 功能数据库表已下线')
    console.log('\n📝 后续手动操作:')
    console.log('  1. 删除 API 路由: src/app/api/ab-tests/')
    console.log('  2. 删除前端页面: src/app/(app)/ab-tests/')
    console.log('  3. 删除组件: src/components/dashboard/ABTestProgressCard.tsx')
    console.log('  4. 删除定时任务: src/scheduler/ab-test-monitor.ts')
    console.log('  5. 从 src/scheduler.ts 中移除 ab-test-monitor 引用')
    console.log('  6. 从 useAPI.ts 和其他文件中移除相关引用')

  } catch (error: any) {
    console.error('\n❌ 下线过程出错:', error.message)
    throw error
  }
}

offlineABTestFeature()
  .then(() => {
    console.log('\n🎉 A/B Test 功能下线完成！')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 下线失败:', error)
    process.exit(1)
  })
