import { beforeEach, describe, expect, it, vi } from 'vitest'

type StubDb = {
  type: 'postgres'
  queryOne: ReturnType<typeof vi.fn>
  query: ReturnType<typeof vi.fn>
  exec: ReturnType<typeof vi.fn>
}

const stubDb: StubDb = {
  type: 'postgres',
  queryOne: vi.fn(),
  query: vi.fn(),
  exec: vi.fn(),
}

vi.mock('@/lib/db', () => ({
  getDatabase: async () => stubDb,
}))

import { createRiskAlert } from '@/lib/risk-alerts'
import { getRiskStatistics } from '@/lib/risk-alerts'
import { saveQueueConfig } from '@/lib/queue-config'

describe('PostgreSQL placeholder type inference guards', () => {
  beforeEach(() => {
    stubDb.queryOne.mockReset()
    stubDb.exec.mockReset()
  })

  it('createRiskAlert: resourceId=null should not generate "? IS NULL" placeholder-only check', async () => {
    let selectSql = ''
    let selectParams: any[] = []

    stubDb.queryOne.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT id FROM risk_alerts')) {
        selectSql = sql
        selectParams = params
        return undefined
      }
      if (sql.includes('INSERT INTO risk_alerts')) return { id: 123 }
      return undefined
    })

    const id = await createRiskAlert(
      1,
      'oauth_token_expired',
      'critical',
      'Google Ads授权已过期',
      'msg',
      { resourceId: undefined }
    )

    expect(id).toBe(123)
    expect(selectSql).toContain('resource_id IS NULL')
    expect(selectSql).not.toMatch(/\?\s+IS\s+NULL/i)
    expect(selectSql).toContain('created_at::timestamp')
    expect(selectParams).toEqual([1, 'oauth_token_expired'])
  })

  it('createRiskAlert: resourceId=number should use only one placeholder for resource_id', async () => {
    let selectSql = ''
    let selectParams: any[] = []

    stubDb.queryOne.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT id FROM risk_alerts')) {
        selectSql = sql
        selectParams = params
        return undefined
      }
      if (sql.includes('INSERT INTO risk_alerts')) return { id: 456 }
      return undefined
    })

    const id = await createRiskAlert(
      2,
      'link_check_failed',
      'warning',
      't',
      'm',
      { resourceId: 99 }
    )

    expect(id).toBe(456)
    expect(selectSql).toContain('resource_id = ?')
    expect(selectSql).not.toMatch(/\?\s+IS\s+NULL/i)
    expect(selectSql).toContain('created_at::timestamp')
    expect(selectParams).toEqual([2, 'link_check_failed', 99])
  })

  it('getRiskStatistics: postgres should cast created_at text to timestamp in cutoff filter', async () => {
    let statsSql = ''
    let statsParams: any[] = []

    stubDb.query.mockImplementation(async (sql: string, params: any[]) => {
      statsSql = sql
      statsParams = params
      return []
    })

    const stats = await getRiskStatistics(7)
    expect(stats).toEqual({
      total: 0,
      active: 0,
      critical: 0,
      warning: 0,
      info: 0,
      byType: {},
    })
    expect(statsSql).toContain('FROM risk_alerts')
    expect(statsSql).toContain('created_at::timestamp')
    expect(statsParams).toEqual([7])
  })

  it('saveQueueConfig: delete SQL should not use placeholder-only "? IS NULL" checks', async () => {
    const deleteSqls: string[] = []
    const deleteParamsList: any[][] = []

    stubDb.exec.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('DELETE FROM system_settings')) {
        deleteSqls.push(sql)
        deleteParamsList.push(params)
      }
      return { changes: 1 }
    })

    // global (user_id IS NULL)
    await saveQueueConfig({ perUserConcurrency: 2 }, undefined)
    expect(deleteSqls[0]).toContain('user_id IS NULL')
    expect(deleteSqls[0]).not.toMatch(/\?\s+IS\s+NULL/i)
    expect(deleteParamsList[0]).toEqual(['per_user_concurrency'])

    deleteSqls.length = 0
    deleteParamsList.length = 0

    // per-user (user_id = ?)
    await saveQueueConfig({ perUserConcurrency: 2 }, 7)
    expect(deleteSqls[0]).toContain('user_id = ?')
    expect(deleteSqls[0]).not.toMatch(/\?\s+IS\s+NULL/i)
    expect(deleteParamsList[0]).toEqual(['per_user_concurrency', 7])
  })
})
