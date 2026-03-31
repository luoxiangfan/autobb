import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { verifyPassword, hashPassword } from '@/lib/crypto'
import { verifyToken, generateToken } from '@/lib/jwt'

/**
 * POST /api/auth/change-password
 * 修改密码API
 */
export async function POST(request: NextRequest) {
  try {
    // 从Cookie中提取token（HttpOnly Cookie方式）
    const token = request.cookies.get('auth_token')?.value

    if (!token) {
      return NextResponse.json(
        { error: '未提供认证token，请先登录' },
        { status: 401 }
      )
    }

    const payload = verifyToken(token)
    if (!payload) {
      return NextResponse.json(
        { error: 'Token无效或已过期，请重新登录' },
        { status: 401 }
      )
    }

    // 获取请求body
    const body = await request.json()
    const { currentPassword, newPassword } = body

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: '当前密码和新密码不能为空' },
        { status: 400 }
      )
    }

    // 密码复杂度验证
    const passwordErrors = validatePasswordStrength(newPassword)
    if (passwordErrors.length > 0) {
      return NextResponse.json(
        { error: '密码不符合复杂度要求', details: passwordErrors },
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 查询用户
    const user = await db.queryOne(
      'SELECT * FROM users WHERE id = ?',
      [payload.userId]
    ) as any

    if (!user) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      )
    }

    if (!user.password_hash) {
      return NextResponse.json(
        { error: '该账户未设置密码，无法修改' },
        { status: 400 }
      )
    }

    // 验证当前密码
    const isValidCurrent = await verifyPassword(currentPassword, user.password_hash)
    if (!isValidCurrent) {
      return NextResponse.json(
        { error: '当前密码错误' },
        { status: 400 }
      )
    }

    // 生成新密码哈希
    const newPasswordHash = await hashPassword(newPassword)

    // 更新密码并将must_change_password设为false (兼容PostgreSQL和SQLite)
    const db_type = db.type
    const nowFunc = db_type === 'postgres' ? 'NOW()' : 'datetime(\'now\')'
    const falseValue = db_type === 'postgres' ? 'false' : '0'
    await db.exec(`
      UPDATE users
      SET password_hash = ?,
          must_change_password = ${falseValue},
          updated_at = ${nowFunc}
      WHERE id = ?
    `, [newPasswordHash, payload.userId])

    // 生成新的JWT token（不含mustChangePassword标志）
    const newToken = generateToken({
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      packageType: payload.packageType,
      mustChangePassword: false, // 密码已修改，不再需要强制修改
    })

    // 创建响应并设置新的cookie
    const response = NextResponse.json(
      {
        success: true,
        message: '密码修改成功'
      },
      { status: 200 }
    )

    // 更新HttpOnly Cookie
    response.cookies.set({
      name: 'auth_token',
      value: newToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7天过期
      path: '/',
    })

    return response

  } catch (error) {
    console.error('修改密码失败:', error)
    return NextResponse.json(
      { error: '修改密码失败，请稍后重试' },
      { status: 500 }
    )
  }
}

/**
 * 密码复杂度验证
 */
function validatePasswordStrength(password: string): string[] {
  const errors: string[] = []

  if (password.length < 8) {
    errors.push('密码至少需要8个字符')
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('密码至少需要1个大写字母')
  }
  if (!/[a-z]/.test(password)) {
    errors.push('密码至少需要1个小写字母')
  }
  if (!/[0-9]/.test(password)) {
    errors.push('密码至少需要1个数字')
  }
  if (!/[!@#$%^&*]/.test(password)) {
    errors.push('密码至少需要1个特殊字符（!@#$%^&*）')
  }

  return errors
}
