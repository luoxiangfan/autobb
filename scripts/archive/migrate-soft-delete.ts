import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('🚀 开始执行软删除迁移...')
console.log('📍 数据库路径:', dbPath)

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

const transaction = db.transaction(() => {
  console.log('\n📋 添加软删除字段...\n')

  // 1. 为offers表添加软删除字段
  try {
    db.exec(`ALTER TABLE offers ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`)
    console.log('✅ offers表添加is_deleted字段')
  } catch (error: any) {
    if (error.message.includes('duplicate column')) {
      console.log('⏭️  offers.is_deleted字段已存在')
    } else {
      throw error
    }
  }

  try {
    db.exec(`ALTER TABLE offers ADD COLUMN deleted_at TEXT`)
    console.log('✅ offers表添加deleted_at字段')
  } catch (error: any) {
    if (error.message.includes('duplicate column')) {
      console.log('⏭️  offers.deleted_at字段已存在')
    } else {
      throw error
    }
  }

  // 2. 为google_ads_accounts表添加闲置标记
  try {
    db.exec(`ALTER TABLE google_ads_accounts ADD COLUMN is_idle INTEGER NOT NULL DEFAULT 0`)
    console.log('✅ google_ads_accounts表添加is_idle字段')
  } catch (error: any) {
    if (error.message.includes('duplicate column')) {
      console.log('⏭️  google_ads_accounts.is_idle字段已存在')
    } else {
      throw error
    }
  }

  // 3. 创建软删除索引
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_offers_is_deleted ON offers(is_deleted)`)
    console.log('✅ 创建offers软删除索引')
  } catch (error: any) {
    console.log('⏭️  索引已存在')
  }

  console.log('\n✅ 软删除迁移完成！')
})

try {
  transaction()
} catch (error) {
  console.error('❌ 迁移失败:', error)
  process.exit(1)
} finally {
  db.close()
}
