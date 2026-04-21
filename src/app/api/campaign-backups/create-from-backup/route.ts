import { NextRequest, NextResponse } from 'next/server'
import { createCampaignFromBackup, getLatestBackupForOffer } from '@/lib/campaign-backups'

/**
 * POST /api/campaign-backups/create-from-backup
 * 通过备份快速创建广告系列
 */
export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户 ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { backupId, offerId, overrides } = body

    // 参数验证：backupId 或 offerId 至少提供一个
    if (!backupId && !offerId) {
      return NextResponse.json(
        { error: '缺少 backupId 或 offerId 参数' },
        { status: 400 }
      )
    }

    let result: Awaited<ReturnType<typeof createCampaignFromBackup>>

    if (backupId) {
      // 使用指定的备份 ID 创建
      result = await createCampaignFromBackup(
        parseInt(backupId, 10),
        parseInt(userId, 10),
        overrides
      )
    } else if (offerId) {
      // 使用 Offer 的最新备份创建
      const backup = await getLatestBackupForOffer(parseInt(offerId, 10), parseInt(userId, 10))
      
      if (!backup) {
        return NextResponse.json(
          { error: '该 Offer 没有可用的备份' },
          { status: 404 }
        )
      }

      result = await createCampaignFromBackup(
        backup.id,
        parseInt(userId, 10),
        overrides
      )
    } else {
      return NextResponse.json(
        { error: '无效的备份参数' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: result.success,
      campaignId: result.campaignId,
      googleCampaignId: result.googleCampaignId,
      errors: result.errors,
      message: result.googleCampaignId 
        ? '广告系列创建成功并已同步到 Google Ads' 
        : '广告系列创建成功（未同步到 Google Ads）',
    })
  } catch (error: any) {
    console.error('通过备份创建广告系列失败:', error)
    return NextResponse.json(
      { error: error.message || '创建广告系列失败' },
      { status: 500 }
    )
  }
}
