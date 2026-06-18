import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getCachedPageData } from '@/lib/common/server'

// 强制动态渲染（使用了request.headers）
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/cache?url=xxx&language=xxx
 * 获取Redis中的缓存数据（仅管理员）
 */
export const GET = withAuth(
  async (request: NextRequest) => {
    try {
      const searchParams = request.nextUrl.searchParams
      const url = searchParams.get('url')
      const language = searchParams.get('language') || 'en'

      if (!url) {
        return NextResponse.json({ error: '缺少url参数' }, { status: 400 })
      }

      const cachedData = await getCachedPageData(url, language)

      if (!cachedData) {
        return NextResponse.json({
          cached: false,
          message: '未找到缓存数据',
        })
      }

      return NextResponse.json({
        cached: true,
        data: cachedData,
      })
    } catch (error: any) {
      console.error('获取缓存数据失败:', error)
      return NextResponse.json({ error: error.message || '获取缓存数据失败' }, { status: 500 })
    }
  },
  { requireAdmin: true }
)
