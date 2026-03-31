import { getDatabase } from './db'
import { getInsertedId } from './db-helpers'

export interface Keyword {
  id: number
  userId: number
  adGroupId: number
  keywordId: string | null
  keywordText: string
  matchType: string
  status: string
  cpcBidMicros: number | null
  finalUrl: string | null
  isNegative: boolean
  qualityScore: number | null
  aiGenerated: boolean
  generationSource: string | null
  creationStatus: string
  creationError: string | null
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateKeywordInput {
  userId: number
  adGroupId: number
  keywordText: string
  matchType?: string
  status?: string
  cpcBidMicros?: number
  finalUrl?: string
  isNegative?: boolean
  aiGenerated?: boolean
  generationSource?: string
}

/**
 * 创建Keyword
 */
export async function createKeyword(input: CreateKeywordInput): Promise<Keyword> {
  const db = await getDatabase()

  const result = await db.exec(
    `
    INSERT INTO keywords (
      user_id, ad_group_id, keyword_text,
      match_type, status, cpc_bid_micros,
      final_url, is_negative, ai_generated,
      generation_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      input.userId,
      input.adGroupId,
      input.keywordText,
      input.matchType || 'PHRASE',
      input.status || 'PAUSED',
      input.cpcBidMicros || null,
      input.finalUrl || null,
      input.isNegative ? 1 : 0,
      input.aiGenerated ? 1 : 0,
      input.generationSource || null,
    ]
  )

  const insertedId = getInsertedId(result, db.type)
  return (await findKeywordById(insertedId, input.userId))!
}

/**
 * 查找Keyword（带权限验证）
 */
export async function findKeywordById(id: number, userId: number): Promise<Keyword | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM keywords
    WHERE id = ? AND user_id = ?
  `, [id, userId])

  if (!row) {
    return null
  }

  return mapRowToKeyword(row)
}

/**
 * 根据Google Ads keyword_id查找
 */
export async function findKeywordByGoogleId(keywordId: string, userId: number): Promise<Keyword | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM keywords
    WHERE keyword_id = ? AND user_id = ?
  `, [keywordId, userId])

  if (!row) {
    return null
  }

  return mapRowToKeyword(row)
}

/**
 * 查找Ad Group的所有Keywords
 */
export async function findKeywordsByAdGroupId(adGroupId: number, userId: number): Promise<Keyword[]> {
  const db = await getDatabase()

  const rows = await db.query(`
    SELECT * FROM keywords
    WHERE ad_group_id = ? AND user_id = ?
    ORDER BY created_at DESC
  `, [adGroupId, userId])

  return rows.map(mapRowToKeyword)
}

/**
 * 查找用户的所有Keywords
 */
export async function findKeywordsByUserId(userId: number, limit?: number): Promise<Keyword[]> {
  const db = await getDatabase()
  let sql = `
    SELECT * FROM keywords
    WHERE user_id = ?
    ORDER BY created_at DESC
  `

  if (limit) {
    sql += ` LIMIT ${limit}`
  }

  const rows = await db.query(sql, [userId])
  return rows.map(mapRowToKeyword)
}

/**
 * 查找AI生成的Keywords
 */
export async function findAIGeneratedKeywords(adGroupId: number, userId: number): Promise<Keyword[]> {
  const db = await getDatabase()

  const rows = await db.query(`
    SELECT * FROM keywords
    WHERE ad_group_id = ? AND user_id = ? AND ai_generated = 1
    ORDER BY created_at DESC
  `, [adGroupId, userId])

  return rows.map(mapRowToKeyword)
}

/**
 * 更新Keyword
 */
export async function updateKeyword(
  id: number,
  userId: number,
  updates: Partial<
    Pick<
      Keyword,
      | 'keywordText'
      | 'matchType'
      | 'status'
      | 'cpcBidMicros'
      | 'finalUrl'
      | 'isNegative'
      | 'qualityScore'
      | 'keywordId'
      | 'creationStatus'
      | 'creationError'
      | 'lastSyncAt'
    >
  >
): Promise<Keyword | null> {
  const db = await getDatabase()

  // 验证权限
  const keyword = await findKeywordById(id, userId)
  if (!keyword) {
    return null
  }

  const fields: string[] = []
  const values: any[] = []

  if (updates.keywordText !== undefined) {
    fields.push('keyword_text = ?')
    values.push(updates.keywordText)
  }
  if (updates.matchType !== undefined) {
    fields.push('match_type = ?')
    values.push(updates.matchType)
  }
  if (updates.status !== undefined) {
    fields.push('status = ?')
    values.push(updates.status)
  }
  if (updates.cpcBidMicros !== undefined) {
    fields.push('cpc_bid_micros = ?')
    values.push(updates.cpcBidMicros)
  }
  if (updates.finalUrl !== undefined) {
    fields.push('final_url = ?')
    values.push(updates.finalUrl)
  }
  if (updates.isNegative !== undefined) {
    fields.push('is_negative = ?')
    values.push(updates.isNegative ? 1 : 0)
  }
  if (updates.qualityScore !== undefined) {
    fields.push('quality_score = ?')
    values.push(updates.qualityScore)
  }
  if (updates.keywordId !== undefined) {
    fields.push('keyword_id = ?')
    values.push(updates.keywordId)
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
    return keyword
  }

  fields.push('updated_at = datetime("now")')
  values.push(id, userId)

  await db.exec(`
    UPDATE keywords
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `, values)

  return await findKeywordById(id, userId)
}

/**
 * 删除Keyword
 */
export async function deleteKeyword(id: number, userId: number): Promise<boolean> {
  const db = await getDatabase()

  const result = await db.exec(`
    DELETE FROM keywords
    WHERE id = ? AND user_id = ?
  `, [id, userId])

  return result.changes > 0
}

/**
 * 批量创建Keywords
 */
export async function createKeywordsBatch(keywords: CreateKeywordInput[]): Promise<Keyword[]> {
  const results: Keyword[] = []

  for (const kw of keywords) {
    const keyword = await createKeyword(kw)
    results.push(keyword)
  }

  return results
}

/**
 * 批量更新Keywords状态
 */
export async function updateKeywordsStatus(
  keywordIds: number[],
  userId: number,
  status: string
): Promise<number> {
  let updateCount = 0

  for (const id of keywordIds) {
    const result = await updateKeyword(id, userId, { status })
    if (result) {
      updateCount++
    }
  }

  return updateCount
}

/**
 * 删除Ad Group的所有Keywords
 */
export async function deleteKeywordsByAdGroupId(adGroupId: number, userId: number): Promise<number> {
  const db = await getDatabase()

  const result = await db.exec(`
    DELETE FROM keywords
    WHERE ad_group_id = ? AND user_id = ?
  `, [adGroupId, userId])

  return result.changes
}

/**
 * 数据库行映射为Keyword对象
 */
function mapRowToKeyword(row: any): Keyword {
  return {
    id: row.id,
    userId: row.user_id,
    adGroupId: row.ad_group_id,
    keywordId: row.keyword_id,
    keywordText: row.keyword_text,
    matchType: row.match_type,
    status: row.status,
    cpcBidMicros: row.cpc_bid_micros,
    finalUrl: row.final_url,
    isNegative: row.is_negative === 1,
    qualityScore: row.quality_score,
    aiGenerated: row.ai_generated === 1,
    generationSource: row.generation_source,
    creationStatus: row.creation_status,
    creationError: row.creation_error,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
