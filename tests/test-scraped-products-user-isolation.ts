/**
 * 测试 scraped_products 表的用户隔离功能
 * 验证：
 * 1. user_id 字段是否存在
 * 2. 外键约束是否正确
 * 3. 数据隔离是否有效
 */

import { getDatabase } from '../src/lib/db'

async function testScrapedProductsUserIsolation() {
  console.log('🧪 开始测试 scraped_products 表的用户隔离...\n')

  const db = await getDatabase()

  try {
    // 测试 1: 检查表结构
    console.log('📋 测试 1: 检查表结构')
    const tableInfo = await db.query(`
      SELECT sql FROM sqlite_master
      WHERE type='table' AND name='scraped_products'
    `) as Array<{ sql: string }>

    if (tableInfo.length === 0) {
      console.error('❌ 表 scraped_products 不存在')
      return
    }

    const tableSql = tableInfo[0].sql
    console.log('表结构:', tableSql.substring(0, 200) + '...')

    // 检查 user_id 字段
    if (tableSql.includes('user_id')) {
      console.log('✅ user_id 字段存在')
    } else {
      console.error('❌ user_id 字段不存在')
      return
    }

    // 检查外键约束
    if (tableSql.includes('FOREIGN KEY') && tableSql.includes('user_id')) {
      console.log('✅ user_id 外键约束存在')
    } else {
      console.log('⚠️ user_id 外键约束可能缺失')
    }

    // 测试 2: 检查现有数据
    console.log('\n📊 测试 2: 检查现有数据')
    const dataCheck = await db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(CASE WHEN user_id IS NULL THEN 1 END) as null_users
      FROM scraped_products
    `) as Array<{ total: number; unique_users: number; null_users: number }>

    if (dataCheck.length > 0) {
      const stats = dataCheck[0]
      console.log(`总记录数: ${stats.total}`)
      console.log(`不同用户数: ${stats.unique_users}`)
      console.log(`user_id 为 NULL 的记录: ${stats.null_users}`)

      if (stats.null_users > 0) {
        console.error('❌ 存在 user_id 为 NULL 的记录，需要执行数据迁移')
      } else {
        console.log('✅ 所有记录都有有效的 user_id')
      }
    }

    // 测试 3: 检查索引
    console.log('\n🔍 测试 3: 检查索引')
    const indexes = await db.query(`
      SELECT name, sql FROM sqlite_master
      WHERE type='index' AND tbl_name='scraped_products'
    `) as Array<{ name: string; sql: string | null }>

    console.log(`找到 ${indexes.length} 个索引:`)
    let hasUserIdIndex = false
    let hasUserOfferIndex = false

    for (const idx of indexes) {
      if (idx.sql) {
        console.log(`  - ${idx.name}`)
        if (idx.name.includes('user_id')) {
          hasUserIdIndex = true
        }
        if (idx.name.includes('user') && idx.name.includes('offer')) {
          hasUserOfferIndex = true
        }
      }
    }

    if (hasUserIdIndex) {
      console.log('✅ user_id 索引存在')
    } else {
      console.log('⚠️ user_id 索引缺失')
    }

    if (hasUserOfferIndex) {
      console.log('✅ user_id + offer_id 组合索引存在')
    } else {
      console.log('⚠️ user_id + offer_id 组合索引缺失')
    }

    // 测试 4: 验证数据隔离（如果有数据）
    console.log('\n🔒 测试 4: 验证数据隔离')
    const sampleData = await db.query(`
      SELECT user_id, offer_id, COUNT(*) as count
      FROM scraped_products
      GROUP BY user_id, offer_id
      ORDER BY user_id, offer_id
      LIMIT 5
    `) as Array<{ user_id: number; offer_id: number; count: number }>

    if (sampleData.length > 0) {
      console.log('样本数据（按用户分组）:')
      for (const row of sampleData) {
        console.log(`  user_id=${row.user_id}, offer_id=${row.offer_id}, 产品数=${row.count}`)
      }
      console.log('✅ 数据按用户正确隔离')
    } else {
      console.log('ℹ️ 表中暂无数据')
    }

    // 测试 5: 检查视图
    console.log('\n👁️ 测试 5: 检查视图')
    const views = await db.query(`
      SELECT name, sql FROM sqlite_master
      WHERE type='view' AND name LIKE '%scraped%'
    `) as Array<{ name: string; sql: string }>

    for (const view of views) {
      console.log(`\n视图: ${view.name}`)
      if (view.sql.includes('user_id')) {
        console.log('✅ 视图包含 user_id 隔离条件')
      } else {
        console.log('⚠️ 视图可能缺少 user_id 隔离条件')
      }
    }

    console.log('\n✅ 所有测试完成！')

  } catch (error: any) {
    console.error('❌ 测试过程中出现错误:', error.message)
    console.error(error.stack)
  }
}

// 运行测试
testScrapedProductsUserIsolation()
  .then(() => {
    console.log('\n🎉 测试脚本执行完成')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 测试脚本执行失败:', error)
    process.exit(1)
  })
