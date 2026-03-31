#!/usr/bin/env node

/**
 * 数据库迁移：添加A/B测试功能
 *
 * 创建以下表：
 * - ab_tests: A/B测试配置表
 * - ab_test_variants: A/B测试变体表
 */

import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'data', 'autoads.db')

function runMigration() {
  console.log('🔄 开始迁移：添加A/B测试表...')

  const db = new Database(DB_PATH)

  try {
    // 开启事务
    db.exec('BEGIN TRANSACTION')

    // 1. 创建 ab_tests 表
    console.log('📋 创建 ab_tests 表...')
    db.exec(`
      CREATE TABLE IF NOT EXISTS ab_tests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        offer_id INTEGER NOT NULL,

        -- 测试基本信息
        test_name TEXT NOT NULL,
        test_description TEXT,
        test_type TEXT NOT NULL CHECK(test_type IN ('headline', 'description', 'cta', 'image', 'full_creative')),

        -- 测试状态
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'running', 'paused', 'completed', 'cancelled')),

        -- 时间范围
        start_date TEXT,
        end_date TEXT,

        -- 测试结果
        winner_variant_id INTEGER,
        statistical_confidence REAL, -- 统计置信度 (0-1)

        -- 测试配置
        min_sample_size INTEGER DEFAULT 100, -- 最小样本量
        confidence_level REAL DEFAULT 0.95, -- 置信水平

        -- 时间戳
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),

        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
        FOREIGN KEY (winner_variant_id) REFERENCES ab_test_variants(id) ON DELETE SET NULL
      );
    `)

    // 创建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ab_tests_user_id ON ab_tests(user_id);
      CREATE INDEX IF NOT EXISTS idx_ab_tests_offer_id ON ab_tests(offer_id);
      CREATE INDEX IF NOT EXISTS idx_ab_tests_status ON ab_tests(status);
      CREATE INDEX IF NOT EXISTS idx_ab_tests_dates ON ab_tests(start_date, end_date);
    `)

    // 2. 创建 ab_test_variants 表
    console.log('📋 创建 ab_test_variants 表...')
    db.exec(`
      CREATE TABLE IF NOT EXISTS ab_test_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ab_test_id INTEGER NOT NULL,

        -- 变体信息
        variant_name TEXT NOT NULL, -- A, B, C, etc.
        variant_label TEXT, -- 可读的标签，如 "Original", "Variation 1"
        ad_creative_id INTEGER NOT NULL,

        -- 流量分配
        traffic_allocation REAL NOT NULL DEFAULT 0.5 CHECK(traffic_allocation >= 0 AND traffic_allocation <= 1),
        is_control INTEGER NOT NULL DEFAULT 0, -- 是否为对照组

        -- 测试结果缓存（从campaign_performance聚合）
        impressions INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        conversions INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,

        -- 计算指标
        ctr REAL, -- Click-through rate
        conversion_rate REAL, -- Conversion rate
        cpa REAL, -- Cost per acquisition

        -- 统计分析
        confidence_interval_lower REAL,
        confidence_interval_upper REAL,
        p_value REAL,

        -- 时间戳
        last_updated_at TEXT, -- 最后一次更新统计数据的时间
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),

        FOREIGN KEY (ab_test_id) REFERENCES ab_tests(id) ON DELETE CASCADE,
        FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE,

        UNIQUE(ab_test_id, variant_name)
      );
    `)

    // 创建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ab_test_variants_test_id ON ab_test_variants(ab_test_id);
      CREATE INDEX IF NOT EXISTS idx_ab_test_variants_creative_id ON ab_test_variants(ad_creative_id);
    `)

    // 3. 更新 ad_creatives 表，添加 ab_test_variant_id 字段（如果不存在）
    console.log('📋 更新 ad_creatives 表...')

    // 检查列是否存在
    const columns = db.pragma('table_info(ad_creatives)') as Array<{ name: string }>
    const hasAbTestColumn = columns.some((col) => col.name === 'ab_test_variant_id')

    if (!hasAbTestColumn) {
      db.exec(`
        ALTER TABLE ad_creatives
        ADD COLUMN ab_test_variant_id INTEGER REFERENCES ab_test_variants(id) ON DELETE SET NULL;
      `)

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_ad_creatives_ab_test_variant ON ad_creatives(ab_test_variant_id);
      `)
      console.log('✅ 已添加 ab_test_variant_id 列到 ad_creatives 表')
    } else {
      console.log('⏭️  ad_test_variant_id 列已存在，跳过')
    }

    // 4. 记录迁移历史
    db.exec(`
      CREATE TABLE IF NOT EXISTS migration_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_name TEXT NOT NULL UNIQUE,
        executed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)

    const migrationName = 'add_ab_testing_tables'
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

    console.log('✅ 迁移完成！')
    console.log('')
    console.log('创建的表：')
    console.log('  - ab_tests: A/B测试配置表')
    console.log('  - ab_test_variants: A/B测试变体表')
    console.log('  - 更新 ad_creatives 表（添加 ab_test_variant_id）')

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
