import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zErr } from '@/lib/zod-errors'
import { getDatabase } from '@/lib/db'
import { isUniqueConstraintViolation } from '@/lib/db-helpers'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'

const createBindingSchema = z.object({
  channel: z.string().min(1, zErr.required),
  openId: z.string().min(1, zErr.required),
  unionId: z.string().optional(),
  tenantKey: z.string().optional() })

export async function GET(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const db = await getDatabase()
  const bindings = await db.query<any>(
    `SELECT id, channel, tenant_key, open_id, union_id, status, created_at, updated_at
     FROM openclaw_user_bindings
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [auth.user.userId]
  )

  return NextResponse.json({ success: true, bindings })
}

export async function POST(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => null)
  const parsed = createBindingSchema.safeParse(body || {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid request' },
      { status: 400 }
    )
  }

  const db = await getDatabase()
  const nowSql = 'NOW()'
  const channel = parsed.data.channel.trim()
  const openId = parsed.data.openId.trim()
  const unionId = (parsed.data.unionId || '').trim() || null
  const tenantKey = (parsed.data.tenantKey || '').trim() || null

  const updateSql = tenantKey
    ? `UPDATE openclaw_user_bindings
       SET user_id = ?,
           tenant_key = ?,
           union_id = ?,
           status = 'active',
           updated_at = ${nowSql}
       WHERE channel = ?
         AND tenant_key = ?
         AND open_id = ?`
    : `UPDATE openclaw_user_bindings
       SET user_id = ?,
           tenant_key = NULL,
           union_id = ?,
           status = 'active',
           updated_at = ${nowSql}
       WHERE channel = ?
         AND tenant_key IS NULL
         AND open_id = ?`

  const updateParams = tenantKey
    ? [auth.user.userId, tenantKey, unionId, channel, tenantKey, openId]
    : [auth.user.userId, unionId, channel, openId]

  const updated = await db.exec(updateSql, updateParams)
  if (updated.changes === 0) {
    try {
      await db.exec(
        `INSERT INTO openclaw_user_bindings (user_id, channel, tenant_key, open_id, union_id, status)
         VALUES (?, ?, ?, ?, ?, 'active')`,
        [auth.user.userId, channel, tenantKey, openId, unionId]
      )
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error
      }
      await db.exec(updateSql, updateParams)
    }
  }

  return NextResponse.json({ success: true })
}
