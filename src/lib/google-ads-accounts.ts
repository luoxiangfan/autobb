import { getDatabase } from './db'
import { getInsertedId, nowFunc, toBool } from './db-helpers'

export interface GoogleAdsAccount {
  id: number
  userId: number
  customerId: string
  accountName: string | null
  currency: string
  timezone: string
  isManagerAccount: boolean
  isActive: boolean
  status: string | null
  testAccount: boolean
  parentMccId: string | null
  identityVerificationProgramStatus?: string | null
  identityVerificationStartDeadlineTime?: string | null
  identityVerificationCompletionDeadlineTime?: string | null
  identityVerificationOverdue?: boolean
  identityVerificationCheckedAt?: string | null
  accessToken: string | null
  refreshToken: string | null
  tokenExpiresAt: string | null
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
  // 服务账号配置
  serviceAccountId: string | null
}

export interface CreateGoogleAdsAccountInput {
  userId: number
  customerId: string
  accountName?: string
  currency?: string
  timezone?: string
  isManagerAccount?: boolean
  accessToken?: string
  refreshToken?: string
  tokenExpiresAt?: string
}

/**
 * 创建Google Ads账号
 */
export async function createGoogleAdsAccount(input: CreateGoogleAdsAccountInput): Promise<GoogleAdsAccount> {
  const db = await getDatabase()

  const result = await db.exec(`
    INSERT INTO google_ads_accounts (
      user_id, customer_id, account_name,
      currency, timezone, is_manager_account,
      access_token, refresh_token, token_expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.userId,
    input.customerId,
    input.accountName || null,
    input.currency || 'USD',
    input.timezone || 'America/New_York',
    input.isManagerAccount ? 1 : 0,
    input.accessToken || null,
    input.refreshToken || null,
    input.tokenExpiresAt || null
  ])

  const insertedId = getInsertedId(result, db.type)
  return (await findGoogleAdsAccountById(insertedId, input.userId))!
}

/**
 * 查找Google Ads账号（带权限验证）
 */
export async function findGoogleAdsAccountById(id: number, userId: number): Promise<GoogleAdsAccount | null> {
  const db = await getDatabase()

  const isDeletedCheck = db.type === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE'
  const row = await db.queryOne(`
    SELECT * FROM google_ads_accounts
    WHERE id = ? AND user_id = ? AND ${isDeletedCheck}
  `, [id, userId]) as any

  if (!row) {
    return null
  }

  return mapRowToGoogleAdsAccount(row)
}

/**
 * 根据customer_id查找账号
 */
export async function findGoogleAdsAccountByCustomerId(
  customerId: string,
  userId: number
): Promise<GoogleAdsAccount | null> {
  const db = await getDatabase()

  const isDeletedCheck = db.type === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE'
  const row = await db.queryOne(`
    SELECT * FROM google_ads_accounts
    WHERE customer_id = ? AND user_id = ? AND ${isDeletedCheck}
  `, [customerId, userId]) as any

  if (!row) {
    return null
  }

  return mapRowToGoogleAdsAccount(row)
}

/**
 * 查找用户的所有Google Ads账号
 */
export async function findGoogleAdsAccountsByUserId(userId: number): Promise<GoogleAdsAccount[]> {
  const db = await getDatabase()

  const isDeletedCheck = db.type === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE'
  const rows = await db.query(`
    SELECT * FROM google_ads_accounts
    WHERE user_id = ? AND ${isDeletedCheck}
    ORDER BY created_at DESC
  `, [userId]) as any[]

  return rows.map(mapRowToGoogleAdsAccount)
}

/**
 * 查找用户的激活账号（包括所有状态）
 * 注意：这会返回所有is_active=1的账号，包括DISABLED状态的
 * 如果需要可用于API调用的账号，请使用 findEnabledGoogleAdsAccounts
 */
export async function findActiveGoogleAdsAccounts(userId: number): Promise<GoogleAdsAccount[]> {
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性修复: is_active在PostgreSQL中是BOOLEAN类型
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
  const isDeletedCheck = db.type === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE'

  const rows = await db.query(`
    SELECT * FROM google_ads_accounts
    WHERE user_id = ? AND ${isActiveCondition} AND ${isDeletedCheck}
    ORDER BY created_at DESC
  `, [userId]) as any[]

  return rows.map(mapRowToGoogleAdsAccount)
}

/**
 * 查找用户可用于API调用的账号（ENABLED状态，非Manager账号）
 */
export async function findEnabledGoogleAdsAccounts(userId: number): Promise<GoogleAdsAccount[]> {
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性修复: 布尔字段在PostgreSQL中是BOOLEAN类型
  // 使用SQL条件而非参数绑定，避免类型不匹配
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
  const isManagerCondition = db.type === 'postgres' ? 'is_manager_account = false' : 'is_manager_account = 0'
  const identityVerificationOkCondition = db.type === 'postgres'
    ? '(identity_verification_overdue IS NULL OR identity_verification_overdue = false)'
    : '(identity_verification_overdue IS NULL OR identity_verification_overdue = 0)'
  const isDeletedCheck = db.type === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE'

  const rows = await db.query(`
    SELECT * FROM google_ads_accounts
    WHERE user_id = ?
      AND ${isActiveCondition}
      AND status = 'ENABLED'
      AND ${isManagerCondition}
      AND ${identityVerificationOkCondition}
      AND ${isDeletedCheck}
    ORDER BY created_at DESC
  `, [userId]) as any[]

  return rows.map(mapRowToGoogleAdsAccount)
}

/**
 * 更新Google Ads账号
 */
export async function updateGoogleAdsAccount(
  id: number,
  userId: number,
  updates: Partial<
    Pick<
      GoogleAdsAccount,
      | 'accountName'
      | 'currency'
      | 'timezone'
      | 'isActive'
      | 'accessToken'
      | 'refreshToken'
      | 'tokenExpiresAt'
      | 'lastSyncAt'
    >
  >
): Promise<GoogleAdsAccount | null> {
  const db = await getDatabase()

  // 验证权限
  const account = await findGoogleAdsAccountById(id, userId)
  if (!account) {
    return null
  }

  const fields: string[] = []
  const values: any[] = []

  if (updates.accountName !== undefined) {
    fields.push('account_name = ?')
    values.push(updates.accountName)
  }
  if (updates.currency !== undefined) {
    fields.push('currency = ?')
    values.push(updates.currency)
  }
  if (updates.timezone !== undefined) {
    fields.push('timezone = ?')
    values.push(updates.timezone)
  }
  if (updates.isActive !== undefined) {
    fields.push('is_active = ?')
    values.push(updates.isActive ? 1 : 0)
  }
  if (updates.accessToken !== undefined) {
    fields.push('access_token = ?')
    values.push(updates.accessToken)
  }
  if (updates.refreshToken !== undefined) {
    fields.push('refresh_token = ?')
    values.push(updates.refreshToken)
  }
  if (updates.tokenExpiresAt !== undefined) {
    fields.push('token_expires_at = ?')
    values.push(updates.tokenExpiresAt)
  }
  if (updates.lastSyncAt !== undefined) {
    fields.push('last_sync_at = ?')
    values.push(updates.lastSyncAt)
  }

  if (fields.length === 0) {
    return account
  }

  fields.push(`updated_at = ${nowFunc(db.type)}`)
  values.push(id, userId)

  await db.exec(`
    UPDATE google_ads_accounts
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `, values)

  return await findGoogleAdsAccountById(id, userId)
}

/**
 * 删除Google Ads账号（软删除）
 *
 * 🔧 修改历史：
 * - 2025-12-29: 改为软删除，防止campaigns关联断裂
 */
export async function deleteGoogleAdsAccount(id: number, userId: number): Promise<boolean> {
  const db = await getDatabase()

  // 🔧 使用事务确保原子性
  return await db.transaction(async () => {
    // 1. 先获取要删除的账号信息（获取 customer_id）
    const account = await db.queryOne(`
      SELECT customer_id FROM google_ads_accounts
      WHERE id = ? AND user_id = ?
    `, [id, userId]) as { customer_id: string } | undefined

    if (!account) {
      return false
    }

    const customerId = account.customer_id

    // 2. 🔧 级联删除：将该 customer_id 的所有广告系列标记为已删除
    const campaignResult = await db.exec(`
      UPDATE campaigns
      SET is_deleted = ..., deleted_at = ...
      WHERE google_ads_account_id = ? AND user_id = ?
    `, [id, userId])

    console.log(`[Delete Account] Soft deleted ${campaignResult.changes} campaigns for customer_id ${customerId}`)

    // 3. 🔧 标记该 customer_id 为已删除（通过设置 is_deleted 和 is_active=false）
    const accountResult = await db.exec(`
      UPDATE google_ads_accounts
      SET is_deleted = ...,
          is_active = ...,
          deleted_at = ...
      WHERE id = ? AND user_id = ?
    `, [id, userId])

    console.log(`[Delete Account] Marked customer_id ${customerId} as deleted`)

    return accountResult.changes > 0
  })
}

/**
 * 设置默认激活账号（将其他账号设为不激活）
 */
export async function setActiveGoogleAdsAccount(id: number, userId: number): Promise<boolean> {
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性：布尔字段和时间函数兼容性处理
  const isActiveTrue = db.type === 'postgres' ? true : 1
  const isActiveFalse = db.type === 'postgres' ? false : 0
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  // 将所有账号设为不激活
  await db.exec(`
    UPDATE google_ads_accounts
    SET is_active = ?
    WHERE user_id = ?
  `, [isActiveFalse, userId])

  // 将指定账号设为激活
  const result = await db.exec(`
    UPDATE google_ads_accounts
    SET is_active = ?, updated_at = ${nowFunc}
    WHERE id = ? AND user_id = ?
  `, [isActiveTrue, id, userId])

  return result.changes > 0
}

/**
 * 获取Google Ads账号的解密凭证
 * 用于API调用时获取认证信息
 */
export async function getDecryptedCredentials(
  accountId: number,
  userId: number
): Promise<{
  customerId: string
  accessToken: string | null
  refreshToken: string | null
  clientId?: string
  clientSecret?: string
} | null> {
  const account = await findGoogleAdsAccountById(accountId, userId)

  if (!account) {
    return null
  }

  // 返回凭证信息（在实际生产环境中，这里应该进行解密操作）
  return {
    customerId: account.customerId,
    accessToken: account.accessToken,
    refreshToken: account.refreshToken,
  }
}

/**
 * 数据库行映射为GoogleAdsAccount对象
 */
function mapRowToGoogleAdsAccount(row: any): GoogleAdsAccount {
  return {
    id: row.id,
    userId: row.user_id,
    customerId: row.customer_id,
    accountName: row.account_name,
    currency: row.currency,
    timezone: row.timezone,
    isManagerAccount: toBool(row.is_manager_account),
    isActive: toBool(row.is_active),
    status: row.status || null,
    testAccount: toBool(row.test_account),
    parentMccId: row.parent_mcc_id || null,
    identityVerificationProgramStatus: row.identity_verification_program_status ?? null,
    identityVerificationStartDeadlineTime: row.identity_verification_start_deadline_time ?? null,
    identityVerificationCompletionDeadlineTime: row.identity_verification_completion_deadline_time ?? null,
    identityVerificationOverdue: toBool(row.identity_verification_overdue),
    identityVerificationCheckedAt: row.identity_verification_checked_at ?? null,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    serviceAccountId: row.service_account_id || null,
  }
}
