import { NextRequest, NextResponse } from 'next/server'
import { validateUrl } from '@/lib/scraper'

/**
 * POST /api/offers/:id/validate-url
 * 验证URL是否可访问
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const { url } = body

    if (!url) {
      return NextResponse.json(
        {
          error: 'URL不能为空',
        },
        { status: 400 }
      )
    }

    const result = await validateUrl(url)

    return NextResponse.json({
      success: true,
      isAccessible: result.isAccessible,
      statusCode: result.statusCode,
      error: result.error,
    })
  } catch (error: any) {
    console.error('验证URL失败:', error)

    return NextResponse.json(
      {
        error: error.message || '验证URL失败',
      },
      { status: 500 }
    )
  }
}
