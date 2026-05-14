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
    delete process.env.SQLITE_TX_WAIT_TIMEOUT_MS
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

  it('does not allow concurrent writes to leak into active transaction', async () => {
    const db = getDatabase()
    await db.exec('CREATE TABLE tx_case (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)')

    let releaseTxWait: (() => void) | null = null
    const txWait = new Promise<void>((resolve) => {
      releaseTxWait = resolve
    })

    let reachedTxWaitResolve: (() => void) | null = null
    const reachedTxWait = new Promise<void>((resolve) => {
      reachedTxWaitResolve = resolve
    })

    const txPromise = db.transaction(async () => {
      await db.exec('INSERT INTO tx_case (value) VALUES (?)', ['tx-1'])
      reachedTxWaitResolve?.()
      await txWait

      const rowInTx = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM tx_case')
      expect(rowInTx?.count).toBe(1)

      await db.exec('INSERT INTO tx_case (value) VALUES (?)', ['tx-2'])
    })

    await reachedTxWait

    let outsiderResolved = false
    const outsiderPromise = db.exec('INSERT INTO tx_case (value) VALUES (?)', ['outside']).then(() => {
      outsiderResolved = true
    })

    await Promise.resolve()
    expect(outsiderResolved).toBe(false)

    releaseTxWait?.()
    await Promise.all([txPromise, outsiderPromise])

    const row = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM tx_case')
    expect(row?.count).toBe(3)
  })

  it('fails fast when waiting for transaction lock exceeds timeout', async () => {
    closeDatabase()
    process.env.SQLITE_TX_WAIT_TIMEOUT_MS = '30'
    const db = getDatabase()
    await db.exec('CREATE TABLE tx_case (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)')

    let releaseTxWait: (() => void) | null = null
    const txWait = new Promise<void>((resolve) => {
      releaseTxWait = resolve
    })

    let reachedTxWaitResolve: (() => void) | null = null
    const reachedTxWait = new Promise<void>((resolve) => {
      reachedTxWaitResolve = resolve
    })

    const txPromise = db.transaction(async () => {
      await db.exec('INSERT INTO tx_case (value) VALUES (?)', ['tx-1'])
      reachedTxWaitResolve?.()
      await txWait
    })

    await reachedTxWait

    await expect(
      db.exec('INSERT INTO tx_case (value) VALUES (?)', ['outside-timeout'])
    ).rejects.toThrow(/wait timeout/i)

    releaseTxWait?.()
    await txPromise
  })
})
