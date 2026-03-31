#!/usr/bin/env tsx
import process from 'process'
import { getDatabase } from '@/lib/db'
import { redactOpenclawActionLogText } from '@/lib/openclaw/action-logs'

type ActionLogRow = {
  id: number
  request_body: string | null
  response_body: string | null
  error_message: string | null
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const userIdArg = getArg('--user-id')
  const limit = parsePositiveInt(getArg('--limit'), 2000)
  const batchSize = Math.min(parsePositiveInt(getArg('--batch-size'), 200), 1000)

  const userId = userIdArg ? Number(userIdArg) : null
  if (userIdArg && !Number.isFinite(userId)) {
    throw new Error('--user-id must be a number')
  }

  const db = await getDatabase()
  let scanned = 0
  let updated = 0
  let changedRows = 0
  const changedIds: number[] = []
  let lastId = 0

  while (scanned < limit) {
    const remaining = limit - scanned
    const pageSize = Math.min(batchSize, remaining)

    const whereUserSql = userId ? 'AND user_id = ?' : ''
    const rows = await db.query<ActionLogRow>(
      `SELECT id, request_body, response_body, error_message
       FROM openclaw_action_logs
       WHERE id > ? ${whereUserSql}
       ORDER BY id ASC
       LIMIT ?`,
      userId ? [lastId, userId, pageSize] : [lastId, pageSize]
    )

    if (rows.length === 0) break

    for (const row of rows) {
      scanned += 1
      lastId = Math.max(lastId, Number(row.id || 0))

      const requestBody = redactOpenclawActionLogText(row.request_body)
      const responseBody = redactOpenclawActionLogText(row.response_body)
      const errorMessage = redactOpenclawActionLogText(row.error_message)

      const changed = requestBody !== row.request_body
        || responseBody !== row.response_body
        || errorMessage !== row.error_message

      if (!changed) continue

      changedRows += 1
      if (changedIds.length < 30) {
        changedIds.push(Number(row.id))
      }

      if (!dryRun) {
        await db.exec(
          `UPDATE openclaw_action_logs
           SET request_body = ?,
               response_body = ?,
               error_message = ?
           WHERE id = ?`,
          [requestBody, responseBody, errorMessage, row.id]
        )
        updated += 1
      }
    }
  }

  const mode = dryRun ? 'DRY_RUN' : 'APPLY'
  console.log(`[openclaw-redact-action-logs] mode=${mode}`)
  console.log(`[openclaw-redact-action-logs] scanned=${scanned}, changed=${changedRows}, updated=${updated}`)
  if (changedIds.length > 0) {
    console.log(`[openclaw-redact-action-logs] sampleChangedIds=${changedIds.join(',')}`)
  }
}

main().catch((error) => {
  console.error('[openclaw-redact-action-logs] failed:', error)
  process.exit(1)
})
