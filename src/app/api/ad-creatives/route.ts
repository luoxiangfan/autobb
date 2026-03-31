import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/ad-creatives?offer_id=X
 * 获取指定Offer的所有广告创意列表
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const offerId = searchParams.get('offer_id')

    if (!offerId) {
      return NextResponse.json(
        { error: 'offer_id参数不能为空' },
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 查询该Offer的所有广告创意
    const creatives = await db.query(
      `
      SELECT
        id,
        offer_id AS offerId,
        user_id AS userId,
        headlines,
        descriptions,
        keywords,
        keywords_with_volume AS keywordsWithVolume,
        negative_keywords AS negativeKeywords,
        callouts,
        sitelinks,
        final_url AS finalUrl,
        final_url_suffix AS finalUrlSuffix,
        score,
        score_breakdown AS scoreBreakdown,
        ad_strength AS adStrength,
        launch_score AS launchScore,
        theme,
        ai_model AS aiModel,
        generation_round AS generationRound,
        ad_group_id AS adGroupId,
        ad_id AS adId,
        creation_status AS creationStatus,
        creation_error AS creationError,
        last_sync_at AS lastSyncAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM ad_creatives
      WHERE offer_id = ? AND user_id = ?
      ORDER BY
        CASE
          WHEN launch_score IS NOT NULL THEN launch_score
          ELSE score
        END DESC,
        created_at DESC
    `,
      [parseInt(offerId, 10), parseInt(userId, 10)]
    )

    return NextResponse.json({
      success: true,
      creatives,
      count: creatives.length,
    })
  } catch (error: any) {
    console.error('获取广告创意列表失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取广告创意列表失败',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/ad-creatives
 * 已下线：禁止通过旧写入口直接创建广告创意
 */
export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }

  return NextResponse.json(
    {
      error: '旧写入口已下线',
      code: 'AD_CREATIVES_WRITE_ENDPOINT_DECOMMISSIONED',
      message: '请使用 /api/offers/:id/generate-creatives-queue（A/B/D）生成创意',
    },
    { status: 410 }
  )
}
