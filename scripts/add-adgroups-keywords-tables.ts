import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('🚀 开始添加ad_groups和keywords表...')
console.log('📍 数据库路径:', dbPath)

const db = new Database(dbPath)
console.log('✅ 数据库连接成功')

// 启用外键约束
db.pragma('foreign_keys = ON')

// 开始事务
const transaction = db.transaction(() => {
  console.log('\n📋 创建新表...\n')

  // ad_groups表 - 广告组
  db.exec(`
    CREATE TABLE IF NOT EXISTS ad_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      ad_group_id TEXT UNIQUE,
      ad_group_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PAUSED',
      cpc_bid_micros INTEGER,
      creation_status TEXT NOT NULL DEFAULT 'draft',
      creation_error TEXT,
      last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ ad_groups表')

  // keywords表 - 关键词
  db.exec(`
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ad_group_id INTEGER NOT NULL,
      keyword_id TEXT UNIQUE,
      keyword_text TEXT NOT NULL,
      match_type TEXT NOT NULL DEFAULT 'BROAD',
      status TEXT NOT NULL DEFAULT 'PAUSED',
      cpc_bid_micros INTEGER,
      final_url TEXT,
      is_negative INTEGER NOT NULL DEFAULT 0,
      quality_score INTEGER,
      ai_generated INTEGER NOT NULL DEFAULT 0,
      generation_source TEXT,
      creation_status TEXT NOT NULL DEFAULT 'draft',
      creation_error TEXT,
      last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (ad_group_id) REFERENCES ad_groups(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ keywords表')

  console.log('\n📋 创建索引...\n')

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ad_groups_user_id ON ad_groups(user_id);
    CREATE INDEX IF NOT EXISTS idx_ad_groups_campaign_id ON ad_groups(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_keywords_user_id ON keywords(user_id);
    CREATE INDEX IF NOT EXISTS idx_keywords_ad_group_id ON keywords(ad_group_id);
    CREATE INDEX IF NOT EXISTS idx_keywords_status ON keywords(status);
  `)
  console.log('✅ 索引创建完成')
})

// 执行事务
try {
  transaction()
  console.log('\n✅ 表创建完成！\n')

  // 验证表是否创建成功
  const adGroupsCount = db
    .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='ad_groups'")
    .get() as { count: number }

  const keywordsCount = db
    .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='keywords'")
    .get() as { count: number }

  console.log('📊 验证结果:')
  console.log(`   - ad_groups表: ${adGroupsCount.count === 1 ? '✅ 存在' : '❌ 不存在'}`)
  console.log(`   - keywords表: ${keywordsCount.count === 1 ? '✅ 存在' : '❌ 不存在'}`)
} catch (error: any) {
  console.error('❌ 表创建失败:', error.message)
  process.exit(1)
} finally {
  db.close()
}
