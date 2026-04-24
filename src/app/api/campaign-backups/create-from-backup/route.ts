import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getLatestBackupForOffer } from '@/lib/campaign-backups'

/**
 * POST /api/campaign-backups/create-from-backup
 * 通过备份创建广告系列（支持批量）
 * 
 * 🔧 优化：使用 /api/campaigns/publish 的逻辑创建到 Google Ads
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const body = await request.json()
    const { backupId, backupIds, offerId, createToGoogle = true } = body

    // 参数验证：支持单个 backupId、多个 backupIds 或 offerId
    if (!backupId && !backupIds && !offerId) {
      return NextResponse.json(
        { error: '缺少 backupId、backupIds 或 offerId 参数' },
        { status: 400 }
      )
    }

    const db = await getDatabase()
    
    // 收集所有需要处理的备份
    const backups: any[] = []
    
    if (backupIds && Array.isArray(backupIds)) {
      // 🔧 批量模式：获取多个备份
      for (const bid of backupIds) {
        const backup = await db.queryOne(`
          SELECT * FROM campaign_backups
          WHERE id = ? AND user_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `, [bid, userId])
        
        if (backup) {
          backups.push(backup)
        }
      }
    } else if (backupId) {
      // 单个备份模式
      const backup = await db.queryOne(`
        SELECT * FROM campaign_backups
        WHERE id = ? AND user_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `, [backupId, userId])
      
      if (backup) {
        backups.push(backup)
      }
    } else if (offerId) {
      // Offer 模式：使用最新备份
      const backup = await getLatestBackupForOffer(offerId, userId)
      if (backup) {
        backups.push(backup)
      }
    }

    if (backups.length === 0) {
      return NextResponse.json(
        { error: '没有有效的备份' },
        { status: 404 }
      )
    }

    // 🔧 批量创建
    if (createToGoogle) {
      return await batchCreateToGoogleAds({
        backups,
        userId,
        db,
        request,
      })
    } else {
      return await batchCreateInDatabase({
        backups,
        userId,
        db,
      })
    }
  } catch (error: any) {
    console.error('通过备份批量创建广告系列失败:', error)
    return NextResponse.json(
      { error: error.message || '批量创建广告系列失败' },
      { status: 500 }
    )
  }
}

/**
 * 🔧 批量使用 /api/campaigns/publish 的逻辑创建到 Google Ads
 */
async function batchCreateToGoogleAds(params: {
  backups: any[]
  userId: number
  db: any
  request: NextRequest
}): Promise<NextResponse> {
  const { backups, userId, db, request } = params

  const results = {
    success: 0,
    failed: 0,
    skipped: 0,
    details: [] as Array<{
      backupId: number
      offerId: number
      campaignId?: number
      googleCampaignId?: string
      error?: string
    }>,
  }

  for (const backup of backups) {
    try {
      // 1. 解析备份数据
      const campaignData = typeof backup.campaign_data === 'string'
        ? JSON.parse(backup.campaign_data)
        : backup.campaign_data
      
      const campaignConfig = typeof backup.campaign_config === 'string'
        ? JSON.parse(backup.campaign_config)
        : backup.campaign_config

      if (!campaignConfig) {
        results.failed++
        results.details.push({
          backupId: backup.id,
          offerId: backup.offer_id,
          error: '备份中没有广告系列配置',
        })
        continue
      }

      // 2. 🔧 优先使用备份中的 ad_creative_id
      let creativeId = backup.ad_creative_id
      
      if (creativeId) {
        // 验证广告创意是否存在
        const existingCreative = await db.queryOne(`
          SELECT id
          FROM ad_creatives
          WHERE id = ? AND offer_id = ? AND user_id = ?
        `, [creativeId, backup.offer_id, userId])
        
        if (!existingCreative) {
          console.log(`[Batch Backup Create] 备份 ${backup.id} 中的广告创意 ${creativeId} 不存在，自动选择第一个创意`)
          creativeId = null
        }
      }
      
      // 如果没有 ad_creative_id 或创意不存在，自动选择第一个广告创意
      if (!creativeId) {
        const creative = await db.queryOne(`
          SELECT id, launch_score
          FROM ad_creatives
          WHERE offer_id = ? AND user_id = ?
          ORDER BY launch_score DESC, created_at DESC
          LIMIT 1
        `, [backup.offer_id, userId])
        
        if (!creative) {
          results.skipped++
          results.details.push({
            backupId: backup.id,
            offerId: backup.offer_id,
            error: '没有可用的广告创意',
          })
          continue
        }
        creativeId = creative.id
      }

      // 3. 🔧 调用 /api/campaigns/publish API
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const publishUrl = `${appUrl}/api/campaigns/publish`

      const publishResponse = await fetch(publishUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': request.headers.get('Cookie') || '',
        },
        body: JSON.stringify({
          offerId: backup.offer_id,
          adCreativeId: creativeId,
          googleAdsAccountId: campaignData.google_ads_account_id,
          campaignConfig: {
            campaignName: campaignConfig.campaignName || campaignData.campaign_name,
            budgetAmount: campaignConfig.budgetAmount || campaignData.budget_amount || 50,
            budgetType: campaignConfig.budgetType || campaignData.budget_type || 'DAILY',
            targetCountry: campaignConfig.targetCountry || campaignData.target_country,
            targetLanguage: campaignConfig.targetLanguage || campaignData.target_language,
            biddingStrategy: campaignConfig.biddingStrategy || 'MAXIMIZE_CLICKS',
            finalUrlSuffix: campaignConfig.finalUrlSuffix || '',
            adGroupName: campaignConfig.adGroupName,
            maxCpcBid: campaignConfig.maxCpcBid || campaignData.max_cpc,
            keywords: campaignConfig.keywords || [],
            negativeKeywords: campaignConfig.negativeKeywords || [],
          },
          pauseOldCampaigns: false,
          enableCampaignImmediately: false,
        }),
      })

      const publishResult = await publishResponse.json()

      if (publishResult.success) {
        results.success++
        results.details.push({
          backupId: backup.id,
          offerId: backup.offer_id,
          campaignId: publishResult.campaignId,
          googleCampaignId: publishResult.googleCampaignId,
        })
        console.log(`[Batch Backup Create] 创建成功 backupId=${backup.id}, campaignId=${publishResult.campaignId}`)
      } else {
        results.failed++
        results.details.push({
          backupId: backup.id,
          offerId: backup.offer_id,
          error: publishResult.errors?.[0]?.message || '创建失败',
        })
      }
    } catch (error: any) {
      results.failed++
      results.details.push({
        backupId: backup.id,
        offerId: backup.offer_id,
        error: error.message,
      })
      console.error(`[Batch Backup Create] backupId=${backup.id} Error:`, error)
    }
  }

  return NextResponse.json({
    success: true,
    message: `批量创建完成：成功 ${results.success} 个，失败 ${results.failed} 个，跳过 ${results.skipped} 个`,
    data: results,
  })
}

/**
 * 批量只在数据库中创建广告系列
 */
async function batchCreateInDatabase(params: {
  backups: any[]
  userId: number
  db: any
}): Promise<NextResponse> {
  const { backups, userId, db } = params

  const results = {
    success: 0,
    failed: 0,
    details: [] as Array<{
      backupId: number
      offerId: number
      campaignId?: number
      error?: string
    }>,
  }

  for (const backup of backups) {
    try {
      // 解析备份数据
      const campaignData = typeof backup.campaign_data === 'string'
        ? JSON.parse(backup.campaign_data)
        : backup.campaign_data
      
      const campaignConfig = typeof backup.campaign_config === 'string'
        ? JSON.parse(backup.campaign_config)
        : backup.campaign_config

      const campaignName = campaignConfig?.campaignName || campaignData.campaign_name || 'Campaign'
      
      const result = await db.exec(`
        INSERT INTO campaigns (
          user_id, offer_id, google_ads_account_id,
          campaign_id, campaign_name, custom_name,
          budget_amount, budget_type,
          target_cpa, max_cpc,
          campaign_config,
          status, creation_status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
      `, [
        userId,
        backup.offer_id,
        campaignData.google_ads_account_id,
        null,  // campaign_id (Google Ads ID，初始为 null)
        campaignName,
        backup.custom_name,
        campaignData.budget_amount,
        campaignData.budget_type,
        campaignData.target_cpa,
        campaignData.max_cpc,
        campaignConfig ? JSON.stringify(campaignConfig) : null,
        'PAUSED',
        new Date(),
        new Date(),
      ])

      const campaignId = result.lastInsertRowid || 0
      results.success++
      results.details.push({
        backupId: backup.id,
        offerId: backup.offer_id,
        campaignId,
      })
    } catch (error: any) {
      results.failed++
      results.details.push({
        backupId: backup.id,
        offerId: backup.offer_id,
        error: error.message,
      })
      console.error(`[Batch Backup Create in Database] backupId=${backup.id} Error:`, error)
    }
  }

  return NextResponse.json({
    success: true,
    message: `批量创建完成：成功 ${results.success} 个，失败 ${results.failed} 个`,
    data: results,
  })
}
