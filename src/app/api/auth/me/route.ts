import { NextRequest, NextResponse } from 'next/server'
import { findUserById } from '@/lib/auth'
import { verifyToken } from '@/lib/jwt'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 从Cookie中提取token（HttpOnly Cookie方式）
    const token = request.cookies.get('auth_token')?.value

    if (!token) {
      return NextResponse.json(
        { error: '未提供认证token，请先登录' },
        { status: 401 }
      )
    }

    // 验证token
    const payload = verifyToken(token)
    if (!payload) {
      return NextResponse.json(
        { error: 'Token无效或已过期' },
        { status: 401 }
      )
    }

    // 获取用户信息
    const user = await findUserById(payload.userId)
    if (!user) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      )
    }

    if (!user.is_active) {
      return NextResponse.json(
        { error: '账户已被禁用' },
        { status: 403 }
      )
    }

    // 返回用户信息（不包含敏感数据）
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: (user as any).username,
        displayName: user.display_name,
        profilePicture: user.profile_picture,
        role: user.role,
        packageType: user.package_type,
        openclawEnabled: user.openclaw_enabled === true || user.openclaw_enabled === 1,
        productManagementEnabled: (user as any).product_management_enabled === true || (user as any).product_management_enabled === 1,
        strategyCenterEnabled: (user as any).strategy_center_enabled === true || (user as any).strategy_center_enabled === 1,
        packageExpiresAt: user.package_expires_at,
        validFrom: (user as any).valid_from,
        validUntil: (user as any).valid_until,
        createdAt: user.created_at,
      },
    })
  } catch (error: any) {
    console.error('获取用户信息失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取用户信息失败',
      },
      { status: 500 }
    )
  }
}
