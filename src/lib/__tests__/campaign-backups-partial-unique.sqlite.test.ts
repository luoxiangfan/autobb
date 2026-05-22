import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { splitSqlStatements } from '@/lib/sql-splitter'

const MIGRATION_SQL = readFileSync(
  path.join(process.cwd(), 'migrations/249_campaign_backups_partial_unique.sql'),
  'utf8'
)

function execMigrationStatements(db: Database.Database) {
  for (const stmt of splitSqlStatements(MIGRATION_SQL)) {
    db.exec(stmt)
  }
}

describe('campaign_backups partial unique index (sqlite)', () => {
  let dbPath = ''
  let db: Database.Database

  beforeEach(async () => {
    dbPath = path.join(
      os.tmpdir(),
      `autobb-cb-unique-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.db`
    )
    db = new Database(dbPath)
    db.exec(`
      CREATE TABLE campaign_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        offer_id INTEGER NOT NULL,
        campaign_data TEXT NOT NULL DEFAULT '{}',
        campaign_config TEXT,
        backup_type TEXT NOT NULL DEFAULT 'auto',
        backup_source TEXT NOT NULL DEFAULT 'autoads',
        backup_version INTEGER NOT NULL DEFAULT 1,
        custom_name TEXT,
        campaign_name TEXT NOT NULL DEFAULT 'C',
        budget_amount REAL NOT NULL DEFAULT 1,
        budget_type TEXT NOT NULL DEFAULT 'DAILY',
        target_cpa REAL,
        max_cpc REAL,
        status TEXT NOT NULL DEFAULT 'PAUSED',
        google_ads_account_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    execMigrationStatements(db)
  })

  afterEach(async () => {
    db.close()
    try {
      await fs.unlink(dbPath)
    } catch {
      // ignore
    }
  })

  it('rejects a second autoads row for the same user_id and offer_id', () => {
    db.prepare(
      `INSERT INTO campaign_backups (user_id, offer_id, campaign_data, backup_source)
       VALUES (1, 10, '{}', 'autoads')`
    ).run()

    expect(() =>
      db.prepare(
        `INSERT INTO campaign_backups (user_id, offer_id, campaign_data, backup_source)
         VALUES (1, 10, '{}', 'autoads')`
      ).run()
    ).toThrow(/UNIQUE constraint failed/i)
  })

  it('allows autoads and google_ads v2 on the same user_id and offer_id', () => {
    db.prepare(
      `INSERT INTO campaign_backups (user_id, offer_id, campaign_data, backup_source, backup_version)
       VALUES (1, 10, '{}', 'autoads', 1)`
    ).run()
    db.prepare(
      `INSERT INTO campaign_backups (user_id, offer_id, campaign_data, backup_source, backup_version)
       VALUES (1, 10, '{}', 'google_ads', 2)`
    ).run()

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM campaign_backups WHERE user_id = 1 AND offer_id = 10')
      .get() as { c: number }
    expect(count.c).toBe(2)
  })
})
