import { NextRequest, NextResponse } from 'next/server'
import { findAdGroupById, updateAdGroup, deleteAdGroup } from '@/lib/ad-groups'

/**
 * GET /api/ad-groups/:id
 * 获取Ad Group详情
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

    const adGroup = await findAdGroupById(parseInt(id, 10), parseInt(userId, 10))

    if (!adGroup) {
      return NextResponse.json(
        {
          error: 'Ad Group不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      adGroup,
    })
  } catch (error: any) {
    console.error('获取Ad Group详情失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Ad Group详情失败',
      },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/ad-groups/:id
 * 更新Ad Group
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
    const { adGroupName, status, cpcBidMicros } = body

    const updates: any = {}
    if (adGroupName !== undefined) updates.adGroupName = adGroupName
    if (status !== undefined) updates.status = status
    if (cpcBidMicros !== undefined) updates.cpcBidMicros = cpcBidMicros

    const adGroup = await updateAdGroup(parseInt(id, 10), parseInt(userId, 10), updates)

    if (!adGroup) {
      return NextResponse.json(
        {
          error: 'Ad Group不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      adGroup,
    })
  } catch (error: any) {
    console.error('更新Ad Group失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新Ad Group失败',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/ad-groups/:id
 * 删除Ad Group
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const success = await deleteAdGroup(parseInt(id, 10), parseInt(userId, 10))

    if (!success) {
      return NextResponse.json(
        {
          error: 'Ad Group不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Ad Group已删除',
    })
  } catch (error: any) {
    console.error('删除Ad Group失败:', error)

    return NextResponse.json(
      {
        error: error.message || '删除Ad Group失败',
      },
      { status: 500 }
    )
  }
}
