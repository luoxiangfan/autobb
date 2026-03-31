/**
 * 完整广告发布流程测试
 *
 * 测试内容：
 * 1. 创建Offer（推广链接：https://pboost.me/RKWwEZR9，国家：US）
 * 2. 等待抓取完成
 * 3. 生成广告创意
 * 4. 配置广告参数
 * 5. 关联广告账号（5427414593）
 * 6. 发布广告到Google Ads
 * 7. 验证发布结果
 */

import { getSQLiteDatabase } from '../src/lib/db'
import { generateAdCreative } from '../src/lib/ad-creative-generator'
import { createAdCreative } from '../src/lib/ad-creative'
import { scrapeProductData } from '../src/lib/scraper'
import { resolveAffiliateLinkWithPlaywright } from '../src/lib/url-resolver-playwright'
import { getProxyIp } from '../src/lib/proxy/fetch-proxy-ip'

// 测试配置
const TEST_CONFIG = {
  // Offer信息
  url: 'https://pboost.me/RKWwEZR9',
  targetCountry: 'US',
  targetLanguage: 'en',

  // 广告账号ID
  adsAccountId: 5427414593,

  // 广告系列配置
  campaign: {
    campaignName: `测试广告_${new Date().toISOString().split('T')[0]}`,
    budgetAmount: 20,
    budgetType: 'DAILY' as const,
    biddingStrategy: 'MAXIMIZE_CLICKS',
    adGroupName: '测试广告组',
    maxCpcBid: 1.0
  }
}

async function runFullPublishFlowTest() {
  console.log('\n========================================')
  console.log('完整广告发布流程测试')
  console.log('========================================\n')

  const db = getSQLiteDatabase()
  const userId = 1 // 测试用户ID

  try {
    // ============================================
    // 步骤1: 创建Offer
    // ============================================
    console.log('📋 步骤1/8: 创建Offer...')
    console.log(`   URL: ${TEST_CONFIG.url}`)
    console.log(`   国家: ${TEST_CONFIG.targetCountry}`)

    const offerInsert = db.prepare(`
      INSERT INTO offers (
        user_id,
        url,
        brand,
        target_country,
        target_language,
        scrape_status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))
    `).run(userId, TEST_CONFIG.url, '临时品牌', TEST_CONFIG.targetCountry, TEST_CONFIG.targetLanguage)

    const offerId = Number(offerInsert.lastInsertRowid)
    console.log(`✅ Offer创建成功，ID: ${offerId}`)

    // ============================================
    // 步骤2: 抓取产品信息
    // ============================================
    console.log('\n📋 步骤2/8: 抓取产品信息...')
    console.time('⏱️ 抓取耗时')

    try {
      const scrapedData = await scrapeProductData(TEST_CONFIG.url)

      // 更新Offer数据（映射scraper返回的字段到数据库字段）
      db.prepare(`
        UPDATE offers
        SET
          brand = ?,
          product_name = ?,
          offer_name = ?,
          brand_description = ?,
          product_highlights = ?,
          product_price = ?,
          scrape_status = 'completed',
          scraped_at = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        scrapedData.brandName || '未知品牌',
        scrapedData.productName || '未知产品',
        scrapedData.productName || '未知产品',
        scrapedData.productDescription || '',
        JSON.stringify(scrapedData.productFeatures || []),
        scrapedData.productPrice || '',
        offerId
      )

      console.timeEnd('⏱️ 抓取耗时')
      console.log(`✅ 产品信息抓取成功`)
      console.log(`   品牌: ${scrapedData.brandName}`)
      console.log(`   产品: ${scrapedData.productName}`)
      console.log(`   价格: ${scrapedData.productPrice}`)

    } catch (scrapeError: any) {
      console.timeEnd('⏱️ 抓取耗时')
      console.error(`❌ 抓取失败: ${scrapeError.message}`)

      // 更新失败状态
      db.prepare(`
        UPDATE offers
        SET scrape_status = 'failed', scrape_error = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(scrapeError.message, offerId)

      throw new Error(`产品抓取失败: ${scrapeError.message}`)
    }

    // ============================================
    // 步骤2.5: 解析推广链接获取Final URL和Suffix
    // ============================================
    console.log('\n📋 步骤2.5/8: 解析推广链接...')
    console.time('⏱️ URL解析耗时')

    try {
      // 检测是否为推广链接
      const affiliateDomains = ['pboost.me', 'bit.ly', 'geni.us', 'amzn.to']
      const isAffiliateUrl = affiliateDomains.some(domain => TEST_CONFIG.url.includes(domain))

      if (isAffiliateUrl) {
        console.log(`🔗 检测到推广链接，开始解析...`)

        // 获取代理配置
        const proxyUrl = process.env.PROXY_URL || ''
        const proxy = await getProxyIp(proxyUrl)
        const proxyFullUrl = `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`

        console.log(`使用代理: ${proxy.fullAddress}`)

        // 解析推广链接
        const resolved = await resolveAffiliateLinkWithPlaywright(
          TEST_CONFIG.url,
          proxyFullUrl,
          10000 // 10秒超时
        )

        console.log(`✅ URL解析成功`)
        console.log(`   Final URL: ${resolved.finalUrl}`)
        console.log(`   重定向次数: ${resolved.redirectCount}`)

        // 提取Final URL和Suffix
        const urlObj = new URL(resolved.finalUrl)
        const finalUrl = `${urlObj.origin}${urlObj.pathname}`
        const finalUrlSuffix = urlObj.search.substring(1) // 去掉开头的?

        console.log(`   Final URL (base): ${finalUrl}`)
        console.log(`   Final URL Suffix: ${finalUrlSuffix.substring(0, 100)}${finalUrlSuffix.length > 100 ? '...' : ''}`)

        // 更新Offer中的final_url和final_url_suffix
        db.prepare(`
          UPDATE offers
          SET
            final_url = ?,
            final_url_suffix = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(finalUrl, finalUrlSuffix, offerId)

        console.log(`✅ 已更新Offer的Final URL和Suffix`)
      } else {
        console.log(`ℹ️ 非推广链接，跳过URL解析`)
        // 直接使用原始URL作为final_url
        db.prepare(`
          UPDATE offers
          SET
            final_url = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(TEST_CONFIG.url, offerId)
      }

      console.timeEnd('⏱️ URL解析耗时')
    } catch (resolveError: any) {
      console.timeEnd('⏱️ URL解析耗时')
      console.warn(`⚠️ URL解析失败（非致命错误）: ${resolveError.message}`)
      console.warn(`   将使用原始URL作为Final URL`)

      // 失败时使用原始URL
      db.prepare(`
        UPDATE offers
        SET
          final_url = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(TEST_CONFIG.url, offerId)
    }

    // ============================================
    // 步骤3: 生成广告创意
    // ============================================
    console.log('\n📋 步骤3/8: 生成广告创意...')
    console.time('⏱️ 创意生成耗时')

    const offer = db.prepare(`SELECT * FROM offers WHERE id = ?`).get(offerId) as any
    const creativeData = await generateAdCreative(offerId, userId, { skipCache: true })

    console.timeEnd('⏱️ 创意生成耗时')
    console.log(`✅ 广告创意生成成功`)
    console.log(`   Headlines: ${creativeData.headlines.length}个`)
    console.log(`   Descriptions: ${creativeData.descriptions.length}个`)
    console.log(`   Keywords: ${creativeData.keywords.length}个`)
    console.log(`   Negative Keywords: ${creativeData.negativeKeywords?.length || 0}个`)

    // ============================================
    // 步骤4: 保存创意到数据库
    // ============================================
    console.log('\n📋 步骤4/8: 保存创意到数据库...')

    const creative = createAdCreative(userId, offerId, {
      ...creativeData,
      final_url: offer.final_url || offer.url,  // 优先使用解析后的final_url
      final_url_suffix: offer.final_url_suffix || undefined,
      ai_model: creativeData.ai_model || 'gemini-2.5-flash'
    })

    console.log(`✅ 创意已保存，ID: ${creative.id}`)
    console.log(`   Final URL: ${offer.final_url || offer.url}`)
    console.log(`   Final URL Suffix: ${offer.final_url_suffix ? offer.final_url_suffix.substring(0, 50) + '...' : '(无)'}`)

    // ============================================
    // 步骤5: 验证广告账号
    // ============================================
    console.log('\n📋 步骤5/8: 验证广告账号...')

    const adsAccount = db.prepare(`
      SELECT id, customer_id, account_name, is_active
      FROM google_ads_accounts
      WHERE customer_id = ? AND user_id = ? AND is_active = 1
    `).get(String(TEST_CONFIG.adsAccountId), userId) as any

    if (!adsAccount) {
      throw new Error(`广告账号 ${TEST_CONFIG.adsAccountId} 不存在或未激活`)
    }

    console.log(`✅ 广告账号验证成功`)
    console.log(`   账号ID: ${adsAccount.id}`)
    console.log(`   Customer ID: ${adsAccount.customer_id}`)
    console.log(`   账号名称: ${adsAccount.account_name || 'N/A'}`)

    // ============================================
    // 步骤6: 准备发布参数
    // ============================================
    console.log('\n📋 步骤6/8: 准备发布参数...')

    // 从创意中提取关键词
    const keywords = creativeData.keywords.slice(0, 20) // 最多20个关键词
    const negativeKeywords = creativeData.negativeKeywords?.slice(0, 20) || []

    const publishPayload = {
      offer_id: offerId,
      ad_creative_id: creative.id,
      google_ads_account_id: adsAccount.id,
      campaign_config: {
        ...TEST_CONFIG.campaign,
        targetCountry: TEST_CONFIG.targetCountry,
        targetLanguage: TEST_CONFIG.targetLanguage,
        finalUrlSuffix: offer.url.includes('?')
          ? offer.url.split('?')[1]
          : '',
        keywords: keywords,
        negativeKeywords: negativeKeywords
      },
      pause_old_campaigns: false,
      force_publish: true // 强制发布，跳过Launch Score检查
    }

    console.log(`✅ 发布参数准备完成`)
    console.log(`   Campaign: ${publishPayload.campaign_config.campaignName}`)
    console.log(`   Budget: $${publishPayload.campaign_config.budgetAmount}/day`)
    console.log(`   Keywords: ${keywords.length}个`)
    console.log(`   Negative Keywords: ${negativeKeywords.length}个`)

    // ============================================
    // 步骤7: 登录获取认证token
    // ============================================
    console.log('\n📋 步骤7/8: 登录获取认证...')
    console.log('🔍 调用登录API: http://localhost:3000/api/auth/login')

    const loginResponse = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'autoads',
        password: 'LYTudFbrAfTDmwvtn4+IjowdJn1AZgZyNebCjinHhjk='
      })
    })

    console.log(`📥 登录响应状态: ${loginResponse.status}`)

    if (!loginResponse.ok) {
      const error = await loginResponse.json()
      throw new Error(`登录失败: ${error.error || '未知错误'}`)
    }

    // 从响应头中提取cookie
    const setCookieHeader = loginResponse.headers.get('set-cookie')
    console.log(`🍪 Set-Cookie header: ${setCookieHeader?.substring(0, 100)}...`)

    if (!setCookieHeader) {
      throw new Error('登录响应未返回认证cookie')
    }

    // 提取auth_token的值
    const authTokenMatch = setCookieHeader.match(/auth_token=([^;]+)/)
    if (!authTokenMatch) {
      throw new Error('无法从cookie中提取auth_token')
    }
    const authToken = authTokenMatch[1]
    console.log(`✅ 登录成功，已获取认证token`)
    console.log(`🔑 Token preview: ${authToken.substring(0, 50)}...`)

    // ============================================
    // 步骤8: 发布广告（调用真实API）
    // ============================================
    console.log('\n📋 步骤8/8: 发布广告到Google Ads...')
    console.log('⏳ 正在调用发布API...')
    console.log(`📦 Payload大小: ${JSON.stringify(publishPayload).length} bytes`)
    console.time('⏱️ 发布耗时')

    try {
      console.log('🚀 发送POST请求到: http://localhost:3000/api/campaigns/publish')

      // 调用发布API（通过HTTP请求，携带认证cookie）
      const publishResponse = await fetch('http://localhost:3000/api/campaigns/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `auth_token=${authToken}`
        },
        body: JSON.stringify(publishPayload)
      })

      console.log(`📥 发布响应状态: ${publishResponse.status}`)

      const publishResult = await publishResponse.json()
      console.log(`📄 响应数据大小: ${JSON.stringify(publishResult).length} bytes`)
      console.timeEnd('⏱️ 发布耗时')

      if (!publishResponse.ok) {
        console.error(`❌ 发布失败 (HTTP ${publishResponse.status})`)
        console.error('错误详情:', JSON.stringify(publishResult, null, 2))
        throw new Error(`发布失败: ${publishResult.error || publishResult.message || '未知错误'}`)
      }

      console.log(`✅ 广告发布成功！`)
      console.log('\n发布结果:')
      console.log(`   成功: ${publishResult.summary?.successful || 0}/${publishResult.summary?.total || 0}`)
      console.log(`   失败: ${publishResult.summary?.failed || 0}`)

      if (publishResult.campaigns && publishResult.campaigns.length > 0) {
        console.log('\n已创建的Campaigns:')
        publishResult.campaigns.forEach((campaign: any) => {
          console.log(`   - Campaign ID: ${campaign.id}`)
          console.log(`     Google Campaign ID: ${campaign.google_campaign_id}`)
          console.log(`     Google Ad Group ID: ${campaign.google_ad_group_id}`)
          console.log(`     Google Ad ID: ${campaign.google_ad_id}`)
          console.log(`     状态: ${campaign.status}`)
        })
      }

      if (publishResult.failed && publishResult.failed.length > 0) {
        console.log('\n失败的Campaigns:')
        publishResult.failed.forEach((failed: any) => {
          console.log(`   - Campaign ID: ${failed.id}`)
          console.log(`     错误: ${failed.error}`)
        })
      }

      // ============================================
      // 验证数据库记录
      // ============================================
      console.log('\n📋 验证数据库记录...')

      const campaigns = db.prepare(`
        SELECT id, campaign_name, google_campaign_id, status, creation_status, creation_error
        FROM campaigns
        WHERE offer_id = ? AND user_id = ?
        ORDER BY id DESC
        LIMIT 5
      `).all(offerId, userId) as any[]

      console.log(`\n数据库中的Campaigns (最近5条):`)
      campaigns.forEach((campaign) => {
        console.log(`   - Campaign #${campaign.id}: ${campaign.campaign_name}`)
        console.log(`     Google ID: ${campaign.google_campaign_id || 'N/A'}`)
        console.log(`     状态: ${campaign.status}`)
        console.log(`     创建状态: ${campaign.creation_status}`)
        if (campaign.creation_error) {
          console.log(`     错误: ${campaign.creation_error}`)
        }
      })

      console.log('\n========================================')
      console.log('✅ 测试完成！')
      console.log('========================================\n')

    } catch (publishError: any) {
      console.timeEnd('⏱️ 发布耗时')
      console.error(`❌ 发布过程出错: ${publishError.message}`)
      throw publishError
    }

  } catch (error: any) {
    console.error('\n========================================')
    console.error('❌ 测试失败！')
    console.error('========================================')
    console.error('错误信息:', error.message)
    console.error('完整错误:', error)
    process.exit(1)
  }
}

// 运行测试
runFullPublishFlowTest().catch(console.error)
