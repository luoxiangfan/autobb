import { describe, expect, it } from 'vitest'
import { prepareExecInsertSql } from '@/lib/db/database'

describe('prepareExecInsertSql', () => {
  it('appends RETURNING id for standard tables', () => {
    const sql = 'INSERT INTO offers (user_id, url) VALUES (?, ?)'
    expect(prepareExecInsertSql(sql)).toBe(
      'INSERT INTO offers (user_id, url) VALUES (?, ?) RETURNING id'
    )
  })

  it('does not append RETURNING id for tables without id column', () => {
    const sql = `
      INSERT INTO openclaw_affiliate_commission_report_cache
        (cache_key, line_items_json, line_items_codec, source_updated_at, built_at)
      VALUES (?, ?, ?, ?, NOW())
      ON CONFLICT(cache_key) DO UPDATE SET
        line_items_json = excluded.line_items_json
    `

    expect(prepareExecInsertSql(sql)).not.toContain('RETURNING id')
  })

  it('preserves explicit RETURNING clauses', () => {
    const sql = 'INSERT INTO strategy_center_actions (run_id) VALUES (?) RETURNING id'
    expect(prepareExecInsertSql(sql)).toBe(sql)
  })
})
