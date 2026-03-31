import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('🚀 开始添加Creative同步字段...')
console.log('📍 数据库路径:', dbPath)

const db = new Database(dbPath)
console.log('✅ 数据库连接成功')

// 启用外键约束
db.pragma('foreign_keys = ON')

// 开始事务
const transaction = db.transaction(() => {
  console.log('\n📋 添加字段...\n')

  // 添加ad_group_id字段
  db.exec(`
    ALTER TABLE creatives ADD COLUMN ad_group_id INTEGER;
  `)
  console.log('✅ 添加ad_group_id字段')

  // 添加ad_id字段（Google Ads Ad ID）
  db.exec(`
    ALTER TABLE creatives ADD COLUMN ad_id TEXT;
  `)
  console.log('✅ 添加ad_id字段')

  // 添加creation_status字段
  db.exec(`
    ALTER TABLE creatives ADD COLUMN creation_status TEXT NOT NULL DEFAULT 'draft';
  `)
  console.log('✅ 添加creation_status字段')

  // 添加creation_error字段
  db.exec(`
    ALTER TABLE creatives ADD COLUMN creation_error TEXT;
  `)
  console.log('✅ 添加creation_error字段')

  // 添加last_sync_at字段
  db.exec(`
    ALTER TABLE creatives ADD COLUMN last_sync_at TEXT;
  `)
  console.log('✅ 添加last_sync_at字段')

  console.log('\n📋 创建索引...\n')

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_creatives_ad_group_id ON creatives(ad_group_id);
    CREATE INDEX IF NOT EXISTS idx_creatives_status ON creatives(creation_status);
  `)
  console.log('✅ 索引创建完成')
})

// 执行事务
try {
  transaction()
  console.log('\n✅ 字段添加完成！\n')

  // 验证字段是否添加成功
  const schema = db.prepare("PRAGMA table_info(creatives)").all() as any[]
  const newFields = schema.filter(col =>
    ['ad_group_id', 'ad_id', 'creation_status', 'creation_error', 'last_sync_at'].includes(
      col.name
    )
  )

  console.log('📊 验证结果:')
  console.log(`   - 新字段数量: ${newFields.length}/5`)
  newFields.forEach(field => {
    console.log(`   - ${field.name}: ✅`)
  })
} catch (error: any) {
  console.error('❌ 字段添加失败:', error.message)
  process.exit(1)
} finally {
  db.close()
}
