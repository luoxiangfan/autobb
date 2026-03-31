import { NextRequest, NextResponse } from 'next/server';
import { getAllProxyUrls } from '@/lib/settings';

/**
 * GET /api/settings/proxy?country=us
 * 根据国家代码获取代理配置
 *
 * 从 proxy.urls（JSON数组）中查找匹配国家的代理
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id');
    const userIdNum = userId ? parseInt(userId, 10) : undefined;

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams;
    const country = searchParams.get('country');

    if (!country) {
      return NextResponse.json(
        {
          success: false,
          error: '缺少 country 参数',
        },
        { status: 400 }
      );
    }

    // 获取所有代理配置
    const proxyUrls = await getAllProxyUrls(userIdNum);

    if (!proxyUrls || proxyUrls.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: '未配置任何代理，请先前往设置页面配置',
        },
        { status: 404 }
      );
    }

    // 查找匹配国家的代理
    const targetCountry = country.toUpperCase();
    const proxy = proxyUrls.find(
      (p) => p.country.toUpperCase() === targetCountry
    );

    if (!proxy) {
      return NextResponse.json(
        {
          success: false,
          error: `未配置 ${targetCountry} 代理，请先前往设置页面配置`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        country: proxy.country,
        proxy_url: proxy.url,
      },
    });
  } catch (error: any) {
    console.error('获取代理配置失败:', error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || '获取代理配置失败',
      },
      { status: 500 }
    );
  }
}
