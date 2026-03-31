import { getDatabase } from './db'
import { getInsertedId, nowFunc } from './db-helpers'

export interface AdGroup {
  id: number
  userId: number
  campaignId: number
  adGroupId: string | null
  adGroupName: string
  status: string
  cpcBidMicros: number | null
  creationStatus: string
  creationError: string | null
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateAdGroupInput {
  userId: number
  campaignId: number
  adGroupName: string
  status?: string
  cpcBidMicros?: number
}

/**
 * 创建Ad Group
 */
export async function createAdGroup(input: CreateAdGroupInput): Promise<AdGroup> {
  const db = await getDatabase()

  const result = await db.exec(`
    INSERT INTO ad_groups (
      user_id, campaign_id, ad_group_name,
      status, cpc_bid_micros
    ) VALUES (?, ?, ?, ?, ?)
  `, [
    input.userId,
    input.campaignId,
    input.adGroupName,
    input.status || 'PAUSED',
    input.cpcBidMicros || null
  ])

  const insertedId = getInsertedId(result, db.type)
  return (await findAdGroupById(insertedId, input.userId))!
}

/**
 * 查找Ad Group（带权限验证）
 */
export async function findAdGroupById(id: number, userId: number): Promise<AdGroup | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM ad_groups
    WHERE id = ? AND user_id = ?
  `, [id, userId])

  if (!row) {
    return null
  }

  return mapRowToAdGroup(row)
}

/**
 * 根据Google Ads ad_group_id查找
 */
export async function findAdGroupByGoogleId(adGroupId: string, userId: number): Promise<AdGroup | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM ad_groups
    WHERE ad_group_id = ? AND user_id = ?
  `, [adGroupId, userId])

  if (!row) {
    return null
  }

  return mapRowToAdGroup(row)
}

/**
 * 查找Campaign的所有Ad Groups
 */
export async function findAdGroupsByCampaignId(campaignId: number, userId: number): Promise<AdGroup[]> {
  const db = await getDatabase()

  const rows = await db.query(`
    SELECT * FROM ad_groups
    WHERE campaign_id = ? AND user_id = ?
    ORDER BY created_at DESC
  `, [campaignId, userId])

  return rows.map(mapRowToAdGroup)
}

/**
 * 查找用户的所有Ad Groups
 */
export async function findAdGroupsByUserId(userId: number, limit?: number): Promise<AdGroup[]> {
  const db = await getDatabase()
  let sql = `
    SELECT * FROM ad_groups
    WHERE user_id = ?
    ORDER BY created_at DESC
  `

  if (limit) {
    sql += ` LIMIT ${limit}`
  }

  const rows = await db.query(sql, [userId])
  return rows.map(mapRowToAdGroup)
}

/**
 * 更新Ad Group
 */
export async function updateAdGroup(
  id: number,
  userId: number,
  updates: Partial<
    Pick<
      AdGroup,
      | 'adGroupName'
      | 'status'
      | 'cpcBidMicros'
      | 'adGroupId'
      | 'creationStatus'
      | 'creationError'
      | 'lastSyncAt'
    >
  >
): Promise<AdGroup | null> {
  const db = await getDatabase()

  // 验证权限
  const adGroup = await findAdGroupById(id, userId)
  if (!adGroup) {
    return null
  }

  const fields: string[] = []
  const values: any[] = []

  if (updates.adGroupName !== undefined) {
    fields.push('ad_group_name = ?')
    values.push(updates.adGroupName)
  }
  if (updates.status !== undefined) {
    fields.push('status = ?')
    values.push(updates.status)
  }
  if (updates.cpcBidMicros !== undefined) {
    fields.push('cpc_bid_micros = ?')
    values.push(updates.cpcBidMicros)
  }
  if (updates.adGroupId !== undefined) {
    fields.push('ad_group_id = ?')
    values.push(updates.adGroupId)
  }
  if (updates.creationStatus !== undefined) {
    fields.push('creation_status = ?')
    values.push(updates.creationStatus)
  }
  if (updates.creationError !== undefined) {
    fields.push('creation_error = ?')
    values.push(updates.creationError)
  }
  if (updates.lastSyncAt !== undefined) {
    fields.push('last_sync_at = ?')
    values.push(updates.lastSyncAt)
  }

  if (fields.length === 0) {
    return adGroup
  }

  fields.push(`updated_at = ${nowFunc(db.type)}`)
  values.push(id, userId)

  await db.exec(`
    UPDATE ad_groups
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `, values)

  return await findAdGroupById(id, userId)
}

/**
 * 删除Ad Group
 */
export async function deleteAdGroup(id: number, userId: number): Promise<boolean> {
  const db = await getDatabase()

  const result = await db.exec(`
    DELETE FROM ad_groups
    WHERE id = ? AND user_id = ?
  `, [id, userId])

  return result.changes > 0
}

/**
 * 更新Ad Group状态
 */
export async function updateAdGroupStatus(id: number, userId: number, status: string): Promise<AdGroup | null> {
  return await updateAdGroup(id, userId, { status })
}

/**
 * 批量创建Ad Groups
 */
export async function createAdGroupsBatch(adGroups: CreateAdGroupInput[]): Promise<AdGroup[]> {
  const results: AdGroup[] = []

  for (const group of adGroups) {
    const adGroup = await createAdGroup(group)
    results.push(adGroup)
  }

  return results
}

/**
 * 数据库行映射为AdGroup对象
 */
function mapRowToAdGroup(row: any): AdGroup {
  return {
    id: row.id,
    userId: row.user_id,
    campaignId: row.campaign_id,
    adGroupId: row.ad_group_id,
    adGroupName: row.ad_group_name,
    status: row.status,
    cpcBidMicros: row.cpc_bid_micros,
    creationStatus: row.creation_status,
    creationError: row.creation_error,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
