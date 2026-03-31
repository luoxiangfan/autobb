import { describe, expect, it } from 'vitest'

import { splitSqlStatements } from '@/lib/sql-splitter'

describe('splitSqlStatements', () => {
  it('splits basic statements', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1;', 'SELECT 2;'])
  })

  it('does not split on semicolons in single-quoted strings', () => {
    const sql = "INSERT INTO t(v) VALUES ('a;b'); SELECT 1;"
    expect(splitSqlStatements(sql)).toEqual(["INSERT INTO t(v) VALUES ('a;b');", 'SELECT 1;'])
  })

  it('keeps SQLite triggers as a single statement', () => {
    const sql = `
      CREATE TRIGGER t AFTER UPDATE ON x
      BEGIN
        UPDATE x SET a = 1;
        UPDATE x SET a = 2;
      END;
      SELECT 1;
    `
    const statements = splitSqlStatements(sql)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toMatch(/CREATE TRIGGER/i)
    expect(statements[0]).toMatch(/\bEND;\s*$/i)
    expect(statements[1]).toBe('SELECT 1;')
  })

  it('keeps dollar-quoted blocks as a single statement', () => {
    const sql = `
      DO $$ BEGIN
        PERFORM 1;
      END $$;
      SELECT 1;
    `
    const statements = splitSqlStatements(sql)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toMatch(/^DO \$\$/m)
    expect(statements[1]).toBe('SELECT 1;')
  })
})
