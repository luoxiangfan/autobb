import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { updateCampaign } from '@/lib/campaign'
import { invalidateDashboardCache } from '@/lib/common'

/**
 * PUT /api/campaigns/:id/status-category
 * 更新广告系列状态分类（待定/观察/合格）
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
    const { statusCategory } = body

    // 验证状态值
    const validStatusCategories = ['pending', 'watching', 'qualified']
    if (!statusCategory || !validStatusCategories.includes(statusCategory)) {
      return NextResponse.json(
        {
          error: '无效的状态值',
          message: '状态值必须是 pending、watching 或 qualified',
          validValues: validStatusCategories,
        },
        { status: 400 }
      )
    }

    const campaign = await updateCampaign(parseInt(id, 10), userId, {
      statusCategory,
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
    console.error('更新广告系列状态分类失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新广告系列状态分类失败',
      },
      { status: 500 }
    )
  }
}
