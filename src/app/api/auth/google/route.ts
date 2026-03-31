import { NextRequest, NextResponse } from 'next/server'
import { getGoogleAuthUrl } from '@/lib/google-oauth'

/**
 * GET /api/auth/google
 * 发起Google OAuth登录流程
 */
export async function GET(request: NextRequest) {
  try {
    const authUrl = getGoogleAuthUrl()

    // 重定向到Google登录页面
    return NextResponse.redirect(authUrl)
  } catch (error: any) {
    console.error('Google OAuth错误:', error)

    return NextResponse.json(
      {
        error: error.message || 'Google登录初始化失败',
      },
      { status: 500 }
    )
  }
}
