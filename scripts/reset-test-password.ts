/**
 * 重置测试用户密码
 */
import { getDatabase } from '../src/lib/db'
import { hashPassword } from '../src/lib/crypto'

async function resetPassword() {
  const db = getDatabase()

  const newPassword = 'autoads123'
  const passwordHash = await hashPassword(newPassword)

  await db.exec('UPDATE users SET password_hash = ? WHERE username = ?', [passwordHash, 'autoads'])

  console.log('✅ 用户密码已重置')
  console.log('   用户名: autoads')
  console.log('   新密码: autoads123')
}

resetPassword().catch(console.error)
