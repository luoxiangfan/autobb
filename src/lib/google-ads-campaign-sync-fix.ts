/**
 * Google Ads 同步修复 - 先创建 Offer 再创建广告系列
 * 
 * 将这段代码替换到 src/lib/google-ads-campaign-sync.ts 中
 */

// 替换 saveCampaignToDatabase 函数
async function saveCampaignToDatabase(params: {
  userId: number
  googleAdsAccountId: number
  campaign: GoogleAdsCampaign
  offerId?: number  // 🆕 可选的 offer_id
}): Promise<number> {
  const { userId, googleAdsAccountId, campaign, offerId } = params
  const db = await getDatabase()

  // 检查是否已存在
  const existing = await db.queryOne(
    'SELECT id FROM campaigns WHERE campaign_id = ? AND user_id = ?',
    [campaign.campaign_id, userId]
  )

  if (existing) {
    // 更新现有广告系列
    await db.exec(
      `UPDATE campaigns SET
        campaign_name = ?,
        budget_amount = ?,
        budget_type = ?,
        status = ?,
        google_ads_account_id = ?,
        synced_from_google_ads = ${db.type === 'postgres' ? 'TRUE' : '1'},
        ${offerId ? `offer_id = ${offerId},` : ''}
        last_sync_at = ?
      WHERE id = ?`,
      [
        campaign.campaign_name,
        campaign.budget_amount,
        campaign.budget_type,
        campaign.status,
        googleAdsAccountId,
        nowFunc(db.type),
        existing.id,
      ]
    )
    return existing.id
  } else {
    // 创建新广告系列
    const campaignName = campaign.campaign_name
    const result = await db.exec(
      `INSERT INTO campaigns (
        user_id,
        google_ads_account_id,
        campaign_id,
        campaign_name,
        budget_amount,
        budget_type,
        status,
        creation_status,
        synced_from_google_ads,
        offer_id,
        needs_offer_completion,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ${db.type === 'postgres' ? 'TRUE' : '1'}, ?, ${db.type === 'postgres' ? 'TRUE' : '1'}, ?, ?)`,
      [
        userId,
        googleAdsAccountId,
        campaign.campaign_id,
        campaignName,
        campaign.budget_amount,
        campaign.budget_type,
        campaign.status,
        offerId || null,  // 🆕 如果提供了 offerId，则关联
        nowFunc(db.type),
        nowFunc(db.type),
      ]
    )
    return getInsertedId(result, db.type)
  }
}

// 添加新函数：先创建 Offer
async function createOfferFirst(params: {
  userId: number
  campaign: GoogleAdsCampaign
}): Promise<{ offerId: number; created: boolean }> {
  const { userId, campaign } = params
  const db = await getDatabase()

  // 1. 检查是否已存在关联的 Offer（通过 google_ads_campaign_id）
  const existingOffer = await db.queryOne(
    'SELECT id FROM offers WHERE google_ads_campaign_id = ? AND user_id = ?',
    [campaign.campaign_id, userId]
  )

  if (existingOffer) {
    console.log(`[GoogleAds Sync] Found existing offer ${existingOffer.id} for campaign ${campaign.campaign_id}`)
    return { offerId: existingOffer.id, created: false }
  }

  // 2. 创建新 Offer
  console.log(`[GoogleAds Sync] Creating new offer for campaign ${campaign.campaign_id}`)
  
  // 生成唯一的 offer_name
  const offerName = `GA_${campaign.campaign_id}_01`
  
  const result = await db.exec(
    `INSERT INTO offers (
      user_id,
      url,
      brand,
      target_country,
      target_language,
      offer_name,
      google_ads_campaign_id,
      sync_source,
      needs_completion,
      scrape_status,
      is_active,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ${db.type === 'postgres' ? 'TRUE' : '1'}, ?, ?)`,
    [
      userId,
      '',  // URL 需要用户后续完善
      extractBrandFromCampaignName(campaign.campaign_name),  // 从广告系列名称提取品牌
      'US',  // 默认国家，需要用户完善
      'English',  // 默认语言
      offerName,
      campaign.campaign_id,
      'google_ads_sync',
      db.type === 'postgres' ? 'TRUE' : '1',  // 新创建的 Offer 标记为需要完善
      nowFunc(db.type),
      nowFunc(db.type),
    ]
  )

  const offerId = getInsertedId(result, db.type)
  console.log(`[GoogleAds Sync] Created offer ${offerId} for campaign ${campaign.campaign_id}`)
  
  return { offerId, created: true }
}
