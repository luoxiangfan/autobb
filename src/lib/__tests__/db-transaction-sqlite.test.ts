import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

import { closeDatabase, getDatabase } from '@/lib/db'

describe('SQLite async transaction semantics', () => {
  let dbPath = ''

  beforeEach(async () => {
    closeDatabase()
    dbPath = path.join(
      os.tmpdir(),
      `autobb-sqlite-tx-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.db`
    )
    process.env.DATABASE_PATH = dbPath
    delete process.env.DATABASE_URL
  })

  afterEach(async () => {
    closeDatabase()
    try {
      await fs.unlink(dbPath)
    } catch {
      // ignore cleanup errors
    }
  })

  it('commits writes across async awaits', async () => {
    const db = getDatabase()
    await db.exec('CREATE TABLE tx_case (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)')

    await db.transaction(async () => {
      await db.exec('INSERT INTO tx_case (value) VALUES (?)', ['a'])
      await Promise.resolve()
      await db.exec('INSERT INTO tx_case (value) VALUES (?)', ['b'])
    })

    const row = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM tx_case')
    expect(row?.count).toBe(2)
  })

  it('rolls back writes when async callback throws', async () => {
    const db = getDatabase()
    await db.exec('CREATE TABLE tx_case (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)')

    await expect(
      db.transaction(async () => {
        await db.exec('INSERT INTO tx_case (value) VALUES (?)', ['should_rollback'])
        await Promise.resolve()
        throw new Error('force rollback')
      })
    ).rejects.toThrow('force rollback')

    const row = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM tx_case')
    expect(row?.count).toBe(0)
  })
})
