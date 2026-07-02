import { hashPassword } from '@/lib/auth/crypto'
import { logger } from '@/lib/common/server'
import type { DatabaseAdapter } from './database'
import { DEFAULT_ADMIN_PROFILE } from './db-init-constants'

export type ExistingAdminPolicy = 'reset-password' | 'ensure-active-only'
export type AdminCredentialLog = 'none' | 'logger' | 'console' | 'console-banner'

export interface EnsureDefaultAdminOptions {
  password: string
  onExisting?: ExistingAdminPolicy
  setOpenclawEnabled?: boolean
  logCredentials?: AdminCredentialLog
  /** 与 db-init 启动路径一致：按 username 或 role=admin 查找 */
  lookupByRole?: boolean
}

export interface EnsureDefaultAdminResult {
  created: boolean
  passwordUpdated: boolean
}

export function requireDefaultAdminPasswordFromEnv(): string {
  const password = process.env.DEFAULT_ADMIN_PASSWORD
  if (!password) {
    throw new Error('DEFAULT_ADMIN_PASSWORD environment variable is required')
  }
  return password
}

async function findExistingAdmin(
  db: DatabaseAdapter,
  lookupByRole: boolean
): Promise<{ id: number } | undefined> {
  if (lookupByRole) {
    return db.queryOne<{ id: number }>('SELECT id FROM users WHERE username = ? OR role = ?', [
      DEFAULT_ADMIN_PROFILE.username,
      DEFAULT_ADMIN_PROFILE.role,
    ])
  }

  return db.queryOne<{ id: number }>('SELECT id FROM users WHERE username = ?', [
    DEFAULT_ADMIN_PROFILE.username,
  ])
}

function logAdminCredentials(password: string, mode: AdminCredentialLog, created: boolean): void {
  if (mode === 'none') return
  if (mode === 'logger' && !created) return

  const lines = [
    `   Username: ${DEFAULT_ADMIN_PROFILE.username}`,
    `   Password: ${password}`,
    `   Email: ${DEFAULT_ADMIN_PROFILE.email}`,
  ]

  if (mode === 'logger') {
    if (created) {
      logger.debug('✅ Default admin account created')
    }
    logger.debug('\n🔑 Admin credentials:')
    for (const line of lines) {
      logger.debug(line)
    }
    logger.debug('\n⚠️  Security Notice:')
    if (process.env.DEFAULT_ADMIN_PASSWORD) {
      logger.debug('   ✅ Using password from DEFAULT_ADMIN_PASSWORD environment variable')
    } else {
      logger.debug('   ⚠️  Random password generated! Please save it immediately:')
      logger.debug(`   👉 ${password}`)
      logger.debug('   Recommended: Set DEFAULT_ADMIN_PASSWORD in production environment')
    }
    return
  }

  if (mode === 'console') {
    if (created) {
      console.log('✅ 管理员账号创建成功')
    } else {
      console.log('✅ 管理员密码已重置')
    }
    console.log('   用户名: autoads')
    console.log('   邮箱: admin@autoads.com')
    return
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('🔑 管理员登录信息')
  console.log('='.repeat(60))
  console.log('用户名:', DEFAULT_ADMIN_PROFILE.username)
  console.log('密码:', password)
  console.log('邮箱:', DEFAULT_ADMIN_PROFILE.email)
  if (created) {
    console.log('角色: admin')
    console.log('套餐类型: lifetime')
  }
  console.log('='.repeat(60))
  console.log('')
  console.log('⚠️  请妥善保存密码！')
}

export async function defaultAdminAccountExists(
  db: DatabaseAdapter,
  lookupByRole = false
): Promise<boolean> {
  const existing = await findExistingAdmin(db, lookupByRole)
  return Boolean(existing)
}

export async function ensureDefaultAdminAccount(
  db: DatabaseAdapter,
  options: EnsureDefaultAdminOptions
): Promise<EnsureDefaultAdminResult> {
  const onExisting = options.onExisting ?? 'reset-password'
  const setOpenclawEnabled = options.setOpenclawEnabled ?? false
  const logCredentials = options.logCredentials ?? 'none'
  const lookupByRole = options.lookupByRole ?? false

  const existingAdmin = await findExistingAdmin(db, lookupByRole)
  const passwordHash = await hashPassword(options.password)

  if (existingAdmin) {
    if (onExisting === 'ensure-active-only') {
      if (setOpenclawEnabled && lookupByRole) {
        await db.exec(
          'UPDATE users SET must_change_password = false, is_active = true, openclaw_enabled = true WHERE username = ? OR role = ?',
          [DEFAULT_ADMIN_PROFILE.username, DEFAULT_ADMIN_PROFILE.role]
        )
      } else if (setOpenclawEnabled) {
        await db.exec(
          'UPDATE users SET must_change_password = false, is_active = true, openclaw_enabled = true WHERE username = ?',
          [DEFAULT_ADMIN_PROFILE.username]
        )
      } else {
        await db.exec(
          'UPDATE users SET must_change_password = false, is_active = true WHERE username = ?',
          [DEFAULT_ADMIN_PROFILE.username]
        )
      }
      return { created: false, passwordUpdated: false }
    }

    if (logCredentials === 'logger') {
      logger.debug('⚠️  Admin account already exists, updating password...')
    }

    if (setOpenclawEnabled && lookupByRole) {
      await db.exec(
        'UPDATE users SET password_hash = ?, must_change_password = false, is_active = true, openclaw_enabled = true WHERE username = ? OR role = ?',
        [passwordHash, DEFAULT_ADMIN_PROFILE.username, DEFAULT_ADMIN_PROFILE.role]
      )
    } else if (setOpenclawEnabled) {
      await db.exec(
        'UPDATE users SET password_hash = ?, must_change_password = false, is_active = true, openclaw_enabled = true WHERE username = ?',
        [passwordHash, DEFAULT_ADMIN_PROFILE.username]
      )
    } else {
      await db.exec('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE username = ?', [
        passwordHash,
        DEFAULT_ADMIN_PROFILE.username,
      ])
    }

    logAdminCredentials(options.password, logCredentials, false)
    if (logCredentials === 'logger') {
      logger.debug('✅ Admin password updated')
    }
    return { created: false, passwordUpdated: true }
  }

  if (setOpenclawEnabled) {
    await db.exec(
      `INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active, openclaw_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, false, true, true)`,
      [
        DEFAULT_ADMIN_PROFILE.username,
        DEFAULT_ADMIN_PROFILE.email,
        passwordHash,
        DEFAULT_ADMIN_PROFILE.display_name,
        DEFAULT_ADMIN_PROFILE.role,
        DEFAULT_ADMIN_PROFILE.package_type,
        DEFAULT_ADMIN_PROFILE.package_expires_at,
      ]
    )
  } else {
    await db.exec(
      `INSERT INTO users (
        username, email, password_hash, display_name, role,
        package_type, package_expires_at, must_change_password,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        DEFAULT_ADMIN_PROFILE.username,
        DEFAULT_ADMIN_PROFILE.email,
        passwordHash,
        DEFAULT_ADMIN_PROFILE.display_name,
        DEFAULT_ADMIN_PROFILE.role,
        DEFAULT_ADMIN_PROFILE.package_type,
        DEFAULT_ADMIN_PROFILE.package_expires_at,
        false,
        true,
      ]
    )
  }

  logAdminCredentials(options.password, logCredentials, true)
  return { created: true, passwordUpdated: true }
}
