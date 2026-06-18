import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { validateProxyUrl, getCountryName } from '@/lib/scraping/proxy/validate-url'
import { fetchProxyIp } from '@/lib/scraping/proxy/fetch-proxy-ip'

/**
 * POST /api/settings/proxy/validate
 * 验证Proxy URL格式并测试连接
 */
export const POST = withAuth(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const { proxy_url } = body

    if (!proxy_url) {
      return NextResponse.json({ error: 'proxy_url参数不能为空' }, { status: 400 })
    }

    const validation = validateProxyUrl(proxy_url)

    if (!validation.isValid) {
      return NextResponse.json(
        {
          success: false,
          errors: validation.errors,
        },
        { status: 400 }
      )
    }

    try {
      const proxyIp = await fetchProxyIp(proxy_url)

      return NextResponse.json({
        success: true,
        message: '验证成功',
        data: {
          isValid: true,
          countryCode: validation.countryCode,
          countryName: validation.countryCode ? getCountryName(validation.countryCode) : null,
          testIp: proxyIp.fullAddress,
        },
      })
    } catch (error: any) {
      return NextResponse.json(
        {
          success: false,
          errors: [error.message || '无法获取代理IP'],
        },
        { status: 400 }
      )
    }
  } catch (error: any) {
    console.error('验证代理URL失败:', error)

    return NextResponse.json(
      {
        error: error.message || '验证代理URL失败',
      },
      { status: 500 }
    )
  }
})
