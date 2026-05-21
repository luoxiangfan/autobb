import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getLatestBackupForOffer, parseCampaignBackup } from '@/lib/campaign-backups'
import {
  batchCreateCampaignsFromBackupsInDatabase,
  batchEnqueuePublishFromBackups,
  validateGoogleAdsAccountForRestore,
} from '@/lib/campaign-backup-restore'

/**
 * POST /api/campaign-backups/create-from-backup
 * 通过备份创建广告系列（支持批量）
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
    const {
      backupId,
      backupIds,
      offerId,
      offerIds,
      googleAdsAccountId,
      createToGoogle,
      regenerateCreativeMap,
    } = body

    if (!backupId && !backupIds && offerId == null && (!offerIds || offerIds.length === 0)) {
      return NextResponse.json(
        { error: '缺少 backupId、backupIds、offerId 或 offerIds 参数' },
        { status: 400 }
      )
    }

    const db = await getDatabase()
    const backups: ReturnType<typeof parseCampaignBackup>[] = []

    if (backupIds && Array.isArray(backupIds)) {
      for (const bid of backupIds) {
        const row = await db.queryOne(
          `SELECT * FROM campaign_backups WHERE id = ? AND user_id = ?`,
          [bid, userId]
        )
        if (row) backups.push(parseCampaignBackup(row))
      }
    } else if (backupId) {
      const row = await db.queryOne(
        `SELECT * FROM campaign_backups WHERE id = ? AND user_id = ?`,
        [backupId, userId]
      )
      if (row) backups.push(parseCampaignBackup(row))
    } else if (offerIds && Array.isArray(offerIds)) {
      for (const oid of offerIds) {
        const backup = await getLatestBackupForOffer(Number(oid), userId)
        if (backup) backups.push(backup)
      }
    } else if (offerId != null) {
      const backup = await getLatestBackupForOffer(Number(offerId), userId)
      if (backup) backups.push(backup)
    }

    if (backups.length === 0) {
      return NextResponse.json({ error: '没有有效的备份' }, { status: 404 })
    }

    const shouldPublish = createToGoogle !== false
    const resolvedGoogleAdsAccountId =
      googleAdsAccountId != null ? Number(googleAdsAccountId) : null

    const dbResult = await batchCreateCampaignsFromBackupsInDatabase({
      backups,
      userId,
      googleAdsAccountId: resolvedGoogleAdsAccountId,
      db,
    })

    if (!shouldPublish) {
      return NextResponse.json({
        success: dbResult.failed === 0,
        message: `批量创建完成：成功 ${dbResult.success} 个，失败 ${dbResult.failed} 个`,
        data: dbResult,
      })
    }

    const publishAccountId =
      resolvedGoogleAdsAccountId ??
      backups.find((b) => b.googleAdsAccountId)?.googleAdsAccountId ??
      null

    if (!publishAccountId) {
      return NextResponse.json(
        {
          error: '发布到 Google Ads 需要 googleAdsAccountId，或备份中需包含 google_ads_account_id',
          data: dbResult,
        },
        { status: 400 }
      )
    }

    const accountCheck = await validateGoogleAdsAccountForRestore(
      db,
      publishAccountId,
      userId
    )
    if (!accountCheck.ok) {
      return NextResponse.json(
        { success: false, message: accountCheck.message, data: dbResult },
        { status: 400 }
      )
    }

    const publishResult = await batchEnqueuePublishFromBackups({
      backups,
      dbCreateDetails: dbResult.details,
      userId,
      googleAdsAccountId: publishAccountId,
      db,
      regenerateCreativeMap,
      parentRequestId,
    })

    return NextResponse.json({
      success: dbResult.failed === 0 && publishResult.failed === 0,
      message: `批量创建完成：数据库成功 ${dbResult.success} 个，发布入队成功 ${publishResult.success} 个，失败 ${dbResult.failed + publishResult.failed} 个`,
      data: {
        database: dbResult,
        publish: publishResult,
      },
    })
  } catch (error: any) {
    console.error('通过备份批量创建广告系列失败:', error)
    return NextResponse.json(
      { error: error.message || '批量创建广告系列失败' },
      { status: 500 }
    )
  }
}
