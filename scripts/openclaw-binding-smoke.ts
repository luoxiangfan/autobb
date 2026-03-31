#!/usr/bin/env tsx
import process from 'process'
import postgres from 'postgres'

process.env.NODE_ENV = process.env.NODE_ENV || 'test'

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function usage() {
  console.log(`Usage:
  npm run openclaw:binding:smoke -- --channel feishu --sender <open_id> [--account user-1] [--tenant <tenant_key>] [--db <DATABASE_URL>] [--show-bindings]\n`)
}

async function maybeShowBindings(databaseUrl: string, sender: string, tenantKey?: string) {
  const sql = postgres(databaseUrl, {
    ssl: { rejectUnauthorized: false },
    max: 1,
  })

  try {
    const rows = await sql<{
      id: number
      user_id: number
      channel: string
      tenant_key: string | null
      open_id: string | null
      union_id: string | null
      status: string
      updated_at: string | null
    }[]>`
      SELECT id, user_id, channel, tenant_key, open_id, union_id, status, updated_at
      FROM openclaw_user_bindings
      WHERE channel = 'feishu'
        AND (open_id = ${sender} OR union_id = ${sender})
        ${tenantKey ? sql`AND tenant_key = ${tenantKey}` : sql``}
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 20
    `

    console.log('\n[openclaw_user_bindings matches]')
    if (rows.length === 0) {
      console.log('(none)')
      return
    }

    for (const row of rows) {
      console.log(JSON.stringify(row))
    }
  } finally {
    await sql.end({ timeout: 2 })
  }
}

async function main() {
  const channel = getArg('--channel')
  const sender = getArg('--sender')
  const accountId = getArg('--account')
  const tenantKey = getArg('--tenant')
  const databaseUrl = getArg('--db') || process.env.DATABASE_URL
  const showBindings = process.argv.includes('--show-bindings')

  if (!channel || !sender) {
    usage()
    process.exit(1)
  }

  if (!databaseUrl) {
    console.error('Missing DATABASE_URL. Provide --db or set env DATABASE_URL.')
    process.exit(1)
  }

  process.env.DATABASE_URL = databaseUrl

  const { resolveOpenclawUserFromBindingDebug } = await import('@/lib/openclaw/bindings')

  const result = await resolveOpenclawUserFromBindingDebug(channel, sender, {
    accountId,
    tenantKey,
  })

  console.log('[binding resolution]')
  console.log(JSON.stringify(result, null, 2))

  if (showBindings && channel.toLowerCase() === 'feishu') {
    await maybeShowBindings(databaseUrl, sender, tenantKey)
  }

  if (!result.userId) {
    process.exitCode = 2
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
