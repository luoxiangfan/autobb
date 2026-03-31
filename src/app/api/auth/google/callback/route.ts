import { NextRequest, NextResponse } from 'next/server'
import { getGoogleUserInfo } from '@/lib/google-oauth'
import { loginWithGoogle } from '@/lib/auth'
import { createUserSession, getUserAlerts } from '@/lib/user-sessions'

// 强制动态渲染
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/google/callback
 * Google OAuth回调处理
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const error = searchParams.get('error')

    // 获取基础URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.autoads.dev'

    // 获取IP和User-Agent用于账户共享检测
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
                      request.headers.get('x-real-ip') ||
                      'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    // 检查是否有错误
    if (error) {
      console.error('Google OAuth错误:', error)
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent('Google登录失败')}`, baseUrl)
      )
    }

    // 检查是否有授权码
    if (!code) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('缺少授权码'), baseUrl)
      )
    }

    // 获取Google用户信息
    const googleUser = await getGoogleUserInfo(code)

    // 登录或注册用户
    const result = await loginWithGoogle(googleUser)

    // KISS账户共享检测：创建会话并检查可疑活动
    const { session, alerts } = await createUserSession(
      result.user.id!,
      ipAddress,
      userAgent
    )

    // 获取未解决告警
    const userAlerts = await getUserAlerts(result.user.id!, false)
    const hasCriticalAlerts = userAlerts.some(a => a.severity === 'critical')

    // 构建重定向URL，携带必要的安全状态信息
    const dashboardUrl = new URL('/dashboard', baseUrl)
    dashboardUrl.searchParams.set('token', result.token)

    // 如果有可疑活动，添加警告提示
    if (session.isSuspicious || hasCriticalAlerts) {
      dashboardUrl.searchParams.set('security_warning', 'true')
    }

    return NextResponse.redirect(dashboardUrl)
  } catch (error: any) {
    console.error('Google OAuth回调错误:', error)

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.autoads.dev'
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(error.message || 'Google登录失败')}`,
        baseUrl
      )
    )
  }
}
