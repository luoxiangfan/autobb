import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { findKeywordById, updateKeyword, deleteKeyword } from '@/lib/keywords/server'

/**
 * GET /api/keywords/:id
 * 获取Keyword详情
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request, user, context) => {
  try {
    const id = context?.params?.id
    if (!id) {
      return NextResponse.json({ error: 'Keyword ID无效' }, { status: 400 })
    }

    const userId = user.userId

    const keyword = await findKeywordById(parseInt(id, 10), userId)

    if (!keyword) {
      return NextResponse.json(
        {
          error: 'Keyword不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      keyword,
    })
  } catch (error: any) {
    console.error('获取Keyword详情失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Keyword详情失败',
      },
      { status: 500 }
    )
  }
})

/**
 * PUT /api/keywords/:id
 * 更新Keyword
 */
export const PUT = withAuth(async (request, user, context) => {
  try {
    const id = context?.params?.id
    if (!id) {
      return NextResponse.json({ error: 'Keyword ID无效' }, { status: 400 })
    }

    const userId = user.userId

    const body = await request.json()
    const { keywordText, matchType, status, cpcBidMicros, finalUrl, isNegative } = body

    const updates: any = {}
    if (keywordText !== undefined) updates.keywordText = keywordText
    if (matchType !== undefined) updates.matchType = matchType
    if (status !== undefined) updates.status = status
    if (cpcBidMicros !== undefined) updates.cpcBidMicros = cpcBidMicros
    if (finalUrl !== undefined) updates.finalUrl = finalUrl
    if (isNegative !== undefined) updates.isNegative = isNegative

    const keyword = await updateKeyword(parseInt(id, 10), userId, updates)

    if (!keyword) {
      return NextResponse.json(
        {
          error: 'Keyword不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      keyword,
    })
  } catch (error: any) {
    console.error('更新Keyword失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新Keyword失败',
      },
      { status: 500 }
    )
  }
})

/**
 * DELETE /api/keywords/:id
 * 删除Keyword
 */
export const DELETE = withAuth(async (request, user, context) => {
  try {
    const id = context?.params?.id
    if (!id) {
      return NextResponse.json({ error: 'Keyword ID无效' }, { status: 400 })
    }

    const userId = user.userId

    const success = await deleteKeyword(parseInt(id, 10), userId)

    if (!success) {
      return NextResponse.json(
        {
          error: 'Keyword不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Keyword已删除',
    })
  } catch (error: any) {
    console.error('删除Keyword失败:', error)

    return NextResponse.json(
      {
        error: error.message || '删除Keyword失败',
      },
      { status: 500 }
    )
  }
})
