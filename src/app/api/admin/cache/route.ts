import { NextRequest, NextResponse } from 'next/server'
import { getCachedPageData } from '@/lib/redis'

// 强制动态渲染（使用了request.headers）
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/cache?url=xxx&language=xxx
 * 获取Redis中的缓存数据（仅管理员）
 */
export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户信息
    const userId = request.headers.get('x-user-id')
    const userRole = request.headers.get('x-user-role')

    if (!userId || userRole !== 'admin') {
      return NextResponse.json({ error: '无权访问' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const url = searchParams.get('url')
    const language = searchParams.get('language') || 'en'

    if (!url) {
      return NextResponse.json({ error: '缺少url参数' }, { status: 400 })
    }

    // 从Redis获取缓存数据
    const cachedData = await getCachedPageData(url, language)

    if (!cachedData) {
      return NextResponse.json({
        cached: false,
        message: '未找到缓存数据'
      })
    }

    return NextResponse.json({
      cached: true,
      data: cachedData
    })
  } catch (error: any) {
    console.error('获取缓存数据失败:', error)
    return NextResponse.json(
      { error: error.message || '获取缓存数据失败' },
      { status: 500 }
    )
  }
}
