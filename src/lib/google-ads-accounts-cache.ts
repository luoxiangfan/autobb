/**
 * Google Ads 账号列表 DB 缓存与 upsert
 */
import { getDatabase } from './db'
import { getInsertedId } from './db-helpers'

export interface CachedAccount {
  id: number
  customer_id: string
  account_name: string | null
  currency: string
  timezone: string
  is_manager_account: any
  is_active: any
  is_deleted?: any
  status: string | null
  test_account: any
  account_balance: number | null
  parent_mcc_id: string | null
  auth_type?: string | null
  service_account_id?: string | null
  identity_verification_program_status: string | null
  identity_verification_start_deadline_time: string | null
  identity_verification_completion_deadline_time: string | null
  identity_verification_overdue: any
  identity_verification_checked_at: string | null
  last_sync_at: string | null
}

export const GOOGLE_ADS_ACCOUNTS_CACHE_MAX_AGE_MS = 60 * 60 * 1000 // 1小时：避免发布流程使用到过期账号信息

export async function getCachedAccounts(params: {
  userId: number
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string | null
}): Promise<CachedAccount[]> {
  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
  const isDeletedCheck = db.type === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE'

  const scopeSqlParts: string[] = []
  const scopeParams: any[] = []
  if (params.authType === 'service_account') {
    scopeSqlParts.push(`auth_type = 'service_account'`)
    scopeSqlParts.push(`service_account_id = ?`)
    scopeParams.push(params.serviceAccountId || '')
  } else {
    scopeSqlParts.push(`(auth_type IS NULL OR auth_type = 'oauth')`)
    scopeSqlParts.push(`(service_account_id IS NULL OR service_account_id = '')`)
  }
  const scopeSql = scopeSqlParts.length > 0 ? scopeSqlParts.join(' AND ') : '1=1'

  return await db.query(`
    SELECT id, customer_id, account_name, currency, timezone,
           is_manager_account, is_active, is_deleted, status, test_account,
           account_balance, parent_mcc_id,
           auth_type, service_account_id,
           identity_verification_program_status,
           identity_verification_start_deadline_time,
           identity_verification_completion_deadline_time,
           identity_verification_overdue,
           identity_verification_checked_at,
           last_sync_at
    FROM google_ads_accounts
    WHERE user_id = ?
      AND ${isActiveCondition}
      AND ${isDeletedCheck}
      AND ${scopeSql}
    ORDER BY is_manager_account DESC, account_name ASC
  `, [params.userId, ...scopeParams]) as CachedAccount[]
}

/**
 * 保存或更新账号到数据库
 * 返回 { id: number, last_sync_at: string }
 */
export async function upsertAccount(userId: number, account: {
  customer_id: string
  descriptive_name: string
  currency_code: string
  time_zone: string
  manager: boolean
  test_account: boolean
  status: string
  account_balance?: number | null
  parent_mcc?: string
  identity_verification_program_status?: string | null
  identity_verification_start_deadline_time?: string | null
  identity_verification_completion_deadline_time?: string | null
  identity_verification_overdue?: boolean
  identity_verification_checked_at?: string | null
}, authScope: {
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string | null
}): Promise<{ id: number; last_sync_at: string }> {
  if (!authScope?.authType) {
    throw new Error('upsertAccount requires authScope.authType')
  }
  const db = await getDatabase()
  const activeValue = db.type === 'postgres' ? true : 1
  const notDeletedValue = db.type === 'postgres' ? false : 0

  // 检查是否已存在
  const existing = await db.queryOne(`
    SELECT id, last_sync_at FROM google_ads_accounts
    WHERE user_id = ? AND customer_id = ?
  `, [userId, account.customer_id]) as { id: number; last_sync_at: string } | undefined

  if (existing) {
    // 更新
    await db.exec(`
      UPDATE google_ads_accounts
      SET account_name = ?,
          currency = ?,
          timezone = ?,
          is_manager_account = ?,
          is_active = ?,
          is_deleted = ?,
          deleted_at = NULL,
          test_account = ?,
          status = ?,
          account_balance = ?,
          parent_mcc_id = ?,
          auth_type = ?,
          service_account_id = ?,
          identity_verification_program_status = ?,
          identity_verification_start_deadline_time = ?,
          identity_verification_completion_deadline_time = ?,
          identity_verification_overdue = ?,
          identity_verification_checked_at = ?,
          last_sync_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `, [
      account.descriptive_name,
      account.currency_code,
      account.time_zone,
      account.manager,
      activeValue,
      notDeletedValue,
      account.test_account,
      account.status,
      account.account_balance ?? null,
      account.parent_mcc || null,
      // 同步元数据须与当前 API 认证方式一致
      authScope.authType,
      authScope.serviceAccountId || null,
      account.identity_verification_program_status ?? null,
      account.identity_verification_start_deadline_time ?? null,
      account.identity_verification_completion_deadline_time ?? null,
      Boolean(account.identity_verification_overdue),
      account.identity_verification_checked_at ?? null,
      existing.id
    ])
    return { id: existing.id, last_sync_at: new Date().toISOString() }
  } else {
    // 插入
    const result = await db.exec(`
      INSERT INTO google_ads_accounts (
        user_id, customer_id, account_name, currency, timezone,
        is_manager_account, is_active, is_deleted, deleted_at,
        test_account, status, account_balance, parent_mcc_id,
        auth_type, service_account_id,
        identity_verification_program_status,
        identity_verification_start_deadline_time,
        identity_verification_completion_deadline_time,
        identity_verification_overdue,
        identity_verification_checked_at,
        last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
      userId,
      account.customer_id,
      account.descriptive_name,
      account.currency_code,
      account.time_zone,
      account.manager,
      activeValue,
      notDeletedValue,
      account.test_account,
      account.status,
      account.account_balance ?? null,
      account.parent_mcc || null,
      // 同步元数据须与当前 API 认证方式一致
      authScope.authType,
      authScope.serviceAccountId || null,
      account.identity_verification_program_status ?? null,
      account.identity_verification_start_deadline_time ?? null,
      account.identity_verification_completion_deadline_time ?? null,
      Boolean(account.identity_verification_overdue),
      account.identity_verification_checked_at ?? null,
    ])
    const insertedId = getInsertedId(result, db.type)
    return { id: insertedId, last_sync_at: new Date().toISOString() }
  }
}

export async function deactivateMissingAccounts(params: {
  userId: number
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string | null
  seenCustomerIds: Set<string>
}) {
  if (!params.seenCustomerIds || params.seenCustomerIds.size === 0) return

  const db = await getDatabase()
  const inactiveValue = db.type === 'postgres' ? false : 0
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
  const isDeletedCheck = db.type === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE'

  const scopeSqlParts: string[] = []
  const scopeParams: any[] = []

  if (params.authType === 'service_account') {
    scopeSqlParts.push(`auth_type = 'service_account'`)
    scopeSqlParts.push(`service_account_id = ?`)
    scopeParams.push(params.serviceAccountId || '')
  } else {
    scopeSqlParts.push(`(auth_type IS NULL OR auth_type = 'oauth')`)
    scopeSqlParts.push(`(service_account_id IS NULL OR service_account_id = '')`)
  }

  const scopeSql = scopeSqlParts.length > 0 ? scopeSqlParts.join(' AND ') : '1=1'

  const existingActive = await db.query<{ customer_id: string }>(`
    SELECT customer_id
    FROM google_ads_accounts
    WHERE user_id = ?
      AND ${isActiveCondition}
      AND ${isDeletedCheck}
      AND ${scopeSql}
  `, [params.userId, ...scopeParams])

  const missing = (existingActive as any[])
    .map((r) => r?.customer_id)
    .filter((id) => typeof id === 'string' && id.trim().length > 0)
    .filter((id) => !params.seenCustomerIds.has(id))

  if (missing.length === 0) return

  const placeholders = missing.map(() => '?').join(', ')
  await db.exec(`
    UPDATE google_ads_accounts
    SET is_active = ?, updated_at = datetime('now')
    WHERE user_id = ?
      AND ${isDeletedCheck}
      AND ${scopeSql}
      AND customer_id IN (${placeholders})
  `, [inactiveValue, params.userId, ...scopeParams, ...missing])

  console.log(`🧹 已标记 ${missing.length} 个已解除关联的账号为非激活: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '...' : ''}`)
}

