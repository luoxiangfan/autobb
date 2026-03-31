/**
 * GET /api/admin/proxy-health
 * 获取代理池健康状态
 *
 * POST /api/admin/proxy-health
 * 手动启用/禁用代理
 */

import { NextRequest, NextResponse } from 'next/server'
import { getProxyPoolHealth, disableProxy, enableProxy } from '@/lib/url-resolver-enhanced'

export async function GET(request: NextRequest) {
  try {
    // 获取代理池健康状态
    const health = getProxyPoolHealth()

    return NextResponse.json({
      success: true,
      data: health,
      timestamp: Date.now(),
    })
  } catch (error: any) {
    console.error('获取代理健康状态失败:', error)
    return NextResponse.json(
      {
        error: '获取代理健康状态失败',
        details: error.message,
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, proxyUrl } = body

    if (!action || !proxyUrl) {
      return NextResponse.json(
        { error: '缺少必填参数：action 和 proxyUrl' },
        { status: 400 }
      )
    }

    if (action === 'disable') {
      disableProxy(proxyUrl)
      return NextResponse.json({
        success: true,
        message: `代理已禁用: ${proxyUrl}`,
      })
    } else if (action === 'enable') {
      enableProxy(proxyUrl)
      return NextResponse.json({
        success: true,
        message: `代理已启用: ${proxyUrl}`,
      })
    } else {
      return NextResponse.json(
        { error: `未知操作: ${action}` },
        { status: 400 }
      )
    }
  } catch (error: any) {
    console.error('代理操作失败:', error)
    return NextResponse.json(
      {
        error: '代理操作失败',
        details: error.message,
      },
      { status: 500 }
    )
  }
}
