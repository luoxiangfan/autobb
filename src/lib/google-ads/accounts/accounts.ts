import { getDatabase } from '../../db'
import { markUrlSwapTargetsRemovedByOfferAccount } from '../../url-swap'
import { pauseOfferTasks } from '../../campaign/server'
import { hasActiveCampaignForOffer } from '../../campaign/server'
import { applyCampaignTransitionByIds } from '../../campaign/server'
import { getInsertedId } from '../../db'
import { googleAdsAccountsLogger } from '../common/logger'

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
 * 创建 Google Ads 账号
 */
export async function createGoogleAdsAccount(
  input: CreateGoogleAdsAccountInput
): Promise<GoogleAdsAccount> {
  const db = await getDatabase()

  const result = await db.exec(
    `
    INSERT INTO google_ads_accounts (
      user_id, customer_id, account_name,
      currency, timezone, is_manager_account,
      access_token, refresh_token, token_expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      input.userId,
      input.customerId,
      input.accountName || null,
      input.currency || 'USD',
      input.timezone || 'America/New_York',
      input.isManagerAccount ? 1 : 0,
      input.accessToken || null,
      input.refreshToken || null,
      input.tokenExpiresAt || null,
    ]
  )

  const insertedId = getInsertedId(result)
  return (await findGoogleAdsAccountById(insertedId, input.userId))!
}

/**
 * 查找 Google Ads 账号（带权限验证）
 */
export async function findGoogleAdsAccountById(
  id: number,
  userId: number
): Promise<GoogleAdsAccount | null> {
  const db = await getDatabase()

  const row = (await db.queryOne(
    `
    SELECT * FROM google_ads_accounts
    WHERE id = ? AND user_id = ? AND is_deleted = false
  `,
    [id, userId]
  )) as any

  if (!row) {
    return null
  }

  return mapRowToGoogleAdsAccount(row)
}

/**
 * 查找用户的所有 Google Ads 账号
 */
export async function findGoogleAdsAccountsByUserId(userId: number): Promise<GoogleAdsAccount[]> {
  const db = await getDatabase()

  const rows = (await db.query(
    `
    SELECT * FROM google_ads_accounts
    WHERE user_id = ? AND is_deleted = false
    ORDER BY created_at DESC
  `,
    [userId]
  )) as any[]

  return rows.map(mapRowToGoogleAdsAccount)
}

/**
 * 查找用户的激活账号（包括所有状态）
 * 注意：这会返回所有 is_active=true 的账号，包括 DISABLED 状态的
 * 如果需要可用于 API 调用的账号，请使用 findEnabledGoogleAdsAccounts
 */
export async function findActiveGoogleAdsAccounts(
  userId: number,
  manager?: boolean
): Promise<GoogleAdsAccount[]> {
  const db = await getDatabase()

  let sqlStr = `
    SELECT * FROM google_ads_accounts
    WHERE user_id = ? AND is_active = true AND is_deleted = false
    ORDER BY created_at DESC
  `
  if (manager) {
    sqlStr = `
      SELECT * FROM google_ads_accounts
      WHERE user_id = ? AND is_active = true AND is_deleted = false AND is_manager_account = true AND parent_mcc_id IS NOT NULL AND parent_mcc_id != ''
      ORDER BY created_at DESC
    `
  }

  const rows = (await db.query(sqlStr, [userId])) as any[]

  return rows.map(mapRowToGoogleAdsAccount)
}

/**
 * 查找用户可用于 API 调用的账号（ENABLED 状态，非 Manager 账号）
 */
export async function findEnabledGoogleAdsAccounts(userId: number): Promise<GoogleAdsAccount[]> {
  const db = await getDatabase()

  const rows = (await db.query(
    `
    SELECT * FROM google_ads_accounts
    WHERE user_id = ?
      AND is_active = true
      AND status = 'ENABLED'
      AND is_manager_account = false
      AND (identity_verification_overdue IS NULL OR identity_verification_overdue = false)
      AND is_deleted = false
    ORDER BY created_at DESC
  `,
    [userId]
  )) as any[]

  return rows.map(mapRowToGoogleAdsAccount)
}

/**
 * 查找用户 MCC 下的 Google Ads 账号（非 Manager 账号）
 * 只返回 parent_mcc_id 在用户分配的 MCC 列表中的账号
 *
 * 修复 : 移除 user_id 限制
 * 原因：Google Ads 账号可能是管理员同步的，user_id 字段可能是管理员 ID
 * 正确逻辑：只要 parent_mcc_id 在用户分配的 MCC 列表中，就应该返回
 */
export async function findGoogleAdsAccountsByUserMcc(
  userId: number,
  manager?: boolean
): Promise<GoogleAdsAccount[]> {
  const db = await getDatabase()

  // 基础查询：只返回用户 MCC 下的账号
  let sqlStr = `
    SELECT gaa.* FROM google_ads_accounts gaa
    WHERE gaa.user_id = ? 
      AND is_active = true 
      AND is_deleted = false
      AND gaa.parent_mcc_id IN (
        SELECT mcc_customer_id FROM user_mcc_assignments WHERE user_id = ?
      )
  `

  const params: any[] = [userId, userId]

  // 如果指定 manager=true，则只返回 Manager 账号
  if (manager) {
    sqlStr += ` AND is_manager_account = false`
  }

  sqlStr += ` ORDER BY gaa.created_at DESC`

  const rows = (await db.query(sqlStr, params)) as any[]

  return rows.map(mapRowToGoogleAdsAccount)
}

/**
 * 更新 Google Ads 账号
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

  fields.push(`updated_at = NOW()`)
  values.push(id, userId)

  await db.exec(
    `
    UPDATE google_ads_accounts
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `,
    values
  )

  return await findGoogleAdsAccountById(id, userId)
}

/**
 * 删除 Google Ads 账号（软删除）
 *
 * 修改历史
 * 改为软删除，防止 campaigns 关联断裂
 */
export async function deleteGoogleAdsAccount(id: number, userId: number): Promise<boolean> {
  const db = await getDatabase()

  const account = (await db.queryOne(
    `
    SELECT customer_id FROM google_ads_accounts
    WHERE id = ? AND user_id = ?
  `,
    [id, userId]
  )) as { customer_id: string } | undefined

  if (!account) {
    return false
  }

  const customerId = account.customer_id

  const linkedCampaigns = await db.query<{ id: number; offer_id: number }>(
    `
    SELECT id, offer_id
    FROM campaigns
    WHERE google_ads_account_id = ?
      AND user_id = ?
      AND (is_deleted = false OR is_deleted IS NULL)
  `,
    [id, userId]
  )

  const campaignIds = linkedCampaigns
    .map((row) => Number(row.id))
    .filter((campaignId) => Number.isFinite(campaignId) && campaignId > 0)
  const offerIds = Array.from(
    new Set(
      linkedCampaigns
        .map((row) => Number(row.offer_id))
        .filter((offerId) => Number.isFinite(offerId) && offerId > 0)
    )
  )

  const deleted = await db.transaction(async () => {
    if (campaignIds.length > 0) {
      const transitionResult = await applyCampaignTransitionByIds({
        userId,
        campaignIds,
        action: 'OFFER_DELETE',
        payload: { removedReason: 'account_delete' },
      })
      googleAdsAccountsLogger.info('delete_account_campaigns_removed', {
        customerId,
        updatedCount: transitionResult.updatedCount,
      })
    }

    const accountResult = await db.exec(
      `
      UPDATE google_ads_accounts
      SET is_deleted = true,
          is_active = false,
          deleted_at = NOW()
      WHERE id = ? AND user_id = ?
    `,
      [id, userId]
    )

    return accountResult.changes > 0
  })

  if (!deleted) {
    return false
  }

  googleAdsAccountsLogger.info('delete_account_marked_deleted', { customerId })

  // 事务提交后再处理任务，避免长事务与嵌套事务
  let pausedClickFarmCount = 0
  let disabledUrlSwapCount = 0
  let removedUrlSwapTargetCount = 0

  for (const offerId of offerIds) {
    try {
      const removedTargets = await markUrlSwapTargetsRemovedByOfferAccount(offerId, id)
      removedUrlSwapTargetCount += removedTargets
      if (removedTargets > 0) {
        googleAdsAccountsLogger.info('delete_account_url_swap_targets_removed', {
          offerId,
          accountId: id,
          removedTargets,
        })
      }
    } catch (error) {
      googleAdsAccountsLogger.error(
        'delete_account_url_swap_targets_failed',
        { offerId, accountId: id },
        error
      )
    }

    try {
      if (await hasActiveCampaignForOffer(offerId, userId)) {
        continue
      }

      const pauseResult = await pauseOfferTasks(
        offerId,
        userId,
        'account_deleted',
        '关联 Google Ads 账号已删除，自动暂停任务'
      )
      pausedClickFarmCount += pauseResult.clickFarmTaskCount
      disabledUrlSwapCount += pauseResult.urlSwapTaskCount
      if (pauseResult.clickFarmTaskCount > 0 || pauseResult.urlSwapTaskCount > 0) {
        googleAdsAccountsLogger.info('delete_account_offer_tasks_paused', {
          offerId,
          clickFarmTaskCount: pauseResult.clickFarmTaskCount,
          urlSwapTaskCount: pauseResult.urlSwapTaskCount,
        })
      }
    } catch (error) {
      googleAdsAccountsLogger.error('delete_account_pause_tasks_failed', { offerId }, error)
    }
  }

  if (removedUrlSwapTargetCount > 0 || pausedClickFarmCount > 0 || disabledUrlSwapCount > 0) {
    googleAdsAccountsLogger.info('delete_account_task_cleanup_summary', {
      customerId,
      removedUrlSwapTargetCount,
      pausedClickFarmCount,
      disabledUrlSwapCount,
    })
  }

  return true
}

/**
 * 数据库行映射为 GoogleAdsAccount 对象
 */
function mapRowToGoogleAdsAccount(row: any): GoogleAdsAccount {
  return {
    id: row.id,
    userId: row.user_id,
    customerId: row.customer_id,
    accountName: row.account_name,
    currency: row.currency,
    timezone: row.timezone,
    isManagerAccount: row.is_manager_account === true,
    isActive: row.is_active === true,
    status: row.status || null,
    testAccount: row.test_account === true,
    parentMccId: row.parent_mcc_id || null,
    identityVerificationProgramStatus: row.identity_verification_program_status ?? null,
    identityVerificationStartDeadlineTime: row.identity_verification_start_deadline_time ?? null,
    identityVerificationCompletionDeadlineTime:
      row.identity_verification_completion_deadline_time ?? null,
    identityVerificationOverdue: row.identity_verification_overdue === true,
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
