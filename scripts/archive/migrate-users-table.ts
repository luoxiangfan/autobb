import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
const db = new Database(dbPath)

try {
    console.log('🚀 开始迁移 users 表结构...')

    // 获取表信息
    const tableInfo = db.pragma('table_info(users)') as any[]
    const hasUsername = tableInfo.some(col => col.name === 'username')
    const hasMustChangePassword = tableInfo.some(col => col.name === 'must_change_password')

    if (!hasUsername) {
        console.log('➕ 添加 username 列...')
        db.exec('ALTER TABLE users ADD COLUMN username TEXT UNIQUE')
    } else {
        console.log('✅ username 列已存在')
    }

    if (!hasMustChangePassword) {
        console.log('➕ 添加 must_change_password 列...')
        db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1')
    } else {
        console.log('✅ must_change_password 列已存在')
    }

    console.log('✅ 数据库迁移完成')
} catch (error) {
    console.error('❌ 迁移失败:', error)
    process.exit(1)
} finally {
    db.close()
}
