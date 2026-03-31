import bcrypt from 'bcrypt'
import Database from 'better-sqlite3'

async function main() {
  const db = new Database('./data/autoads.db')

  // 用户提供的正确密码
  const correctPassword = 'LYTudFbrAfTDmwvtn4+IjowdJn1AZgZyNebCjinHhjk='

  console.log('重置autoads用户密码为用户提供的密码...')
  console.log('密码:', correctPassword)

  // 生成密码哈希
  const passwordHash = await bcrypt.hash(correctPassword, 10)
  console.log('密码哈希:', passwordHash)

  // 更新数据库
  const result = db.prepare(`
    UPDATE users
    SET password_hash = ?,
        updated_at = datetime('now')
    WHERE username = 'autoads'
  `).run(passwordHash)

  console.log('✅ 密码已重置，受影响行数:', result.changes)

  // 验证密码
  const user = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('autoads') as any
  const match = await bcrypt.compare(correctPassword, user.password_hash)
  console.log('✅ 密码验证:', match ? '成功' : '失败')

  db.close()
}

main().catch(console.error)
