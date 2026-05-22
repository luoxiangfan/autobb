import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
const mockExec = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    query: mockQuery,
    queryOne: mockQueryOne,
    exec: mockExec,
  })),
}))

import {
  buildCampaignBackupDataFromRow,
  getBackupRankOrderSql,
  isAutoadsLikeBackupSource,
  listCampaignBackups,
  parseCampaignBackup,
  pruneCampaignBackupsForOffer,
} from '@/lib/campaign-backups'

describe('campaign-backups helpers', () => {
  it('isAutoadsLikeBackupSource treats publish as autoads', () => {
    expect(isAutoadsLikeBackupSource('autoads')).toBe(true)
    expect(isAutoadsLikeBackupSource('publish')).toBe(true)
    expect(isAutoadsLikeBackupSource('google_ads')).toBe(false)
  })

  it('buildCampaignBackupDataFromRow omits campaigns table metadata', () => {
    const data = buildCampaignBackupDataFromRow({
      campaign_id: 'g-1',
      offer_id: 9,
      google_ads_account_id: 3,
      campaign_name: 'Test',
      budget_amount: 10,
      budget_type: 'DAILY',
      max_cpc: 1.2,
      target_cpa: null,
      status: 'PAUSED',
    })
    expect(data).toEqual({
      campaign_id: 'g-1',
      offer_id: 9,
      google_ads_account_id: 3,
      campaign_name: 'Test',
      budget_amount: 10,
      budget_type: 'DAILY',
      max_cpc: 1.2,
      target_cpa: null,
      status: 'PAUSED',
    })
    expect(data).not.toHaveProperty('id')
    expect(data).not.toHaveProperty('user_id')
  })

  it('getBackupRankOrderSql prefers config, version, and updated_at', () => {
    const sqlite = getBackupRankOrderSql('sqlite', 'cb')
    expect(sqlite).toContain('cb.backup_version DESC')
    expect(sqlite).toContain('cb.campaign_config IS NOT NULL')
    expect(sqlite).toContain('cb.updated_at DESC')

    const pg = getBackupRankOrderSql('postgres')
    expect(pg).toContain('campaign_config::text')
    expect(pg).not.toContain('TRIM(')
  })

  it('parseCampaignBackup maps snake_case and parses JSON fields', () => {
    const backup = parseCampaignBackup({
      id: 1,
      user_id: 7,
      offer_id: 9,
      campaign_data: '{"offer_id":9}',
      campaign_config: '{"x":1}',
      backup_type: 'auto',
      backup_source: 'autoads',
      backup_version: 1,
      custom_name: null,
      campaign_name: 'C',
      budget_amount: 5,
      budget_type: 'DAILY',
      target_cpa: null,
      max_cpc: null,
      status: 'PAUSED',
      google_ads_account_id: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
      ad_creative_id: 11,
    })
    expect(backup.userId).toBe(7)
    expect(backup.campaignData).toEqual({ offer_id: 9 })
    expect(backup.campaignConfig).toEqual({ x: 1 })
    expect(backup.adCreativeId).toBe(11)
  })
})

describe('pruneCampaignBackupsForOffer', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockQueryOne.mockReset()
    mockExec.mockReset()
  })

  it('returns 0 when no backups exist', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined)
    await expect(pruneCampaignBackupsForOffer(9, 7)).resolves.toBe(0)
    expect(mockExec).not.toHaveBeenCalled()
  })

  it('keeps canonical and at most one google_ads v2+, deletes others and normalizes publish', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 100 })
      .mockResolvedValueOnce({ id: 200 })
    mockExec
      .mockResolvedValueOnce({ changes: 3 })
      .mockResolvedValueOnce({ changes: 1 })

    const deleted = await pruneCampaignBackupsForOffer(9, 7)
    expect(deleted).toBe(3)

    const googleFinalSql = String(mockQueryOne.mock.calls[1]?.[0] || '')
    expect(googleFinalSql).toContain("backup_version >= 2")
    expect(googleFinalSql).toContain('LIMIT 1')

    const deleteSql = String(mockExec.mock.calls[0]?.[0] || '')
    expect(deleteSql).toContain('id NOT IN')
    expect(mockExec.mock.calls[0]?.[1]).toEqual([9, 7, 100, 200])

    const publishSql = String(mockExec.mock.calls[1]?.[0] || '')
    expect(publishSql).toContain("backup_source = 'publish'")
    expect(publishSql).toContain("backup_source = 'autoads'")
  })
})

describe('listCampaignBackups', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockQueryOne.mockReset()
  })

  it('applies date range and backupSource filters with offer join', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: 1 })
    mockQuery.mockResolvedValueOnce([
      {
        id: 1,
        user_id: 7,
        offer_id: 9,
        ad_creative_id: null,
        campaign_data: '{}',
        campaign_config: null,
        backup_type: 'auto',
        backup_source: 'autoads',
        backup_version: 1,
        custom_name: null,
        campaign_name: 'C',
        budget_amount: 1,
        budget_type: 'DAILY',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        offer_name: 'Offer A',
        brand: 'Brand',
        active_campaign_id: 501,
      },
    ])

    const result = await listCampaignBackups({
      userId: 7,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      backupSource: 'google_ads',
      limit: 50,
      offset: 10,
      withOfferInfo: true,
    })

    expect(result.total).toBe(1)
    expect(result.limit).toBe(50)
    expect(result.offset).toBe(10)
    expect(result.backups[0]?.offer_name).toBe('Offer A')
    expect(result.backups[0]?.has_active_campaign).toBe(true)
    expect(result.backups[0]?.active_campaign_id).toBe(501)

    const countSql = String(mockQueryOne.mock.calls[0]?.[0] || '')
    expect(countSql).toContain('campaign_backups cb LEFT JOIN offers o')
    const listSql = String(mockQuery.mock.calls[0]?.[0] || '')
    expect(listSql).toContain('active_campaign_id')
    expect(countSql).toContain('cb.created_at >=')
    expect(countSql).toContain('cb.backup_source = ?')
    expect(mockQueryOne.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([7, '2026-01-01 00:00:00.000', '2026-01-31 23:59:59.999', 'google_ads'])
    )
  })
})
