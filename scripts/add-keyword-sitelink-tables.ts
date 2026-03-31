/**
 * Database Migration: Add global_keywords table and sitelinks column
 */
import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('🚀 开始数据库迁移...')
console.log('📍 数据库路径:', dbPath)

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

const transaction = db.transaction(() => {
  console.log('\n📋 创建 global_keywords 表...')

  // Global keywords table - shared across all users
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      country TEXT NOT NULL,
      language TEXT NOT NULL,
      search_volume INTEGER NOT NULL DEFAULT 0,
      competition TEXT,
      competition_index INTEGER,
      low_top_page_bid REAL,
      high_top_page_bid REAL,
      cached_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(keyword, country, language)
    )
  `)
  console.log('✅ global_keywords 表创建完成')

  // Create index for fast lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_global_keywords_lookup
    ON global_keywords(keyword, country, language);

    CREATE INDEX IF NOT EXISTS idx_global_keywords_cached
    ON global_keywords(cached_at);
  `)
  console.log('✅ global_keywords 索引创建完成')

  // Check if sitelinks column exists in ad_creatives
  const columns = db.prepare("PRAGMA table_info(ad_creatives)").all() as Array<{ name: string }>
  const hasSitelinks = columns.some(c => c.name === 'sitelinks')

  if (!hasSitelinks) {
    console.log('\n📋 添加 sitelinks 列到 ad_creatives 表...')
    db.exec(`
      ALTER TABLE ad_creatives ADD COLUMN sitelinks TEXT DEFAULT '[]'
    `)
    console.log('✅ sitelinks 列添加完成')
  } else {
    console.log('⚠️ sitelinks 列已存在，跳过')
  }
})

try {
  transaction()
  console.log('\n✅ 数据库迁移完成！')

  // Show stats
  const kwCount = db.prepare('SELECT COUNT(*) as count FROM global_keywords').get() as { count: number }
  console.log(`\n📊 global_keywords 表记录数: ${kwCount.count}`)

} catch (error) {
  console.error('❌ 迁移失败:', error)
  process.exit(1)
} finally {
  db.close()
}
