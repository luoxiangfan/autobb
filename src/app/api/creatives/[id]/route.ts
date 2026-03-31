import { NextRequest, NextResponse } from 'next/server'
import { findAdCreativeById, updateAdCreative, deleteAdCreative } from '@/lib/ad-creative'

/**
 * GET /api/creatives/:id
 * 获取单个创意详情
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const creative = await findAdCreativeById(parseInt(id, 10), parseInt(userId, 10))

    if (!creative) {
      return NextResponse.json(
        {
          error: '创意不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      creative,
    })
  } catch (error: any) {
    console.error('获取创意失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取创意失败',
      },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/creatives/:id
 * 更新创意内容
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const {
      headlines,
      descriptions,
      keywords,
      path_1,
      path_2,
      final_url,
      score,
    } = body

    // 验证必填字段
    if (!headlines && !descriptions && !final_url && !keywords) {
      return NextResponse.json(
        {
          error: '至少需要提供一个字段进行更新',
        },
        { status: 400 }
      )
    }

    const updates: any = {}
    if (headlines !== undefined) updates.headlines = headlines
    if (descriptions !== undefined) updates.descriptions = descriptions
    if (keywords !== undefined) updates.keywords = keywords
    if (path_1 !== undefined) updates.path_1 = path_1
    if (path_2 !== undefined) updates.path_2 = path_2
    if (final_url !== undefined) updates.final_url = final_url
    if (score !== undefined) updates.score = score

    const creative = updateAdCreative(parseInt(id, 10), parseInt(userId, 10), updates)

    if (!creative) {
      return NextResponse.json(
        {
          error: '创意不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      creative,
    })
  } catch (error: any) {
    console.error('更新创意失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新创意失败',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/creatives/:id
 * 删除创意
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const success = deleteAdCreative(parseInt(id, 10), parseInt(userId, 10))

    if (!success) {
      return NextResponse.json(
        {
          error: '创意不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: '创意已删除',
    })
  } catch (error: any) {
    console.error('删除创意失败:', error)

    return NextResponse.json(
      {
        error: error.message || '删除创意失败',
      },
      { status: 500 }
    )
  }
}
