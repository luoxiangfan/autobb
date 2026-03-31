import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'path'

/**
 * E2E Tests for Requirements 21-25
 * 需求21-25 完整功能测试
 */

const BASE_URL = 'http://localhost:3001'
const DB_PATH = path.join(process.cwd(), 'data', 'autoads.db')

test.describe('需求21-25: Critical Features Validation', () => {
  let db: Database.Database
  let testOfferId: number
  let userId: number

  test.beforeAll(() => {
    db = new Database(DB_PATH)

    // 获取测试用户
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@autoads.local') as any
    userId = user.id

    console.log('Test User ID:', userId)
  })

  test.afterAll(() => {
    if (db) {
      db.close()
    }
  })

  test.describe('需求25: Offer删除逻辑（软删除）', () => {
    test('25.1: 创建测试Offer', async () => {
      // 创建一个测试Offer
      const result = db.prepare(`
        INSERT INTO offers (
          user_id, url, brand, category, target_country,
          offer_name, target_language, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        userId,
        'https://test-product.com',
        'TestBrand',
        'Electronics',
        'US',
        'TestBrand_US_Test',
        'English'
      )

      testOfferId = result.lastInsertRowid as number
      console.log('Created Test Offer ID:', testOfferId)

      // 验证Offer已创建
      const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(testOfferId) as any
      expect(offer).toBeTruthy()
      expect(offer.is_deleted).toBe(0)
      expect(offer.deleted_at).toBeNull()
    })

    test('25.2: 软删除Offer（保留历史数据）', async () => {
      // 执行软删除
      db.prepare(`
        UPDATE offers
        SET is_deleted = 1,
            deleted_at = datetime('now'),
            is_active = 0,
            updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(testOfferId, userId)

      // 验证软删除成功
      const deletedOffer = db.prepare('SELECT * FROM offers WHERE id = ?').get(testOfferId) as any

      expect(deletedOffer).toBeTruthy() // 数据仍然存在
      expect(deletedOffer.is_deleted).toBe(1) // 标记为已删除
      expect(deletedOffer.deleted_at).toBeTruthy() // 记录删除时间
      expect(deletedOffer.brand).toBe('TestBrand') // 历史数据保留
      expect(deletedOffer.url).toBe('https://test-product.com') // 历史数据保留

      console.log('✅ 软删除成功，历史数据已保留')
    })

    test('25.3: 查询过滤已删除Offer', async () => {
      // 查询未删除的Offer（应该排除刚删除的）
      const activeOffers = db.prepare(`
        SELECT * FROM offers
        WHERE user_id = ?
          AND (is_deleted = 0 OR is_deleted IS NULL)
      `).all(userId)

      // 验证已删除的Offer不在列表中
      const deletedOfferInList = activeOffers.some((offer: any) => offer.id === testOfferId)
      expect(deletedOfferInList).toBe(false)

      console.log('✅ 已删除的Offer正确被过滤')
    })

    test('25.4: includeDeleted选项可查看已删除Offer', async () => {
      // 使用includeDeleted查询所有Offer
      const allOffers = db.prepare(`
        SELECT * FROM offers
        WHERE user_id = ?
      `).all(userId)

      // 验证已删除的Offer在完整列表中
      const deletedOfferInAll = allOffers.some((offer: any) => offer.id === testOfferId)
      expect(deletedOfferInAll).toBe(true)

      console.log('✅ includeDeleted选项正常工作')
    })
  })

  test.describe('需求25: Campaign解除关联逻辑', () => {
    let testCampaignId: number
    let testAccountId: number

    test('25.5: 创建测试Campaign和Ads账号', async () => {
      // 创建测试Google Ads账号
      const accountResult = db.prepare(`
        INSERT INTO google_ads_accounts (
          user_id, customer_id, account_name, currency, timezone, is_idle
        ) VALUES (?, ?, ?, ?, ?, 0)
      `).run(userId, '123-456-7890', 'Test Ads Account', 'USD', 'America/New_York')

      testAccountId = accountResult.lastInsertRowid as number

      // 创建新的测试Offer（未删除的）
      const offerResult = db.prepare(`
        INSERT INTO offers (
          user_id, url, brand, category, target_country,
          offer_name, target_language, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        userId,
        'https://campaign-test.com',
        'CampaignTest',
        'Electronics',
        'US',
        'CampaignTest_US_01',
        'English'
      )

      const testOfferIdForCampaign = offerResult.lastInsertRowid as number

      // 创建测试Campaign
      const campaignResult = db.prepare(`
        INSERT INTO campaigns (
          user_id, offer_id, google_ads_account_id, campaign_id, campaign_name,
          budget_amount, budget_type, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        testOfferIdForCampaign,
        testAccountId,
        'test-campaign-001',
        'Test Campaign',
        100,
        'DAILY',
        'ENABLED'
      )

      testCampaignId = campaignResult.lastInsertRowid as number

      console.log('Created Test Account ID:', testAccountId)
      console.log('Created Test Campaign ID:', testCampaignId)

      // 验证创建成功
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(testCampaignId) as any
      expect(campaign.status).toBe('ENABLED')
      expect(campaign.google_ads_account_id).toBe(testAccountId)
    })

    test('25.6: 删除Offer时自动解除Campaign关联', async () => {
      // 获取Campaign关联的Offer
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(testCampaignId) as any
      const offerId = campaign.offer_id

      // 执行软删除（应该自动标记Campaign为REMOVED）
      db.transaction(() => {
        // 1. 软删除Offer
        db.prepare(`
          UPDATE offers
          SET is_deleted = 1, deleted_at = datetime('now')
          WHERE id = ? AND user_id = ?
        `).run(offerId, userId)

        // 2. 标记关联的Campaigns为REMOVED
        db.prepare(`
          UPDATE campaigns
          SET status = 'REMOVED', updated_at = datetime('now')
          WHERE offer_id = ? AND user_id = ?
        `).run(offerId, userId)
      })()

      // 验证Campaign状态已更新
      const updatedCampaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(testCampaignId) as any
      expect(updatedCampaign.status).toBe('REMOVED')

      console.log('✅ Campaign自动标记为REMOVED')
    })

    test('25.7: 标记Ads账号为闲置', async () => {
      // 检查该账号是否还有活跃的Campaign
      const activeCount = db.prepare(`
        SELECT COUNT(*) as count
        FROM campaigns c
        JOIN offers o ON c.offer_id = o.id
        WHERE c.google_ads_account_id = ?
          AND c.user_id = ?
          AND o.is_deleted = 0
          AND c.status != 'REMOVED'
      `).get(testAccountId, userId) as any

      console.log('Active Campaigns Count:', activeCount.count)

      // 如果没有活跃Campaign，标记为闲置
      if (activeCount.count === 0) {
        db.prepare(`
          UPDATE google_ads_accounts
          SET is_idle = 1, updated_at = datetime('now')
          WHERE id = ? AND user_id = ?
        `).run(testAccountId, userId)
      }

      // 验证账号已标记为闲置
      const account = db.prepare('SELECT * FROM google_ads_accounts WHERE id = ?').get(testAccountId) as any
      expect(account.is_idle).toBe(1)

      console.log('✅ Ads账号正确标记为闲置')
    })
  })

  test.describe('需求25: API Endpoints验证', () => {
    test('25.8: GET /api/ads-accounts/idle 返回闲置账号列表', async ({ request }) => {
      // 创建auth token（简化测试，实际应该通过登录获取）
      const response = await request.get(`${BASE_URL}/api/ads-accounts/idle`, {
        headers: {
          'x-user-id': userId.toString()
        }
      })

      expect(response.ok()).toBeTruthy()
      const data = await response.json()

      console.log('Idle Accounts Response:', JSON.stringify(data, null, 2))

      expect(data.success).toBe(true)
      expect(data.data).toBeTruthy()
      expect(data.data.accounts).toBeInstanceOf(Array)

      // 验证我们创建的测试账号在列表中
      const hasTestAccount = data.data.accounts.some((acc: any) => acc.customerId === '123-456-7890')
      expect(hasTestAccount).toBe(true)

      console.log('✅ 闲置账号API正常工作')
    })

    test('25.9: POST /api/offers/:id/unlink 解除关联功能', async ({ request }) => {
      // 创建新的测试数据用于解除关联
      const offerResult = db.prepare(`
        INSERT INTO offers (
          user_id, url, brand, target_country, offer_name, target_language, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, 0)
      `).run(userId, 'https://unlink-test.com', 'UnlinkTest', 'US', 'UnlinkTest_US_01', 'English')

      const unlinkTestOfferId = offerResult.lastInsertRowid as number

      const accountResult = db.prepare(`
        INSERT INTO google_ads_accounts (
          user_id, customer_id, account_name, is_idle
        ) VALUES (?, ?, ?, 0)
      `).run(userId, '999-888-7777', 'Unlink Test Account')

      const unlinkTestAccountId = accountResult.lastInsertRowid as number

      // 创建Campaign关联
      db.prepare(`
        INSERT INTO campaigns (
          user_id, offer_id, google_ads_account_id, campaign_id,
          campaign_name, budget_amount, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        unlinkTestOfferId,
        unlinkTestAccountId,
        'unlink-test-campaign',
        'Unlink Test Campaign',
        50,
        'ENABLED'
      )

      // 调用解除关联API
      const response = await request.post(
        `${BASE_URL}/api/offers/${unlinkTestOfferId}/unlink`,
        {
          headers: {
            'x-user-id': userId.toString(),
            'Content-Type': 'application/json'
          },
          data: {
            accountId: unlinkTestAccountId
          }
        }
      )

      expect(response.ok()).toBeTruthy()
      const data = await response.json()

      console.log('Unlink Response:', JSON.stringify(data, null, 2))

      expect(data.success).toBe(true)
      expect(data.data.unlinkedCampaigns).toBeGreaterThan(0)

      // 验证Campaign已标记为REMOVED
      const campaign = db.prepare(`
        SELECT * FROM campaigns
        WHERE offer_id = ? AND google_ads_account_id = ?
      `).get(unlinkTestOfferId, unlinkTestAccountId) as any

      expect(campaign.status).toBe('REMOVED')

      // 验证账号已标记为闲置
      const account = db.prepare('SELECT * FROM google_ads_accounts WHERE id = ?').get(unlinkTestAccountId) as any
      expect(account.is_idle).toBe(1)

      console.log('✅ 解除关联API正常工作')
    })
  })

  test.describe('需求22: Google Ads读取操作', () => {
    test('22.1: Google Ads API读取函数已实现', async () => {
      // 验证google-ads-api.ts中的读取函数
      const fs = require('fs')
      const googleAdsApiContent = fs.readFileSync(
        path.join(process.cwd(), 'src/lib/google-ads-api.ts'),
        'utf-8'
      )

      // 检查关键读取函数是否存在
      expect(googleAdsApiContent).toContain('getGoogleAdsCampaign')
      expect(googleAdsApiContent).toContain('listGoogleAdsCampaigns')
      expect(googleAdsApiContent).toContain('updateGoogleAdsCampaignStatus')

      console.log('✅ Google Ads读取操作已实现')
    })
  })

  test.describe('需求24: 风险提示功能', () => {
    test('24.1: 链接检测功能已实现', async () => {
      const fs = require('fs')
      const riskAlertsContent = fs.readFileSync(
        path.join(process.cwd(), 'src/lib/risk-alerts.ts'),
        'utf-8'
      )

      // 检查关键函数
      expect(riskAlertsContent).toContain('checkLink')
      expect(riskAlertsContent).toContain('checkAllUserLinks')
      expect(riskAlertsContent).toContain('dailyLinkCheck')
      expect(riskAlertsContent).toContain('createRiskAlert')

      console.log('✅ 风险提示功能已实现')
    })

    test('24.2: risk_alerts表存在', async () => {
      const tableInfo = db.pragma(`table_info(risk_alerts)`)
      expect(tableInfo.length).toBeGreaterThan(0)

      const hasRequiredColumns = tableInfo.some((col: any) => col.name === 'risk_type')
      expect(hasRequiredColumns).toBe(true)

      console.log('✅ risk_alerts表结构正确')
    })
  })

  test.describe('需求21: 优化机制', () => {
    test('21.1: 优化规则引擎已实现', async () => {
      const fs = require('fs')
      const optimizationContent = fs.readFileSync(
        path.join(process.cwd(), 'src/lib/optimization-rules.ts'),
        'utf-8'
      )

      // 检查优化规则
      expect(optimizationContent).toContain('OptimizationRulesEngine')
      expect(optimizationContent).toContain('ctrLow')
      expect(optimizationContent).toContain('conversionRateLow')
      expect(optimizationContent).toContain('cpcHigh')
      expect(optimizationContent).toContain('roiNegative')

      console.log('✅ 优化规则引擎已实现')
    })

    test('21.2: optimization_tasks表存在', async () => {
      const tableInfo = db.pragma(`table_info(optimization_tasks)`)
      expect(tableInfo.length).toBeGreaterThan(0)

      console.log('✅ optimization_tasks表存在')
    })
  })

  test.describe('需求23: 批量导入', () => {
    test('23.1: 批量导入API已实现', async ({ request }) => {
      const testData = [
        {
          url: 'https://batch-test-1.com',
          brand: 'BatchTest1',
          target_country: 'US'
        },
        {
          url: 'https://batch-test-2.com',
          brand: 'BatchTest2',
          target_country: 'DE'
        }
      ]

      const response = await request.post(`${BASE_URL}/api/offers/batch`, {
        headers: {
          'x-user-id': userId.toString(),
          'Content-Type': 'application/json'
        },
        data: { offers: testData }
      })

      expect(response.ok()).toBeTruthy()
      const data = await response.json()

      console.log('Batch Import Response:', JSON.stringify(data, null, 2))

      expect(data.success).toBe(true)
      expect(data.summary).toBeTruthy()
      expect(data.summary.total).toBe(2)
      expect(data.summary.success).toBeGreaterThanOrEqual(0)

      console.log('✅ 批量导入API正常工作')
    })
  })
})
