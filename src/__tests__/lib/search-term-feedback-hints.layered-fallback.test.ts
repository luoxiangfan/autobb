import { config } from 'dotenv'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getSearchTermFeedbackHints } from '@/lib/keywords/server'
import { getDatabase } from '@/lib/db'

config({ path: '.env.local' })

describe('getSearchTermFeedbackHints - Layered Fallback', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>
  let userId: number
  let user2Id: number
  let offer1Id: number
  let offer2Id: number
  let offer3Id: number
  let offer4Id: number
  let googleAdsAccountId: number
  let googleAdsAccount2Id: number
  let recentDate: string
  let oldDate: string

  async function insertCampaign(params: {
    ownerUserId: number
    offerId: number
    googleAdsAccountId: number
    campaignName?: string
  }): Promise<number> {
    const result = await db.query(
      `INSERT INTO campaigns (user_id, offer_id, google_ads_account_id, campaign_name, budget_amount, status)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        params.ownerUserId,
        params.offerId,
        params.googleAdsAccountId,
        params.campaignName ?? 'Test Campaign',
        100,
        'ENABLED',
      ]
    )
    return result[0].id
  }

  beforeEach(async () => {
    db = await getDatabase()
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    oldDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    // 创建测试用户
    const userResult = await db.query(
      'INSERT INTO users (email, username) VALUES (?, ?) RETURNING id',
      [`test-${uniqueSuffix}@example.com`, `testuser-${uniqueSuffix}`]
    )
    userId = userResult[0].id

    const account1Result = await db.query(
      `INSERT INTO google_ads_accounts (user_id, customer_id, account_name)
       VALUES (?, ?, ?) RETURNING id`,
      [userId, `cust-${uniqueSuffix}-1`, 'Test Account 1']
    )
    googleAdsAccountId = account1Result[0].id

    // 创建测试 Offer 1 (SolarBrand 花园灯)
    const offer1Result = await db.query(
      `INSERT INTO offers (user_id, url, brand, product_name, target_country, target_language)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [userId, 'https://example.com/1', 'SolarBrand', 'Garden Lights', 'US', 'en']
    )
    offer1Id = offer1Result[0].id

    // 创建测试 Offer 2 (SolarBrand 路灯 - 同用户同品牌)
    const offer2Result = await db.query(
      `INSERT INTO offers (user_id, url, brand, product_name, target_country, target_language)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [userId, 'https://example.com/2', 'SolarBrand', 'Street Lights', 'US', 'en']
    )
    offer2Id = offer2Result[0].id

    // 创建另一个用户的 Offer (SolarBrand - 全局品牌级别)
    const user2Result = await db.query(
      'INSERT INTO users (email, username) VALUES (?, ?) RETURNING id',
      [`test2-${uniqueSuffix}@example.com`, `testuser2-${uniqueSuffix}`]
    )
    user2Id = user2Result[0].id

    const account2Result = await db.query(
      `INSERT INTO google_ads_accounts (user_id, customer_id, account_name)
       VALUES (?, ?, ?) RETURNING id`,
      [user2Id, `cust-${uniqueSuffix}-2`, 'Test Account 2']
    )
    googleAdsAccount2Id = account2Result[0].id

    const offer3Result = await db.query(
      `INSERT INTO offers (user_id, url, brand, product_name, target_country, target_language)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [user2Id, 'https://example.com/3', 'SolarBrand', 'Garden Lights', 'US', 'en']
    )
    offer3Id = offer3Result[0].id

    const offer4Result = await db.query(
      `INSERT INTO offers (user_id, url, brand, product_name, target_country, target_language)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [user2Id, 'https://example.com/4', 'SolarBrand', 'Garden Lights', 'US', 'zh']
    )
    offer4Id = offer4Result[0].id
  })

  afterEach(async () => {
    // 清理测试数据
    await db.exec('DELETE FROM search_term_reports WHERE user_id = ?', [userId])
    await db.exec('DELETE FROM search_term_reports WHERE user_id = ?', [user2Id])
    await db.exec('DELETE FROM campaigns WHERE user_id = ?', [userId])
    await db.exec('DELETE FROM campaigns WHERE user_id = ?', [user2Id])
    await db.exec('DELETE FROM google_ads_accounts WHERE user_id = ?', [userId])
    await db.exec('DELETE FROM google_ads_accounts WHERE user_id = ?', [user2Id])
    await db.exec('DELETE FROM offers WHERE user_id = ?', [userId])
    await db.exec('DELETE FROM offers WHERE user_id = ?', [user2Id])
  })

  it('should use offer-level data when available', async () => {
    const campaignId = await insertCampaign({
      ownerUserId: userId,
      offerId: offer1Id,
      googleAdsAccountId,
    })

    // 添加 Offer 级别高性能搜索词
    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, campaignId, 'solarbrand best garden lights', 'BROAD', 1000, 50, 5, 25, recentDate]
    )

    const result = await getSearchTermFeedbackHints({
      offerId: offer1Id,
      userId,
    })

    expect(result.highPerformingTerms).toContain('solarbrand best garden lights')
    expect(result.highPerformingTerms.length).toBeGreaterThan(0)
  })

  it('should fallback to user-brand-level when offer-level data is insufficient', async () => {
    // Offer 1: 没有数据
    // Offer 2: 有高性能搜索词

    const campaign2Id = await insertCampaign({
      ownerUserId: userId,
      offerId: offer2Id,
      googleAdsAccountId: googleAdsAccountId,
      campaignName: 'Test Campaign 2',
    })

    // 添加 Offer 2 的高性能搜索词
    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, campaign2Id, 'solarbrand street lights', 'BROAD', 1000, 50, 5, 25, recentDate]
    )

    // 查询 Offer 1（应该回退到 Offer 2 的数据）
    const result = await getSearchTermFeedbackHints({
      offerId: offer1Id,
      userId,
    })

    expect(result.highPerformingTerms).toContain('solarbrand street lights')
  })

  it('should fallback to global-brand-level when user data is insufficient', async () => {
    // Offer 1 和 Offer 2: 没有数据
    // Offer 3 (其他用户): 有高性能搜索词

    // 获取 user2Id
    const campaign3Id = await insertCampaign({
      ownerUserId: user2Id,
      offerId: offer3Id,
      googleAdsAccountId: googleAdsAccount2Id,
      campaignName: 'Test Campaign 3',
    })

    // 添加 Offer 3 的高性能搜索词
    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user2Id, campaign3Id, 'solarbrand outdoor lights', 'BROAD', 1000, 50, 5, 25, recentDate]
    )

    // 查询 Offer 1（应该回退到全局品牌级别）
    const result = await getSearchTermFeedbackHints({
      offerId: offer1Id,
      userId,
    })

    expect(result.highPerformingTerms).toContain('solarbrand outdoor lights')
  })

  it('should deduplicate terms across fallback levels', async () => {
    // Offer 1: 有 "solar lights"
    // Offer 2: 也有 "solar lights"（应该去重）

    const campaign1Id = await insertCampaign({
      ownerUserId: userId,
      offerId: offer1Id,
      googleAdsAccountId,
      campaignName: 'Test Campaign 1',
    })

    const campaign2Id = await insertCampaign({
      ownerUserId: userId,
      offerId: offer2Id,
      googleAdsAccountId,
      campaignName: 'Test Campaign 2',
    })

    // Offer 1 和 Offer 2 都有相同的搜索词
    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, campaign1Id, 'solarbrand lights outdoor', 'BROAD', 1000, 50, 5, 25, recentDate]
    )

    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, campaign2Id, 'solarbrand lights outdoor', 'BROAD', 1000, 50, 5, 25, recentDate]
    )

    const result = await getSearchTermFeedbackHints({
      offerId: offer1Id,
      userId,
    })

    // 应该只出现一次
    const count = result.highPerformingTerms.filter((t) => t === 'solarbrand lights outdoor').length
    expect(count).toBe(1)
  })

  it('should include global brand terms even when offer-level already has enough terms', async () => {
    const campaign1Id = await insertCampaign({
      ownerUserId: userId,
      offerId: offer1Id,
      googleAdsAccountId: googleAdsAccountId,
      campaignName: 'Offer1 Campaign',
    })

    const campaign2Id = await insertCampaign({
      ownerUserId: userId,
      offerId: offer2Id,
      googleAdsAccountId: googleAdsAccountId,
      campaignName: 'Offer2 Campaign',
    })

    const campaign3Id = await insertCampaign({
      ownerUserId: user2Id,
      offerId: offer3Id,
      googleAdsAccountId: googleAdsAccount2Id,
      campaignName: 'Offer3 Campaign',
    })

    const offerTerms = [
      'solarbrand garden lights',
      'solarbrand outdoor lights',
      'solarbrand patio lights',
      'solarbrand yard lights',
      'solarbrand pathway lights',
      'solarbrand deck lights',
    ]

    for (const term of offerTerms) {
      await db.exec(
        `INSERT INTO search_term_reports
         (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, campaign1Id, term, 'BROAD', 1000, 50, 5, 25, recentDate]
      )
    }

    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, campaign2Id, 'solarbrand amazon', 'BROAD', 1000, 50, 5, 25, recentDate]
    )
    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user2Id, campaign3Id, 'solarbrand amazon', 'BROAD', 1000, 50, 5, 25, recentDate]
    )

    const result = await getSearchTermFeedbackHints({
      offerId: offer1Id,
      userId,
    })

    expect(result.highPerformingTerms).toContain('solarbrand amazon')
    expect(result.highPerformingTerms.length).toBeGreaterThanOrEqual(7)
  })

  it('should prioritize global brand terms before offer/user brand layers', async () => {
    const campaign1Id = await insertCampaign({
      ownerUserId: userId,
      offerId: offer1Id,
      googleAdsAccountId: googleAdsAccountId,
      campaignName: 'Offer1 Priority Campaign',
    })

    const campaign2Id = await insertCampaign({
      ownerUserId: userId,
      offerId: offer2Id,
      googleAdsAccountId: googleAdsAccountId,
      campaignName: 'Offer2 Priority Campaign',
    })

    const campaign3Id = await insertCampaign({
      ownerUserId: user2Id,
      offerId: offer3Id,
      googleAdsAccountId: googleAdsAccount2Id,
      campaignName: 'Offer3 Priority Campaign',
    })

    // Offer层专属词
    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, campaign1Id, 'solarbrand offer layer phrase', 'BROAD', 1200, 60, 6, 30, recentDate]
    )

    // 用户品牌层专属词（同用户其它Offer）
    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, campaign2Id, 'solarbrand user brand phrase', 'BROAD', 1100, 55, 5, 28, recentDate]
    )

    // 全局层词（跨用户出现）
    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        campaign1Id,
        'solarbrand global priority phrase',
        'BROAD',
        1300,
        65,
        6,
        32,
        recentDate,
      ]
    )
    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user2Id,
        campaign3Id,
        'solarbrand global priority phrase',
        'BROAD',
        1250,
        62,
        6,
        31,
        recentDate,
      ]
    )

    const result = await getSearchTermFeedbackHints({
      offerId: offer1Id,
      userId,
    })

    const globalIndex = result.highPerformingTerms.indexOf('solarbrand global priority phrase')
    const offerIndex = result.highPerformingTerms.indexOf('solarbrand offer layer phrase')
    const userIndex = result.highPerformingTerms.indexOf('solarbrand user brand phrase')

    expect(globalIndex).toBeGreaterThanOrEqual(0)
    expect(offerIndex).toBeGreaterThanOrEqual(0)
    expect(userIndex).toBeGreaterThanOrEqual(0)
    expect(globalIndex).toBeLessThan(offerIndex)
    expect(globalIndex).toBeLessThan(userIndex)
  })

  it('should keep only brand-related high-performing terms', async () => {
    const campaignId = await insertCampaign({
      ownerUserId: userId,
      offerId: offer1Id,
      googleAdsAccountId: googleAdsAccountId,
      campaignName: 'Brand Relevance Campaign',
    })

    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, campaignId, 'solarbrand best garden lights', 'BROAD', 1000, 50, 5, 25, recentDate]
    )
    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, campaignId, 'best garden pathway lights', 'BROAD', 1000, 50, 5, 25, recentDate]
    )

    const result = await getSearchTermFeedbackHints({
      offerId: offer1Id,
      userId,
    })

    expect(result.highPerformingTerms).toContain('solarbrand best garden lights')
    expect(result.highPerformingTerms).not.toContain('best garden pathway lights')
  })

  it('should include historical high-performing terms without lookback window filtering', async () => {
    const campaignId = await insertCampaign({
      ownerUserId: userId,
      offerId: offer1Id,
      googleAdsAccountId: googleAdsAccountId,
      campaignName: 'Historical Campaign',
    })

    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, campaignId, 'solarbrand historical lights', 'BROAD', 1200, 40, 4, 30, oldDate]
    )

    const result = await getSearchTermFeedbackHints({
      offerId: offer1Id,
      userId,
    })

    expect(result.highPerformingTerms).toContain('solarbrand historical lights')
  })

  it('should keep brand product-family aliases as brand-related terms', async () => {
    const offerResult = await db.query(
      `INSERT INTO offers (user_id, url, brand, product_name, target_country, target_language)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [userId, 'https://example.com/our-place', 'Our Place', 'Always Pan 2.0', 'US', 'en']
    )
    const ourPlaceOfferId = offerResult[0].id

    const campaignId = await insertCampaign({
      ownerUserId: userId,
      offerId: ourPlaceOfferId,
      googleAdsAccountId: googleAdsAccountId,
      campaignName: 'Our Place Campaign',
    })

    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, campaignId, 'always pan 2.0', 'BROAD', 1000, 50, 5, 25, recentDate]
    )

    const result = await getSearchTermFeedbackHints({
      offerId: ourPlaceOfferId,
      userId,
    })

    expect(result.highPerformingTerms).toContain('always pan 2.0')
  })

  it('should not mix global brand terms across different target language', async () => {
    const zhCampaignId = await insertCampaign({
      ownerUserId: user2Id,
      offerId: offer4Id,
      googleAdsAccountId: googleAdsAccount2Id,
      campaignName: 'ZH Campaign',
    })

    await db.exec(
      `INSERT INTO search_term_reports
       (user_id, campaign_id, search_term, match_type, impressions, clicks, conversions, cost, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user2Id, zhCampaignId, 'solarbrand 中文 高转化词', 'BROAD', 1000, 50, 5, 25, recentDate]
    )

    const result = await getSearchTermFeedbackHints({
      offerId: offer1Id,
      userId,
    })

    expect(result.highPerformingTerms).not.toContain('solarbrand 中文 高转化词')
  })
})
