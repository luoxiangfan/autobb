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
  createCampaignBackup,
  getBackupRankOrderSql,
  isAutoadsLikeBackupSource,
  isCampaignBackupOfferUniqueViolation,
  listCampaignBackups,
  mergeCampaignConfigForBackupSync,
  parseCampaignBackup,
  pruneCampaignBackupsForOffer,
  resolveBackupScalarFieldsForSync,
  syncCampaignBackupAfterPublish,
  trySyncCampaignBackupAfterPublish,
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

describe('resolveBackupScalarFieldsForSync', () => {
  it('prefers merged campaign_config over campaigns row', () => {
    const scalars = resolveBackupScalarFieldsForSync(
      { budget_amount: 10, budget_type: 'DAILY', max_cpc: 1, target_cpa: null },
      { budgetAmount: 99, budgetType: 'TOTAL', maxCpcBid: 3.5, targetCpa: 12 }
    )
    expect(scalars).toEqual({
      budgetAmount: 99,
      budgetType: 'TOTAL',
      maxCpc: 3.5,
      targetCpa: 12,
    })
  })
})

describe('createCampaignBackup', () => {
  beforeEach(() => {
    mockQueryOne.mockReset()
    mockExec.mockReset()
  })

  it('isCampaignBackupOfferUniqueViolation detects sqlite and postgres errors', () => {
    expect(
      isCampaignBackupOfferUniqueViolation(
        new Error('UNIQUE constraint failed: campaign_backups.user_id, campaign_backups.offer_id')
      )
    ).toBe(true)
    expect(
      isCampaignBackupOfferUniqueViolation({
        code: '23505',
        message: 'duplicate key value violates unique constraint "idx_campaign_backups_user_offer_unique"',
      })
    ).toBe(true)
    expect(isCampaignBackupOfferUniqueViolation(new Error('other'))).toBe(false)
  })

  it('updates existing row when backup already exists for offer', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 42 })
      .mockResolvedValueOnce({
        id: 42,
        user_id: 7,
        offer_id: 9,
        campaign_data: '{}',
        campaign_config: null,
        backup_type: 'auto',
        backup_source: 'autoads',
        backup_version: 1,
        custom_name: null,
        campaign_name: 'Existing',
        budget_amount: 30,
        budget_type: 'DAILY',
        target_cpa: null,
        max_cpc: 2,
        status: 'PAUSED',
        google_ads_account_id: 3,
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
        ad_creative_id: null,
      })

    mockExec.mockResolvedValue({ changes: 1 })

    const backup = await createCampaignBackup({
      userId: 7,
      offerId: 9,
      campaignData: { offer_id: 9 },
      campaignName: 'Updated',
      budgetAmount: 30,
      budgetType: 'DAILY',
      status: 'PAUSED',
    })

    expect(backup.id).toBe(42)
    expect(String(mockExec.mock.calls[0]?.[0] || '')).toContain('UPDATE campaign_backups')
    expect(
      mockExec.mock.calls.every((call) => !String(call[0]).includes('INSERT INTO campaign_backups'))
    ).toBe(true)
  })

  it('falls back to update when concurrent INSERT hits unique constraint', async () => {
    mockQueryOne
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 99 })
      .mockResolvedValueOnce({
        id: 99,
        user_id: 7,
        offer_id: 9,
        campaign_data: '{}',
        campaign_config: null,
        backup_type: 'auto',
        backup_source: 'google_ads',
        backup_version: 1,
        custom_name: null,
        campaign_name: 'Raced',
        budget_amount: 30,
        budget_type: 'DAILY',
        target_cpa: null,
        max_cpc: 2,
        status: 'PAUSED',
        google_ads_account_id: 3,
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
        ad_creative_id: null,
      })

    mockExec
      .mockRejectedValueOnce(
        new Error('UNIQUE constraint failed: campaign_backups.user_id, campaign_backups.offer_id')
      )
      .mockResolvedValueOnce({ changes: 1 })

    const backup = await createCampaignBackup({
      userId: 7,
      offerId: 9,
      campaignData: { offer_id: 9 },
      campaignName: 'Raced',
      budgetAmount: 30,
      budgetType: 'DAILY',
      status: 'PAUSED',
      backupSource: 'google_ads',
    })

    expect(backup.id).toBe(99)
    expect(mockExec).toHaveBeenCalledTimes(2)
    expect(String(mockExec.mock.calls[1]?.[0] || '')).toContain('UPDATE campaign_backups')
  })
})

describe('mergeCampaignConfigForBackupSync', () => {
  it('overlays task campaignConfig, creative, and naming onto DB config', () => {
    const merged = mergeCampaignConfigForBackupSync(
      { keywords: ['old'], campaignName: 'Stale' },
      {
        campaignName: 'Authoritative',
        campaignConfig: { keywords: ['new'], maxCpcBid: 2 },
        creative: {
          headlines: ['H1'],
          descriptions: ['D1'],
          finalUrl: 'https://example.com',
        },
        adGroupName: 'AG-1',
      }
    )

    expect(merged).toEqual({
      keywords: ['new'],
      campaignName: 'Authoritative',
      maxCpcBid: 2,
      headlines: ['H1'],
      descriptions: ['D1'],
      finalUrl: 'https://example.com',
      adGroupName: 'AG-1',
    })
  })
})

describe('syncCampaignBackupAfterPublish', () => {
  beforeEach(() => {
    mockQueryOne.mockReset()
    mockExec.mockReset()
  })

  it('updates backup snapshot from published campaign row', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 50,
        user_id: 7,
        offer_id: 9,
        campaign_id: 'google-camp-1',
        google_ads_account_id: 3,
        campaign_name: 'Published',
        budget_amount: 20,
        budget_type: 'DAILY',
        max_cpc: 1.5,
        target_cpa: null,
        status: 'PAUSED',
        custom_name: null,
        ad_creative_id: 11,
        campaign_config: { keywords: ['a'] },
      })
      .mockResolvedValueOnce({ id: 100, offer_id: 9 })
      .mockResolvedValueOnce({ id: 100 })

    mockExec.mockResolvedValue({ changes: 0 })

    await syncCampaignBackupAfterPublish({
      backupId: 100,
      userId: 7,
      campaignId: 50,
    })

    const updateSql = String(mockExec.mock.calls[0]?.[0] || '')
    expect(updateSql).toContain('backup_source = ?')
    expect(updateSql).toContain('backup_version = ?')
    expect(mockExec.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(['autoads', 1, 100, 7])
    )
  })

  it('prefers publishedSnapshot over stale campaigns.campaign_config', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 50,
        user_id: 7,
        offer_id: 9,
        campaign_id: 'local-id',
        google_campaign_id: null,
        google_ads_account_id: 3,
        campaign_name: 'Stale Name',
        budget_amount: 20,
        budget_type: 'DAILY',
        max_cpc: 1.5,
        target_cpa: null,
        status: 'PAUSED',
        custom_name: null,
        ad_creative_id: 11,
        campaign_config: { keywords: ['old'], headlines: ['old-h'] },
      })
      .mockResolvedValueOnce({ id: 100, offer_id: 9 })
      .mockResolvedValueOnce({ id: 100 })

    mockExec.mockResolvedValue({ changes: 0 })

    await syncCampaignBackupAfterPublish({
      backupId: 100,
      userId: 7,
      campaignId: 50,
      publishedSnapshot: {
        campaignName: 'Remote Name',
        googleCampaignId: 'google-999',
        campaignConfig: { keywords: ['published'], budgetAmount: 99, maxCpcBid: 3.5 },
        creative: { headlines: ['new-h'], descriptions: ['new-d'] },
      },
    })

    const configDb = mockExec.mock.calls[0]?.[1]?.[2]
    const config =
      typeof configDb === 'string' ? JSON.parse(configDb) : (configDb as Record<string, unknown>)
    expect(config.keywords).toEqual(['published'])
    expect(config.headlines).toEqual(['new-h'])
    expect(config.campaignName).toBe('Remote Name')

    const dataDb = mockExec.mock.calls[0]?.[1]?.[1]
    const data =
      typeof dataDb === 'string' ? JSON.parse(dataDb) : (dataDb as Record<string, unknown>)
    expect(data.campaign_id).toBe('google-999')
    expect(data.campaign_name).toBe('Remote Name')

    expect(mockExec.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(['Remote Name', 99, 'DAILY', 3.5, 100, 7])
    )
  })
})

describe('trySyncCampaignBackupAfterPublish', () => {
  beforeEach(() => {
    mockQueryOne.mockReset()
    mockExec.mockReset()
  })

  it('uses explicit sourceBackupId when provided', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 50,
        user_id: 7,
        offer_id: 9,
        campaign_id: 'google-camp-1',
        google_ads_account_id: 3,
        campaign_name: 'Published',
        budget_amount: 20,
        budget_type: 'DAILY',
        max_cpc: 1.5,
        target_cpa: null,
        status: 'PAUSED',
        custom_name: null,
        ad_creative_id: 11,
        campaign_config: { keywords: ['a'] },
      })
      .mockResolvedValueOnce({ id: 100, offer_id: 9 })
      .mockResolvedValueOnce({ id: 100 })

    mockExec.mockResolvedValue({ changes: 0 })

    await trySyncCampaignBackupAfterPublish({
      userId: 7,
      campaignId: 50,
      offerId: 9,
      sourceBackupId: 100,
    })

    expect(mockExec).toHaveBeenCalled()
  })

  it('resolves backup by offer when sourceBackupId is omitted', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 200 })
      .mockResolvedValueOnce({
        id: 50,
        user_id: 7,
        offer_id: 9,
        campaign_id: 'google-camp-1',
        google_ads_account_id: 3,
        campaign_name: 'Published',
        budget_amount: 20,
        budget_type: 'DAILY',
        max_cpc: 1.5,
        target_cpa: null,
        status: 'PAUSED',
        custom_name: null,
        ad_creative_id: 11,
        campaign_config: {},
      })
      .mockResolvedValueOnce({ id: 200, offer_id: 9 })
      .mockResolvedValueOnce({ id: 200 })

    mockExec.mockResolvedValue({ changes: 0 })

    await trySyncCampaignBackupAfterPublish({
      userId: 7,
      campaignId: 50,
      offerId: 9,
    })

    const findSql = String(mockQueryOne.mock.calls[0]?.[0] || '')
    expect(findSql).toContain('campaign_backups')
    expect(mockExec).toHaveBeenCalled()
  })

  it('no-ops when no backup exists for offer', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined)

    await trySyncCampaignBackupAfterPublish({
      userId: 7,
      campaignId: 50,
      offerId: 9,
    })

    expect(mockExec).not.toHaveBeenCalled()
  })
})

describe('pruneCampaignBackupsForOffer', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockQueryOne.mockReset()
    mockExec.mockReset()
  })

  it('returns 0 when no backups exist', async () => {
    mockQueryOne.mockResolvedValue(undefined)
    await expect(pruneCampaignBackupsForOffer(9, 7)).resolves.toBe(0)
    expect(mockExec).not.toHaveBeenCalled()
  })

  it('keeps only the top-ranked backup for user+offer', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 100 })
    mockExec
      .mockResolvedValueOnce({ changes: 2 })
      .mockResolvedValueOnce({ changes: 0 })

    const deleted = await pruneCampaignBackupsForOffer(9, 7)
    expect(deleted).toBe(2)

    const keepSql = String(mockQueryOne.mock.calls[0]?.[0] || '')
    expect(keepSql).toContain('ORDER BY')
    expect(keepSql).not.toContain("backup_source = 'autoads'")

    expect(mockExec.mock.calls[0]?.[1]).toEqual([9, 7, 100])
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
