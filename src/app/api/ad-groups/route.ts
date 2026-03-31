import { NextRequest, NextResponse } from 'next/server'
import { createAdGroup, findAdGroupsByUserId, findAdGroupsByCampaignId } from '@/lib/ad-groups'
import { findCampaignById } from '@/lib/campaigns'

/**
 * GET /api/ad-groups?campaignId=:id
 * 获取Ad Group列表
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
    const campaignIdParam = searchParams.get('campaignId')
    const limitParam = searchParams.get('limit')

    let adGroups

    if (campaignIdParam) {
      // 按Campaign ID过滤
      const campaignId = parseInt(campaignIdParam, 10)
      if (isNaN(campaignId)) {
        return NextResponse.json({ error: 'campaignId必须是数字' }, { status: 400 })
      }

      adGroups = await findAdGroupsByCampaignId(campaignId, parseInt(userId, 10))
    } else {
      // 获取用户的所有Ad Groups
      const limit = limitParam ? parseInt(limitParam, 10) : undefined
      adGroups = await findAdGroupsByUserId(parseInt(userId, 10), limit)
    }

    return NextResponse.json({
      success: true,
      adGroups,
      count: adGroups.length,
    })
  } catch (error: any) {
    console.error('获取Ad Group列表失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Ad Group列表失败',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/ad-groups
 * 创建Ad Group
 */
export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { campaignId, adGroupName, status, cpcBidMicros } = body

    // 验证必填字段
    if (!campaignId || !adGroupName) {
      return NextResponse.json(
        {
          error: '缺少必填字段：campaignId, adGroupName',
        },
        { status: 400 }
      )
    }

    // 验证Campaign存在且属于当前用户
    const campaign = await findCampaignById(campaignId, parseInt(userId, 10))
    if (!campaign) {
      return NextResponse.json(
        {
          error: 'Campaign不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 创建Ad Group
    const adGroup = await createAdGroup({
      userId: parseInt(userId, 10),
      campaignId,
      adGroupName,
      status,
      cpcBidMicros,
    })

    return NextResponse.json({
      success: true,
      adGroup,
    })
  } catch (error: any) {
    console.error('创建Ad Group失败:', error)

    return NextResponse.json(
      {
        error: error.message || '创建Ad Group失败',
      },
      { status: 500 }
    )
  }
}
