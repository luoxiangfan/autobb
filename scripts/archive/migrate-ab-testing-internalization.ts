#!/usr/bin/env node

/**
 * 数据库迁移：A/B测试内化到发布和优化流程
 *
 * 修改：
 * - ab_tests表：添加is_auto_test, test_mode, parent_campaign_id, test_dimension字段
 * - campaigns表：添加is_test_variant, ab_test_id, traffic_allocation字段
 */

import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'data', 'autoads.db')

function runMigration() {
  console.log('🔄 开始迁移：A/B测试内化到发布和优化流程...')

  const db = new Database(DB_PATH)

  try {
    // 开启事务
    db.exec('BEGIN TRANSACTION')

    // 1. 修改 ab_tests 表
    console.log('📋 更新 ab_tests 表...')

    // 检查列是否存在
    const abTestsColumns = db.pragma('table_info(ab_tests)') as Array<{ name: string }>

    // 添加 is_auto_test 字段
    if (!abTestsColumns.some((col) => col.name === 'is_auto_test')) {
      db.exec(`
        ALTER TABLE ab_tests
        ADD COLUMN is_auto_test INTEGER DEFAULT 1;
      `)
      console.log('  ✅ 添加 is_auto_test 字段')
    } else {
      console.log('  ⏭️  is_auto_test 字段已存在')
    }

    // 添加 test_mode 字段
    if (!abTestsColumns.some((col) => col.name === 'test_mode')) {
      db.exec(`
        ALTER TABLE ab_tests
        ADD COLUMN test_mode TEXT DEFAULT 'manual' CHECK(test_mode IN (
          'launch_multi_variant',
          'optimization_challenge',
          'manual'
        ));
      `)
      console.log('  ✅ 添加 test_mode 字段')
    } else {
      console.log('  ⏭️  test_mode 字段已存在')
    }

    // 添加 parent_campaign_id 字段
    if (!abTestsColumns.some((col) => col.name === 'parent_campaign_id')) {
      db.exec(`
        ALTER TABLE ab_tests
        ADD COLUMN parent_campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL;
      `)
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_ab_tests_parent_campaign ON ab_tests(parent_campaign_id);
      `)
      console.log('  ✅ 添加 parent_campaign_id 字段及索引')
    } else {
      console.log('  ⏭️  parent_campaign_id 字段已存在')
    }

    // 添加 test_dimension 字段
    if (!abTestsColumns.some((col) => col.name === 'test_dimension')) {
      db.exec(`
        ALTER TABLE ab_tests
        ADD COLUMN test_dimension TEXT DEFAULT 'creative' CHECK(test_dimension IN (
          'creative',
          'strategy'
        ));
      `)
      console.log('  ✅ 添加 test_dimension 字段（creative=创意维度, strategy=投放策略维度）')
    } else {
      console.log('  ⏭️  test_dimension 字段已存在')
    }

    // 4. 更新 ab_tests 表的 test_type CHECK约束
    console.log('📋 检查 test_type 字段约束...')

    // SQLite不支持直接修改CHECK约束，需要验证现有数据符合新约束
    // 新的test_type值：headline, description, keyword, callout, sitelink, full_creative
    // 移除：image, cta

    const invalidTestTypes = db.prepare(`
      SELECT id, test_type FROM ab_tests
      WHERE test_type IN ('image', 'cta')
    `).all()

    if (invalidTestTypes.length > 0) {
      console.log(`  ⚠️  发现 ${invalidTestTypes.length} 个旧的test_type需要迁移`)
      // 将旧的image和cta类型迁移为full_creative
      db.prepare(`
        UPDATE ab_tests
        SET test_type = 'full_creative'
        WHERE test_type IN ('image', 'cta')
      `).run()
      console.log('  ✅ 已将旧的image/cta类型迁移为full_creative')
    } else {
      console.log('  ✅ 无需迁移旧的test_type数据')
    }

    // 2. 修改 campaigns 表
    console.log('📋 更新 campaigns 表...')

    const campaignsColumns = db.pragma('table_info(campaigns)') as Array<{ name: string }>

    // 添加 is_test_variant 字段
    if (!campaignsColumns.some((col) => col.name === 'is_test_variant')) {
      db.exec(`
        ALTER TABLE campaigns
        ADD COLUMN is_test_variant INTEGER DEFAULT 0;
      `)
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_campaigns_is_test_variant ON campaigns(is_test_variant);
      `)
      console.log('  ✅ 添加 is_test_variant 字段及索引')
    } else {
      console.log('  ⏭️  is_test_variant 字段已存在')
    }

    // 添加 ab_test_id 字段
    if (!campaignsColumns.some((col) => col.name === 'ab_test_id')) {
      db.exec(`
        ALTER TABLE campaigns
        ADD COLUMN ab_test_id INTEGER REFERENCES ab_tests(id) ON DELETE SET NULL;
      `)
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_campaigns_ab_test_id ON campaigns(ab_test_id);
      `)
      console.log('  ✅ 添加 ab_test_id 字段及索引')
    } else {
      console.log('  ⏭️  ab_test_id 字段已存在')
    }

    // 添加 traffic_allocation 字段
    if (!campaignsColumns.some((col) => col.name === 'traffic_allocation')) {
      db.exec(`
        ALTER TABLE campaigns
        ADD COLUMN traffic_allocation REAL DEFAULT 1.0 CHECK(traffic_allocation >= 0 AND traffic_allocation <= 1);
      `)
      console.log('  ✅ 添加 traffic_allocation 字段')
    } else {
      console.log('  ⏭️  traffic_allocation 字段已存在')
    }

    // 3. 记录迁移历史
    db.exec(`
      CREATE TABLE IF NOT EXISTS migration_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_name TEXT NOT NULL UNIQUE,
        executed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)

    const migrationName = 'ab_testing_internalization'
    const existingMigration = db.prepare(
      'SELECT * FROM migration_history WHERE migration_name = ?'
    ).get(migrationName)

    if (!existingMigration) {
      db.prepare(
        'INSERT INTO migration_history (migration_name) VALUES (?)'
      ).run(migrationName)
      console.log(`✅ 记录迁移历史: ${migrationName}`)
    }

    // 提交事务
    db.exec('COMMIT')

    console.log('')
    console.log('✅ 迁移完成！')
    console.log('')
    console.log('修改内容：')
    console.log('  ab_tests表:')
    console.log('    - is_auto_test: 是否为自动测试（1=自动，0=手动）')
    console.log('    - test_mode: 测试模式（launch_multi_variant|optimization_challenge|manual）')
    console.log('    - parent_campaign_id: 关联的父Campaign ID（用于优化测试）')
    console.log('    - test_dimension: 测试维度（creative=创意维度 | strategy=投放策略维度）')
    console.log('')
    console.log('  campaigns表:')
    console.log('    - is_test_variant: 是否为测试变体（1=是，0=否）')
    console.log('    - ab_test_id: 关联的A/B测试ID')
    console.log('    - traffic_allocation: 流量分配比例（0-1，通过预算分配实现）')
    console.log('')
    console.log('  test_type支持的创意维度:')
    console.log('    - headline: 标题测试')
    console.log('    - description: 描述测试')
    console.log('    - keyword: 关键词测试')
    console.log('    - callout: 附加信息测试')
    console.log('    - sitelink: 附加链接测试')
    console.log('    - full_creative: 完整创意测试')
    console.log('')
    console.log('  实施策略:')
    console.log('    - 第一阶段: 创意维度测试（找到表现最好的广告创意）')
    console.log('    - 第二阶段: 投放策略维度测试（降低CPC，获得更多点击）')
    console.log('    - 流量控制: Campaign Budget分配（预算70/30分配）')

  } catch (error) {
    // 回滚事务
    db.exec('ROLLBACK')
    console.error('❌ 迁移失败:', error)
    throw error
  } finally {
    db.close()
  }
}

// 执行迁移
if (require.main === module) {
  try {
    runMigration()
    process.exit(0)
  } catch (error) {
    console.error('迁移脚本执行失败')
    process.exit(1)
  }
}

export default runMigration
