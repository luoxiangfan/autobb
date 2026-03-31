import { NextRequest, NextResponse } from 'next/server'
import { findCampaignById, updateCampaign, deleteCampaign } from '@/lib/campaigns'
import { invalidateDashboardCache } from '@/lib/api-cache'

/**
 * GET /api/campaigns/:id
 * 获取广告系列详情
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const campaign = await findCampaignById(parseInt(id, 10), parseInt(userId, 10))

    if (!campaign) {
      return NextResponse.json(
        {
          error: '广告系列不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      campaign,
    })
  } catch (error: any) {
    console.error('获取广告系列详情失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取广告系列详情失败',
      },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/campaigns/:id
 * 更新广告系列
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const {
      campaignName,
      budgetAmount,
      budgetType,
      targetCpa,
      maxCpc,
      status,
      startDate,
      endDate,
    } = body

    const updates: any = {}
    if (campaignName !== undefined) updates.campaignName = campaignName
    if (budgetAmount !== undefined) updates.budgetAmount = budgetAmount
    if (budgetType !== undefined) updates.budgetType = budgetType
    if (targetCpa !== undefined) updates.targetCpa = targetCpa
    if (maxCpc !== undefined) updates.maxCpc = maxCpc
    if (status !== undefined) updates.status = status
    if (startDate !== undefined) updates.startDate = startDate
    if (endDate !== undefined) updates.endDate = endDate

    const campaign = await updateCampaign(parseInt(id, 10), parseInt(userId, 10), updates)

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
    console.error('更新广告系列失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新广告系列失败',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/campaigns/:id
 * 删除广告系列（草稿软删除，已移除永久删除）
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const result = await deleteCampaign(parseInt(id, 10), parseInt(userId, 10))

    if (!result.success) {
      if (result.reason === 'NOT_DRAFT') {
        return NextResponse.json(
          {
            error: '仅草稿或已移除广告系列支持删除，请先下线该广告系列',
          },
          { status: 409 }
        )
      }

      if (result.reason === 'ALREADY_DELETED') {
        return NextResponse.json(
          {
            error: '该广告系列已删除',
          },
          { status: 409 }
        )
      }

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
      message: '广告系列已删除',
    })
  } catch (error: any) {
    console.error('删除广告系列失败:', error)

    return NextResponse.json(
      {
        error: error.message || '删除广告系列失败',
      },
      { status: 500 }
    )
  }
}
