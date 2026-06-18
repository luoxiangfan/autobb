import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { selectAdCreative, findAdCreativeById } from '@/lib/creatives/server'

/**
 * POST /api/ad-creatives/[id]/select
 * 选择指定的广告创意
 */
export const POST = withAuth(async (request, user, context) => {
  try {
    const id = context?.params?.id
    if (!id) {
      return NextResponse.json({ error: '无效的创意ID' }, { status: 400 })
    }

    const creativeId = parseInt(id)
    if (isNaN(creativeId)) {
      return NextResponse.json({ error: '无效的创意ID' }, { status: 400 })
    }

    // 验证创意存在且属于当前用户
    const creative = await findAdCreativeById(creativeId, user.userId)
    if (!creative) {
      return NextResponse.json({ error: '广告创意不存在或无权访问' }, { status: 404 })
    }

    // 标记为已选中
    selectAdCreative(creativeId, user.userId)

    console.log(`✅ 已选择广告创意 #${creativeId}`)
    console.log(`   Offer: #${creative.offer_id}`)
    console.log(`   评分: ${creative.score}`)

    return NextResponse.json({
      success: true,
      message: '广告创意已选择',
      data: {
        id: creativeId,
        offerId: creative.offer_id,
      },
    })
  } catch (error: any) {
    console.error('选择广告创意失败:', error)

    return NextResponse.json(
      {
        error: '选择广告创意失败',
        message: error.message || '未知错误',
      },
      { status: 500 }
    )
  }
})
