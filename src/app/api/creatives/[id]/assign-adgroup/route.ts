import { NextRequest, NextResponse } from 'next/server'
import { findAdCreativeById, updateAdCreative } from '@/lib/ad-creative'
import { findAdGroupById } from '@/lib/ad-groups'

/**
 * POST /api/creatives/:id/assign-adgroup
 * 将Creative关联到Ad Group
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    const body = await request.json()
    const { adGroupId } = body

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 验证参数
    if (!adGroupId) {
      return NextResponse.json({ error: '缺少adGroupId参数' }, { status: 400 })
    }

    // 查找Creative
    const creative = await findAdCreativeById(parseInt(id, 10), parseInt(userId, 10))
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
    const adGroup = await findAdGroupById(parseInt(adGroupId, 10), parseInt(userId, 10))
    if (!adGroup) {
      return NextResponse.json(
        {
          error: 'Ad Group不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 更新Creative的adGroupId
    const updatedCreative = updateAdCreative(creative.id, parseInt(userId, 10), {
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
}
