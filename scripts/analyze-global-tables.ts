/**
 * 全局共享数据表分类审查脚本
 * 识别哪些表应该是全局共享的，不需要用户隔离
 */

import { getDatabase } from '../src/lib/db'

async function analyzeGlobalTables() {
  console.log('🔍 分析全局共享数据表\n')

  const db = await getDatabase()

  // 获取所有表
  const tables = await db.query(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `) as Array<{ name: string }>

  console.log(`📊 数据库总表数: ${tables.length}\n`)

  // 分类规则
  const globalTables: Array<{ name: string; reason: string }> = []
  const userTables: Array<{ name: string; hasUserId: boolean }> = []
  const uncertainTables: Array<{ name: string; reason: string }> = []

  for (const table of tables) {
    const tableName = table.name

    // 检查是否有 user_id 字段
    const tableInfo = await db.query(`PRAGMA table_info(${tableName})`) as Array<{
      name: string
      type: string
      notnull: number
    }>

    const hasUserId = tableInfo.some(col => col.name === 'user_id')

    // 全局表分类逻辑
    if (tableName === 'users') {
      globalTables.push({ name: tableName, reason: '用户主表' })
    } else if (tableName.includes('migration')) {
      globalTables.push({ name: tableName, reason: '系统迁移记录' })
    } else if (tableName.includes('backup')) {
      globalTables.push({ name: tableName, reason: '系统备份日志' })
    } else if (tableName.includes('login_attempt')) {
      globalTables.push({ name: tableName, reason: '安全审计日志' })
    } else if (tableName === 'prompt_versions') {
      globalTables.push({ name: tableName, reason: '系统级 AI Prompt 模板（全局共享）' })
    } else if (tableName === 'prompt_usage_stats') {
      globalTables.push({ name: tableName, reason: 'Prompt 使用统计（系统级聚合）' })
    } else if (tableName === 'global_keywords') {
      globalTables.push({ name: tableName, reason: '全局关键词数据库（所有用户共享）' })
    } else if (tableName === 'industry_benchmarks') {
      globalTables.push({ name: tableName, reason: '行业基准数据（所有用户共享）' })
    } else if (tableName === 'google_ads_accounts') {
      // 检查是否有 user_id
      if (hasUserId) {
        userTables.push({ name: tableName, hasUserId: true })
      } else {
        uncertainTables.push({ name: tableName, reason: 'Google Ads 账号 - 需要确认是否需要用户隔离' })
      }
    } else if (hasUserId) {
      userTables.push({ name: tableName, hasUserId: true })
    } else {
      // 没有 user_id 字段，需要判断
      uncertainTables.push({ name: tableName, reason: '缺少 user_id 字段，需要人工判断' })
    }
  }

  // 输出结果
  console.log('🌍 全局共享表（不需要用户隔离）:')
  console.log(`总计: ${globalTables.length} 个\n`)
  for (const table of globalTables) {
    console.log(`  ✅ ${table.name}`)
    console.log(`     原因: ${table.reason}`)
  }

  console.log('\n👤 用户数据表（需要用户隔离）:')
  console.log(`总计: ${userTables.length} 个\n`)
  for (const table of userTables) {
    console.log(`  ✅ ${table.name} (有 user_id 字段)`)
  }

  console.log('\n❓ 不确定的表（需要人工判断）:')
  console.log(`总计: ${uncertainTables.length} 个\n`)
  for (const table of uncertainTables) {
    console.log(`  ⚠️  ${table.name}`)
    console.log(`     ${table.reason}`)

    // 查看表结构辅助判断
    const cols = await db.query(`PRAGMA table_info(${table.name})`) as Array<{
      name: string
      type: string
    }>
    const colNames = cols.map(c => c.name).join(', ')
    console.log(`     字段: ${colNames}`)

    // 查看数据量
    const count = await db.query(`SELECT COUNT(*) as count FROM ${table.name}`) as Array<{ count: number }>
    console.log(`     数据量: ${count[0].count} 条`)
    console.log()
  }

  // 生成建议
  console.log('📝 分类建议:\n')

  console.log('【全局共享表】（无需用户隔离）:')
  for (const table of globalTables) {
    console.log(`  - ${table.name}`)
  }

  console.log('\n【用户数据表】（需要用户隔离）:')
  for (const table of userTables) {
    console.log(`  - ${table.name}`)
  }

  if (uncertainTables.length > 0) {
    console.log('\n【需要确认的表】:')
    for (const table of uncertainTables) {
      console.log(`  - ${table.name}: ${table.reason}`)
    }
  }

  return {
    globalTables,
    userTables,
    uncertainTables,
  }
}

analyzeGlobalTables()
  .then((result) => {
    console.log('\n✅ 分析完成！')
    console.log(`\n统计: 全局表 ${result.globalTables.length} 个，用户表 ${result.userTables.length} 个，待确认 ${result.uncertainTables.length} 个`)
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ 分析失败:', error)
    process.exit(1)
  })
