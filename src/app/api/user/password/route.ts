import { NextRequest, NextResponse } from 'next/server'
import { findUserById } from '@/lib/auth'
import { verifyPassword, hashPassword } from '@/lib/crypto'
import { verifyToken } from '@/lib/jwt'
import { getDatabase } from '@/lib/db'

/**
 * PUT /api/user/password
 * 用户修改自己的密码
 */
export async function PUT(request: NextRequest) {
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

    // 解析请求体
    const body = await request.json()
    const { oldPassword, newPassword } = body

    // 验证必填字段
    if (!oldPassword || !newPassword) {
      return NextResponse.json(
        { error: '旧密码和新密码不能为空' },
        { status: 400 }
      )
    }

    // 验证旧密码是否正确
    if (!user.password_hash) {
      return NextResponse.json(
        { error: '该账户使用Google登录，无法修改密码' },
        { status: 400 }
      )
    }

    const isOldPasswordValid = await verifyPassword(oldPassword, user.password_hash)
    if (!isOldPasswordValid) {
      return NextResponse.json(
        { error: '旧密码不正确' },
        { status: 400 }
      )
    }

    // 验证新密码复杂度
    const passwordErrors = validatePasswordComplexity(newPassword)
    if (passwordErrors.length > 0) {
      return NextResponse.json(
        { error: passwordErrors.join('; ') },
        { status: 400 }
      )
    }

    // 验证新密码不能与旧密码相同
    if (oldPassword === newPassword) {
      return NextResponse.json(
        { error: '新密码不能与旧密码相同' },
        { status: 400 }
      )
    }

    // 生成新密码哈希
    const newPasswordHash = await hashPassword(newPassword)

    // 更新密码，同时取消首次修改密码标记
    const db = await getDatabase()
    const nowFunc = db.type === 'postgres' ? 'NOW()' : 'datetime(\'now\')'
    const falseValue = db.type === 'postgres' ? 'false' : '0'
    await db.exec(`
      UPDATE users
      SET password_hash = ?, must_change_password = ${falseValue}, updated_at = ${nowFunc}
      WHERE id = ?
    `, [newPasswordHash, user.id])

    console.log(`用户 ${user.email} (ID: ${user.id}) 修改了密码`)

    return NextResponse.json({
      success: true,
      message: '密码修改成功，请重新登录',
    })

  } catch (error: any) {
    console.error('修改密码失败:', error)
    return NextResponse.json(
      { error: error.message || '修改密码失败' },
      { status: 500 }
    )
  }
}

/**
 * 验证密码复杂度
 */
function validatePasswordComplexity(password: string): string[] {
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
