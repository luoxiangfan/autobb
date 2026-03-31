import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/jwt'
import { revokeSession, revokeAllSessions } from '@/lib/user-sessions'

/**
 * POST /api/auth/logout
 * 用户登出 - 清除HttpOnly Cookie和会话
 */
export async function POST(request: NextRequest) {
  try {
    // 从Cookie获取token
    const token = request.cookies.get('auth_token')?.value

    let sessionRevoked = false

    if (token) {
      // 验证token并获取用户信息
      const payload = verifyToken(token)
      if (payload) {
        // 可选：撤销所有会话（更安全）或仅当前会话
        // 这里选择撤销所有会话，确保完全登出
        const revokedCount = await revokeAllSessions(payload.userId)
        sessionRevoked = revokedCount > 0
        console.log(`用户 ${payload.userId} 登出，撤销 ${revokedCount} 个会话`)
      }
    }

    // 创建响应
    const response = NextResponse.json({
      success: true,
      message: '登出成功',
      sessionRevoked,
    })

    // 清除auth_token cookie
    response.cookies.set({
      name: 'auth_token',
      value: '',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0, // 立即过期
      path: '/',
    })

    return response
  } catch (error: any) {
    console.error('登出失败:', error)

    return NextResponse.json(
      {
        error: error.message || '登出失败，请稍后重试',
      },
      { status: 500 }
    )
  }
}
