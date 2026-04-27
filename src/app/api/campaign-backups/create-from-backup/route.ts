import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { generateNamingScheme } from '@/lib/naming-convention'
import { getLatestBackupForOffer } from '@/lib/campaign-backups'
import { buildEffectiveCreative } from '@/lib/campaign-publish/effective-creative'
import { resolveTaskCampaignKeywords } from '@/lib/campaign-publish/task-keyword-fallback'

/**
 * 🔧 批量发布到 Google Ads（第二步）
 */
async function batchPublishToGoogleAds(params: {
  dbResult: any
  backups: any[]
  userId: number
  googleAdsAccountId: number
  db: any
  request: NextRequest
  parentRequestId?: string
}): Promise<NextResponse> {
  const { dbResult, backups, userId, googleAdsAccountId, db, request, parentRequestId } = params

  const results = {
    success: 0,
    failed: 0,
    details: [] as Array<{
      backupId: number
      campaignId: number
      googleCampaignId?: string
      error?: string
    }>,
  }

  // 获取 Google Ads 账号信息
  const adsAccount = await db.queryOne(`
    SELECT customer_id, refresh_token, auth_type, service_account_id, is_active, is_deleted
    FROM google_ads_accounts
    WHERE id = ? AND user_id = ?
  `, [googleAdsAccountId, userId])

  if (!adsAccount) {
    return NextResponse.json({
      success: false,
      message: 'Google Ads 账号不存在或无权访问',
      data: results,
    }, { status: 400 })
  }

  // 检查账号状态
  const isActive = adsAccount.is_active === true || adsAccount.is_active === 1
  const isDeleted = adsAccount.is_deleted === true || adsAccount.is_deleted === 1

  if (!isActive || isDeleted) {
    return NextResponse.json({
      success: false,
      message: 'Google Ads 账号已禁用或删除',
      data: results,
    }, { status: 400 })
  }

  // 遍历数据库创建结果，发布到 Google Ads
  for (const detail of dbResult.details) {
    if (!detail.campaignId) {
      results.failed++
      results.details.push({
        backupId: detail.backupId,
        campaignId: 0,
        error: '数据库创建失败',
      })
      continue
    }

    try {
      const backup = backups.find(b => b.id === detail.backupId)
      if (!backup) {
        results.failed++
        results.details.push({
          backupId: detail.backupId,
          campaignId: detail.campaignId,
          error: '备份不存在',
        })
        continue
      }

      // 解析备份数据
      const campaignConfig = typeof backup.campaign_config === 'string'
        ? JSON.parse(backup.campaign_config)
        : backup.campaign_config

      if (!campaignConfig) {
        results.failed++
        results.details.push({
          backupId: backup.id,
          campaignId: detail.campaignId,
          error: '备份中没有广告系列配置',
        })
        continue
      }

      // 🔧 调用 /api/campaigns/publish API
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const publishUrl = `${appUrl}/api/campaigns/publish`

      const publishResponse = await fetch(publishUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': request.headers.get('Cookie') || '',
          'x-request-id': parentRequestId || '',
        },
        body: JSON.stringify({
          offerId: backup.offer_id,
          adCreativeId: backup.ad_creative_id || 0,
          googleAdsAccountId,
          campaignConfig: {
            // 🔧 直接使用备份中的 campaign_config，包含完整的广告创意信息
            ...campaignConfig,
            // 确保必要字段存在
            campaignName: campaignConfig.campaignName || backup.campaign_name,
            budgetAmount: campaignConfig.budgetAmount || backup.budget_amount || 70,
            budgetType: campaignConfig.budgetType || backup.budget_type || 'DAILY',
            targetCountry: campaignConfig.targetCountry || backup.target_country,
            targetLanguage: campaignConfig.targetLanguage || backup.target_language,
            biddingStrategy: campaignConfig.biddingStrategy || 'MAXIMIZE_CLICKS',
            finalUrlSuffix: campaignConfig.finalUrlSuffix || backup.final_url_suffix || '',
            adGroupName: campaignConfig.adGroupName,
            maxCpcBid: campaignConfig.maxCpcBid || backup.max_cpc,
            keywords: campaignConfig.keywords || [],
            negativeKeywords: campaignConfig.negativeKeywords || [],
          },
          forcePublish: true,
          pauseOldCampaigns: false,
          enableCampaignImmediately: false,
        }),
      })

      const publishResult = await publishResponse.json()

      if (publishResult.success) {
        results.success++
        results.details.push({
          backupId: backup.id,
          campaignId: detail.campaignId,
          googleCampaignId: publishResult.googleCampaignId,
        })
        console.log(`[Batch Publish] 发布成功 backupId=${backup.id}, campaignId=${detail.campaignId}, googleCampaignId=${publishResult.googleCampaignId}`)
      } else {
        results.failed++
        results.details.push({
          backupId: backup.id,
          campaignId: detail.campaignId,
          error: publishResult.errors?.[0]?.message || '发布失败',
        })
      }
    } catch (error: any) {
      results.failed++
      results.details.push({
        backupId: detail.backupId,
        campaignId: detail.campaignId,
        error: error.message,
      })
      console.error(`[Batch Publish] backupId=${detail.backupId} Error:`, error)
    }
  }

  return NextResponse.json({
    success: true,
    message: `批量发布完成：成功 ${results.success} 个，失败 ${results.failed} 个`,
    data: results,
  })
}

/**
 * POST /api/campaign-backups/create-from-backup
 * 通过备份创建广告系列（支持批量）
 * 
 * 🔧 优化：使用 /api/campaigns/publish 的逻辑创建到 Google Ads
 */
export async function POST(request: NextRequest) {
  try {
    const parentRequestId = request.headers.get('x-request-id') || undefined
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const body = await request.json()
    const { backupId, backupIds, offerId, createToGoogle = false, googleAdsAccountId } = body

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

    // 🔧 分两步创建：先数据库，再 Google Ads
    // 第一步：在数据库中创建广告系列
    const dbResult = await batchCreateInDatabase({
      backups,
      userId,
      db,
    })
    
    // 第二步：如果选择创建到 Google Ads，则调用 publish API
    if (createToGoogle && googleAdsAccountId) {
      return await batchPublishToGoogleAds({
        dbResult,
        backups,
        userId,
        googleAdsAccountId,
        db,
        request,
        parentRequestId
      })
    }
    
    // 只返回数据库创建结果
    return NextResponse.json(dbResult)
  } catch (error: any) {
    console.error('通过备份批量创建广告系列失败:', error)
    return NextResponse.json(
      { error: error.message || '批量创建广告系列失败' },
      { status: 500 }
    )
  }
}

/**
 * 🔧 批量创建到 Google Ads
 */
async function batchCreateToGoogleAds(params: {
  backups: any[]
  userId: number
  db: any
  request: NextRequest
  parentRequestId?: string
}): Promise<NextResponse> {
  const { backups, userId, db, request, parentRequestId } = params

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

  // 获取队列管理器实例
  const { getOrCreateQueueManager } = await import('@/lib/queue/init-queue')
  const queue = await getOrCreateQueueManager()

  for (const { offer_id, campaignId, variantName, campaignConfig: campaignConfigForTask, google_ads_account_id, id: backupId } of backups) {
    try {
      console.log(`🚀 队列化Campaign发布任务 ${campaignId} (Variant ${variantName || 'Single'})...`)
      const offer = await db.queryOne(`
          SELECT id, url, final_url, final_url_suffix, brand, target_country, target_language, scrape_status, category, offer_name
          FROM offers
          WHERE id = ? AND user_id = ?
        `, [offer_id, userId]) as any
      // 🔥 使用统一命名规范生成名称
      const naming = generateNamingScheme({
        offer: {
          id: offer_id,
          brand: offer.brand,
          offerName: offer.offer_name || undefined,
          category: offer.category || undefined
        },
        config: {
          targetCountry: campaignConfigForTask.targetCountry,
          budgetAmount: campaignConfigForTask.budgetAmount,
          budgetType: campaignConfigForTask.budgetType || 'DAILY',
          biddingStrategy: campaignConfigForTask.biddingStrategy || 'MAXIMIZE_CLICKS',
          maxCpcBid: campaignConfigForTask.maxCpcBid
        },
        creative: undefined,
        smartOptimization: undefined
      })
      const effectiveCreativeForTask = buildEffectiveCreative({
        dbCreative: {
          headlines: campaignConfigForTask.headlines,
          descriptions: campaignConfigForTask.descriptions,
          keywords: campaignConfigForTask.keywords,
          negativeKeywords: campaignConfigForTask.negativeKeywords,
          callouts: campaignConfigForTask.callouts,
          sitelinks: campaignConfigForTask.sitelinks,
          finalUrl: campaignConfigForTask.finalUrl,
          finalUrlSuffix: campaignConfigForTask.finalUrlSuffix
        },
        campaignConfig: campaignConfigForTask,
        offerUrlFallback: offer.url
      })

      const taskKeywordConfig = resolveTaskCampaignKeywords({
        configuredKeywords: campaignConfigForTask.keywords,
        configuredNegativeKeywords: campaignConfigForTask.negativeKeywords,
        fallbackKeywords: effectiveCreativeForTask.keywords,
        fallbackNegativeKeywords: effectiveCreativeForTask.negativeKeywords,
      })

      if (taskKeywordConfig.usedKeywordFallback && taskKeywordConfig.keywords.length > 0) {
        console.log(`[Publish] campaignConfig.keywords缺失，回退到创意关键词: ${taskKeywordConfig.keywords.length}个`)
      }
      if (taskKeywordConfig.usedNegativeKeywordFallback && taskKeywordConfig.negativeKeywords.length > 0) {
        console.log(`[Publish] campaignConfig.negativeKeywords缺失，回退到创意否定词: ${taskKeywordConfig.negativeKeywords.length}个`)
      }

      // 🆕 使用队列系统处理Campaign发布（避免504超时）
      const taskData: any = {
        campaignId: campaignId,
        offerId: offer_id,
        googleAdsAccountId: google_ads_account_id,
        userId: userId,
        naming: naming, // 🔥 新增：传递规范化命名
        marketingObjective: campaignConfigForTask.marketingObjective || 'WEB_TRAFFIC', // 🔧 新增(2025-12-19): 营销目标
        campaignConfig: {
          targetCountry: campaignConfigForTask.targetCountry,
          targetLanguage: campaignConfigForTask.targetLanguage,
          biddingStrategy: campaignConfigForTask.biddingStrategy,
          budgetAmount: campaignConfigForTask.budgetAmount,
          budgetType: campaignConfigForTask.budgetType,
          maxCpcBid: campaignConfigForTask.maxCpcBid,
          keywords: taskKeywordConfig.keywords,
          negativeKeywords: taskKeywordConfig.negativeKeywords,
          negativeKeywordMatchType:
            campaignConfigForTask.negativeKeywordMatchType ||
            campaignConfigForTask.negativeKeywordsMatchType ||
            undefined
        },
        creative: {
          headlines: effectiveCreativeForTask.headlines,
          descriptions: effectiveCreativeForTask.descriptions,
          finalUrl: effectiveCreativeForTask.finalUrl,
          finalUrlSuffix: effectiveCreativeForTask.finalUrlSuffix,
          path1: campaignConfigForTask.path1,
          path2: campaignConfigForTask.path2,
          callouts: effectiveCreativeForTask.callouts,
          sitelinks: effectiveCreativeForTask.sitelinks,
          keywordsWithVolume: campaignConfigForTask.keywords_with_volume
            ? JSON.parse(campaignConfigForTask.keywords_with_volume)
            : undefined
        },
        brandName: offer.brand,
        forcePublish: true,
        enableCampaignImmediately: false,
        pauseOldCampaigns: false
      }

      // 入队任务
      await queue.enqueue(
        'campaign-publish',
        taskData,
        userId,
        {
          parentRequestId,
          priority: 'high'
        }
      )

      console.log(`✅ Campaign发布任务已入队 ID: ${campaignId}`)

      // 立即返回成功状态
      results.success++
      results.details.push({
        backupId: backupId,
        offerId: offer_id,
        campaignId: campaignId,
        googleCampaignId: campaignId,
      })

    } catch (error: any) {
      // 入队失败处理
      const errorMessage = error?.message || '队列任务创建失败'
      console.error(`❌ Campaign ${campaignId} 队列化失败:`, errorMessage)

      results.failed++
      results.details.push({
        backupId: backupId,
        offerId: offer_id,
        error: error.message,
      })
      console.error(`[Batch Backup Create] backupId=${backupId} Error:`, error)
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
