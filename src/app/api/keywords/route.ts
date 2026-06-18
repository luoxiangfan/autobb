import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { createKeyword, findKeywordsByUserId, findKeywordsByAdGroupId } from '@/lib/keywords/server'
import { findAdGroupById } from '@/lib/campaign/server'

/**
 * GET /api/keywords?adGroupId=:id
 * 获取Keyword列表
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request, user) => {
  try {
    const userId = user.userId

    const { searchParams } = new URL(request.url)
    const adGroupIdParam = searchParams.get('adGroupId')
    const limitParam = searchParams.get('limit')

    let keywords

    if (adGroupIdParam) {
      // 按Ad Group ID过滤
      const adGroupId = parseInt(adGroupIdParam, 10)
      if (isNaN(adGroupId)) {
        return NextResponse.json({ error: 'adGroupId必须是数字' }, { status: 400 })
      }

      keywords = await findKeywordsByAdGroupId(adGroupId, userId)
    } else {
      // 获取用户的所有Keywords
      const limit = limitParam ? parseInt(limitParam, 10) : undefined
      keywords = await findKeywordsByUserId(userId, limit)
    }

    return NextResponse.json({
      success: true,
      keywords,
      count: keywords.length,
    })
  } catch (error: any) {
    console.error('获取Keyword列表失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Keyword列表失败',
      },
      { status: 500 }
    )
  }
})

/**
 * POST /api/keywords
 * 创建Keyword
 */
export const POST = withAuth(async (request, user) => {
  try {
    const userId = user.userId

    const body = await request.json()
    const {
      adGroupId,
      keywordText,
      matchType,
      status,
      cpcBidMicros,
      finalUrl,
      isNegative,
      aiGenerated,
      generationSource,
    } = body

    // 验证必填字段
    if (!adGroupId || !keywordText) {
      return NextResponse.json(
        {
          error: '缺少必填字段：adGroupId, keywordText',
        },
        { status: 400 }
      )
    }

    // 验证Ad Group存在且属于当前用户
    const adGroup = await findAdGroupById(adGroupId, userId)
    if (!adGroup) {
      return NextResponse.json(
        {
          error: 'Ad Group不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 创建Keyword
    const keyword = await createKeyword({
      userId: userId,
      adGroupId,
      keywordText,
      matchType,
      status,
      cpcBidMicros,
      finalUrl,
      isNegative,
      aiGenerated,
      generationSource,
    })

    return NextResponse.json({
      success: true,
      keyword,
    })
  } catch (error: any) {
    console.error('创建Keyword失败:', error)

    return NextResponse.json(
      {
        error: error.message || '创建Keyword失败',
      },
      { status: 500 }
    )
  }
})
