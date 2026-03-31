/**
 * 重置测试用户密码
 */
import { getSQLiteDatabase } from '../src/lib/db'
import { hashPassword } from '../src/lib/crypto'

async function resetPassword() {
  const db = getSQLiteDatabase()

  const newPassword = 'autoads123'
  const passwordHash = await hashPassword(newPassword)

  db.prepare('UPDATE users SET password_hash = ? WHERE username = ?')
    .run(passwordHash, 'autoads')

  console.log('✅ 用户密码已重置')
  console.log('   用户名: autoads')
  console.log('   新密码: autoads123')
}

resetPassword().catch(console.error)
