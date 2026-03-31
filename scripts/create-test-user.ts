import { getDatabase } from '../src/lib/db'
import { hashPassword } from '../src/lib/crypto'

async function createTestUser() {
  const db = getDatabase()
  
  const testPassword = 'TestPass123!'
  const passwordHash = await hashPassword(testPassword)
  
  // Delete existing test user if any
  db.prepare('DELETE FROM users WHERE username = ?').run('testuser')
  
  // Create test user
  const result = db.prepare(`
    INSERT INTO users (
      username, email, password_hash, display_name, role, package_type,
      valid_from, valid_until, is_active, must_change_password, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    'testuser',
    'test@autoads.local',
    passwordHash,
    'Test User',
    'user',
    'annual',
    '2025-01-01',
    '2026-01-01',
    1,
    0
  )
  
  console.log('✅ Test user created successfully')
  console.log('Username: testuser')
  console.log('Password: TestPass123!')
  console.log('Package: Annual (valid from 2025-01-01 to 2026-01-01)')
}

createTestUser().catch(console.error)
