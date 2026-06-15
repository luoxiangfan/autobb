import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findAdGroupById, updateAdGroup, deleteAdGroup } from '@/lib/campaign'

/**
 * GET /api/ad-groups/:id
 * 获取Ad Group详情
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const { id } = params

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const adGroup = await findAdGroupById(parseInt(id, 10), userId)

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
    const { adGroupName, status, cpcBidMicros } = body

    const updates: any = {}
    if (adGroupName !== undefined) updates.adGroupName = adGroupName
    if (status !== undefined) updates.status = status
    if (cpcBidMicros !== undefined) updates.cpcBidMicros = cpcBidMicros

    const adGroup = await updateAdGroup(parseInt(id, 10), userId, updates)

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
export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const { id } = params

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const success = await deleteAdGroup(parseInt(id, 10), userId)

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
