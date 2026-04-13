import { NextRequest, NextResponse } from 'next/server'
import { updateCampaign } from '@/lib/campaigns'
import { invalidateDashboardCache } from '@/lib/api-cache'

/**
 * PUT /api/campaigns/:id/status-category
 * 更新广告系列状态分类（待定/观察/合格）
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

    const campaign = await updateCampaign(parseInt(id, 10), parseInt(userId, 10), {
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

    invalidateDashboardCache(parseInt(userId, 10))

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
