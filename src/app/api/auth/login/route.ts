import { NextRequest, NextResponse } from 'next/server'
import { loginWithPassword } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rate-limiter'
import { createUserSession, getUserAlerts } from '@/lib/user-sessions'
import { z } from 'zod'

const loginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
})

export async function POST(request: NextRequest) {
  try {
    // P0：获取IP和User-Agent用于安全日志
    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    const body = await request.json()

    // 验证输入
    const validationResult = loginSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.errors[0].message,
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { username, password } = validationResult.data

    // P0：速率限制检查（IP级别 + 用户名级别）
    try {
      checkRateLimit(`ip:${ipAddress}`)
      checkRateLimit(`user:${username}`)
    } catch (rateLimitError: any) {
      return NextResponse.json(
        { error: rateLimitError.message },
        { status: 429 } // 429 Too Many Requests
      )
    }

    // 注意：已移除CAPTCHA验证逻辑，改为3次失败后直接禁用账户（需管理员手动启用）

    // 登录 (支持用户名或邮箱，增强安全版本)
    const result = await loginWithPassword(username, password, ipAddress, userAgent)

    // KISS账户共享检测：创建会话并检查可疑活动
    const { session, alerts } = await createUserSession(
      result.user.id!,
      ipAddress,
      userAgent
    )

    // 获取用户未解决的安全告警
    const userAlerts = await getUserAlerts(result.user.id!, false)

    // 检查是否有严重告警需要通知用户
    const criticalAlerts = userAlerts.filter((a) => a.severity === 'critical')
    const hasSuspiciousActivity = session.isSuspicious || criticalAlerts.length > 0

    // 创建响应（需求20：包含must_change_password标识）
    const response = NextResponse.json({
      success: true,
      user: {
        ...result.user,
        mustChangePassword: result.mustChangePassword || false,
      },
      // 账户共享检测信息
      security: {
        sessionId: session.id,
        isSuspiciousActivity: hasSuspiciousActivity,
        suspiciousReason: session.suspiciousReason,
        alertCount: userAlerts.length,
        hasCriticalAlerts: criticalAlerts.length > 0,
      },
    })

    // 设置HttpOnly Cookie（安全的token存储方式）
    response.cookies.set({
      name: 'auth_token',
      value: result.token,
      httpOnly: true, // 防止JavaScript访问，防XSS攻击
      secure: process.env.NODE_ENV === 'production', // 生产环境强制HTTPS
      sameSite: 'lax', // CSRF保护
      maxAge: 60 * 60 * 24 * 7, // 7天过期
      path: '/', // 全站可用
    })

    return response
  } catch (error: any) {
    console.error('登录失败:', error)

    // 根据错误类型返回不同的状态码
    let status = 500

    if (error.message.includes('用户名或密码错误')) {
      status = 401 // Unauthorized
    } else if (error.message.includes('账户已被锁定')) {
      status = 429 // Too Many Requests (账户锁定)
    } else if (error.message.includes('账户已被禁用')) {
      status = 403 // Forbidden
    } else if (error.message.includes('套餐已过期')) {
      status = 402 // Payment Required
    }

    return NextResponse.json(
      {
        error: error.message || '登录失败，请稍后重试',
      },
      { status }
    )
  }
}
