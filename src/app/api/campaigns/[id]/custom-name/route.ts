import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { updateCampaign } from '@/lib/campaign'
import { invalidateDashboardCache } from '@/lib/common'

/**
 * PUT /api/campaigns/:id/custom-name
 * 更新广告系列自定义名称
 */
export async function PUT(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const { id } = params

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const body = await request.json()
    const { customName } = body

    // customName 可以为空字符串或 null，用于清除自定义名称
    if (customName === undefined) {
      return NextResponse.json({ error: '缺少 customName 字段' }, { status: 400 })
    }

    const campaign = await updateCampaign(parseInt(id, 10), userId, {
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

    invalidateDashboardCache(userId)

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
