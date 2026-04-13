import { NextRequest, NextResponse } from 'next/server'
import { updateCampaign } from '@/lib/campaigns'
import { invalidateDashboardCache } from '@/lib/api-cache'

/**
 * PUT /api/campaigns/:id/custom-name
 * 更新广告系列自定义名称
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户 ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { customName } = body

    // customName 可以为空字符串或 null，用于清除自定义名称
    if (customName === undefined) {
      return NextResponse.json(
        { error: '缺少 customName 字段' },
        { status: 400 }
      )
    }

    const campaign = await updateCampaign(parseInt(id, 10), parseInt(userId, 10), {
      customName: customName === '' ? null : customName,
    })

    if (!campaign) {
      return NextResponse.json(
        {
          error: '广告系列不存在或无权访问',
        },
        { status: 404 }
      )
    }

    invalidateDashboardCache(parseInt(userId, 10))

    return NextResponse.json({
      success: true,
      campaign,
    })
  } catch (error: any) {
    console.error('更新广告系列自定义名称失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新广告系列自定义名称失败',
      },
      { status: 500 }
    )
  }
}
