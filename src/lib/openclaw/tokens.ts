import { getDatabase } from '@/lib/db'
import { encrypt, generateRandomKey } from '@/lib/crypto'
import { hashOpenclawToken } from '@/lib/openclaw/auth'
import { getInsertedId } from '@/lib/db-helpers'
import { toDbJsonArrayField } from '@/lib/json-field'

export type OpenclawTokenRecord = {
  id: number
  user_id: number
  name: string | null
  scopes: unknown
  status: string
  last_used_at: string | null
  created_at: string
  revoked_at: string | null
}

export async function createOpenclawToken(params: {
  userId: number
  name?: string
  scopes?: string[] | null
}): Promise<{ token: string; record: OpenclawTokenRecord }> {
  const db = await getDatabase()
  const token = `oc_${generateRandomKey(24)}`
  const tokenHash = hashOpenclawToken(token)
  const encrypted = encrypt(token)
  const scopesValue = toDbJsonArrayField(params.scopes ?? [], db.type, [])

  const result = await db.exec(
    `INSERT INTO openclaw_tokens (user_id, name, token_hash, token_encrypted, scopes, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    [params.userId, params.name || null, tokenHash, encrypted, scopesValue]
  )

  const insertedId = getInsertedId(result, db.type)
  const record = await db.queryOne<OpenclawTokenRecord>(
    'SELECT id, user_id, name, scopes, status, last_used_at, created_at, revoked_at FROM openclaw_tokens WHERE id = ?',
    [insertedId]
  )

  if (!record) {
    throw new Error('Failed to create OpenClaw token')
  }

  return { token, record }
}

export async function listOpenclawTokens(userId: number): Promise<OpenclawTokenRecord[]> {
  const db = await getDatabase()
  return await db.query<OpenclawTokenRecord>(
    `SELECT id, user_id, name, scopes, status, last_used_at, created_at, revoked_at
     FROM openclaw_tokens
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId]
  )
}

export async function revokeOpenclawToken(userId: number, tokenId: number): Promise<boolean> {
  const db = await getDatabase()
  const result = await db.exec(
    `UPDATE openclaw_tokens
     SET status = 'revoked', revoked_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
    [tokenId, userId]
  )
  return result.changes > 0
}

export async function verifyOpenclawUserToken(token: string): Promise<OpenclawTokenRecord | null> {
  const db = await getDatabase()
  const tokenHash = hashOpenclawToken(token)
  const record = await db.queryOne<OpenclawTokenRecord>(
    `SELECT id, user_id, name, scopes, status, last_used_at, created_at, revoked_at
     FROM openclaw_tokens
     WHERE token_hash = ? AND status = 'active'`,
    [tokenHash]
  )

  if (!record) {
    return null
  }

  await db.exec(
    `UPDATE openclaw_tokens SET last_used_at = datetime('now') WHERE id = ?`,
    [record.id]
  )

  return record
}
