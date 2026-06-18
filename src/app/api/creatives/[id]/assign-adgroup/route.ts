import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { findAdCreativeById, updateAdCreative } from '@/lib/creatives/server'
import { findAdGroupById } from '@/lib/campaign/server'

/**
 * POST /api/creatives/:id/assign-adgroup
 * 将Creative关联到Ad Group
 */
export const POST = withAuth(async (request, user, context) => {
  try {
    const id = context?.params?.id
    if (!id) {
      return NextResponse.json({ error: '无效的Creative ID' }, { status: 400 })
    }

    const body = await request.json()
    const { adGroupId } = body

    const userId = user.userId

    // 验证参数
    if (!adGroupId) {
      return NextResponse.json({ error: '缺少adGroupId参数' }, { status: 400 })
    }

    // 查找Creative
    const creative = await findAdCreativeById(parseInt(id, 10), userId)
    if (!creative) {
      return NextResponse.json(
        {
          error: 'Creative不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 检查是否已经同步到Google Ads
    if (creative.ad_id) {
      return NextResponse.json(
        {
          error: 'Creative已同步到Google Ads，无法修改Ad Group关联',
        },
        { status: 400 }
      )
    }

    // 验证Ad Group存在并且属于当前用户
    const adGroup = await findAdGroupById(parseInt(adGroupId, 10), userId)
    if (!adGroup) {
      return NextResponse.json(
        {
          error: 'Ad Group不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 更新Creative的adGroupId
    const updatedCreative = updateAdCreative(creative.id, userId, {
      ad_group_id: adGroup.id,
    })

    return NextResponse.json({
      success: true,
      creative: updatedCreative,
      adGroup: {
        id: adGroup.id,
        adGroupName: adGroup.adGroupName,
      },
    })
  } catch (error: any) {
    console.error('关联Creative到Ad Group失败:', error)

    return NextResponse.json(
      {
        error: error.message || '关联失败',
      },
      { status: 500 }
    )
  }
})
