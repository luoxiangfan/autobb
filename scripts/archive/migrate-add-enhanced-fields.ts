import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('🚀 开始迁移：添加增强数据字段到offers表...')
console.log('📍 数据库路径:', dbPath)

const db = new Database(dbPath)

try {
  // 启用外键约束
  db.pragma('foreign_keys = ON')

  // 检查列是否已存在
  const tableInfo = db.pragma('table_info(offers)') as Array<{ name: string }>
  const existingColumns = tableInfo.map(col => col.name)

  console.log('\n📋 当前offers表字段:', existingColumns.join(', '))

  const columnsToAdd = [
    { name: 'pricing', type: 'TEXT', description: '价格信息（JSON格式）' },
    { name: 'reviews', type: 'TEXT', description: '评论数据（JSON格式）' },
    { name: 'promotions', type: 'TEXT', description: '促销信息（JSON格式）' },
    { name: 'competitive_edges', type: 'TEXT', description: '竞争优势（JSON格式）' }
  ]

  console.log('\n🔨 准备添加字段...\n')

  let addedCount = 0
  for (const column of columnsToAdd) {
    if (existingColumns.includes(column.name)) {
      console.log(`⏭️  字段 "${column.name}" 已存在，跳过`)
    } else {
      db.exec(`ALTER TABLE offers ADD COLUMN ${column.name} ${column.type}`)
      console.log(`✅ 添加字段: ${column.name} (${column.description})`)
      addedCount++
    }
  }

  if (addedCount === 0) {
    console.log('\n✨ 所有字段已存在，无需迁移')
  } else {
    console.log(`\n✅ 迁移完成！成功添加 ${addedCount} 个字段`)
  }

  // 显示更新后的表结构
  const updatedTableInfo = db.pragma('table_info(offers)') as Array<{ name: string, type: string }>
  console.log('\n📊 更新后的offers表字段:')
  updatedTableInfo.forEach(col => {
    console.log(`   - ${col.name}: ${col.type}`)
  })

} catch (error) {
  console.error('❌ 迁移失败:', error)
  process.exit(1)
} finally {
  db.close()
  console.log('\n🔒 数据库连接已关闭')
}
