import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import {
  logUserUpdated,
  logUserDisabled,
  logUserEnabled,
  logUserDeleted,
  UserManagementContext,
} from '@/lib/audit-logger'
import { clearUserExecutionEligibilityCache } from '@/lib/user-execution-eligibility'

// 获取客户端IP地址
function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }
  const realIP = request.headers.get('x-real-ip')
  if (realIP) {
    return realIP
  }
  return 'unknown'
}

// PATCH: Update user details
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = parseInt(params.id)
    const body = await request.json()
    const {
      email,
      packageType,
      packageExpiresAt,
      isActive,
      openclawEnabled,
      productManagementEnabled,
      strategyCenterEnabled,
    } = body

    const db = getDatabase()

    // 获取更新前的用户数据（用于审计日志）
    const beforeUser = await db.queryOne(
      'SELECT id, username, email, package_type, package_expires_at, is_active, openclaw_enabled, product_management_enabled, strategy_center_enabled FROM users WHERE id = ?',
      [userId]
    ) as {
      id: number
      username: string
      email: string
      package_type: string
      package_expires_at: string
      is_active: number
      openclaw_enabled: number | boolean
      product_management_enabled?: number | boolean
      strategy_center_enabled?: number | boolean
    } | undefined

    if (!beforeUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Build update query dynamically
    // 🔧 修复(2025-12-30): 使用结构化对象管理字段更新，避免updates和values数组顺序混乱
    const fieldUpdates: Array<{ sql: string; value: any }> = []
    const changedFields: string[] = []

    if (email !== undefined && email !== beforeUser.email) {
      fieldUpdates.push({ sql: 'email = ?', value: email })
      changedFields.push('email')
    }
    if (packageType !== undefined && packageType !== beforeUser.package_type) {
      fieldUpdates.push({ sql: 'package_type = ?', value: packageType })
      changedFields.push('package_type')
    }
    if (packageExpiresAt !== undefined && packageExpiresAt !== beforeUser.package_expires_at) {
      fieldUpdates.push({ sql: 'package_expires_at = ?', value: packageExpiresAt })
      changedFields.push('package_expires_at')
    }
    if (isActive !== undefined) {
      // 🔧 修复(2025-12-30): PostgreSQL返回boolean类型，SQLite返回number类型
      // 使用类型断言避免TypeScript错误，但保持原有的运行时判断逻辑
      const currentIsActive = (beforeUser.is_active as any) === true || (beforeUser.is_active as any) === 1
      const isActiveBoolean = Boolean(isActive)
      if (isActiveBoolean !== currentIsActive) {
        // PostgreSQL接受boolean值，SQLite需要0/1
        const valueToSet = db.type === 'postgres' ? isActiveBoolean : (isActiveBoolean ? 1 : 0)
        fieldUpdates.push({ sql: 'is_active = ?', value: valueToSet })
        changedFields.push('is_active')
      }
    }

    if (openclawEnabled !== undefined) {
      const currentOpenclawEnabled = (beforeUser.openclaw_enabled as any) === true || (beforeUser.openclaw_enabled as any) === 1
      const openclawEnabledBoolean = Boolean(openclawEnabled)
      if (openclawEnabledBoolean !== currentOpenclawEnabled) {
        const valueToSet = db.type === 'postgres' ? openclawEnabledBoolean : (openclawEnabledBoolean ? 1 : 0)
        fieldUpdates.push({ sql: 'openclaw_enabled = ?', value: valueToSet })
        changedFields.push('openclaw_enabled')
      }
    }

    if (productManagementEnabled !== undefined) {
      const currentProductManagementEnabled = (beforeUser.product_management_enabled as any) === true || (beforeUser.product_management_enabled as any) === 1
      const productManagementEnabledBoolean = Boolean(productManagementEnabled)
      if (productManagementEnabledBoolean !== currentProductManagementEnabled) {
        const valueToSet = db.type === 'postgres' ? productManagementEnabledBoolean : (productManagementEnabledBoolean ? 1 : 0)
        fieldUpdates.push({ sql: 'product_management_enabled = ?', value: valueToSet })
        changedFields.push('product_management_enabled')
      }
    }

    if (strategyCenterEnabled !== undefined) {
      const currentStrategyCenterEnabled = (beforeUser.strategy_center_enabled as any) === true || (beforeUser.strategy_center_enabled as any) === 1
      const strategyCenterEnabledBoolean = Boolean(strategyCenterEnabled)
      if (strategyCenterEnabledBoolean !== currentStrategyCenterEnabled) {
        const valueToSet = db.type === 'postgres' ? strategyCenterEnabledBoolean : (strategyCenterEnabledBoolean ? 1 : 0)
        fieldUpdates.push({ sql: 'strategy_center_enabled = ?', value: valueToSet })
        changedFields.push('strategy_center_enabled')
      }
    }

    if (fieldUpdates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // 构建SQL和参数数组
    const updates = fieldUpdates.map(f => f.sql)
    updates.push('updated_at = CURRENT_TIMESTAMP')  // 所有数据库都支持CURRENT_TIMESTAMP

    const values = [...fieldUpdates.map(f => f.value), userId]  // WHERE id = ?

    // 构建最终 SQL（用于调试）
    const finalSql = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = ?
    `

    // 🔧 调试日志
    console.log('🔍 [Admin] 更新用户 SQL:', {
      sql: finalSql.trim(),
      params: values,
      updates: updates
    })

    const result = await db.exec(finalSql, values)

    // 🔧 调试日志
    console.log('🔍 [Admin] 更新结果:', result)

    if (result.changes === 0) {
      console.error('❌ [Admin] 更新用户失败:', { userId, finalSql, values })
      return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
    }

    const updatedUser = await db.queryOne('SELECT id, username, email, package_type, package_expires_at, is_active, openclaw_enabled, product_management_enabled, strategy_center_enabled FROM users WHERE id = ?', [userId]) as any

    // 获取操作者的username（从数据库查询）
    const operator = await db.queryOne('SELECT username FROM users WHERE id = ?', [auth.user!.userId]) as { username: string } | undefined

    // 记录审计日志
    const auditContext: UserManagementContext = {
      operatorId: auth.user!.userId,
      operatorUsername: operator?.username || `user_${auth.user!.userId}`, // 使用username或fallback到user_id
      targetUserId: userId,
      targetUsername: beforeUser.username,
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent') || 'Unknown',
    }

    // 根据变更类型记录不同的审计日志
    if (changedFields.includes('is_active')) {
      clearUserExecutionEligibilityCache(userId)

      // 🔧 修复(2025-12-30): PostgreSQL返回boolean类型，SQLite返回number类型
      const wasActive = (beforeUser.is_active as any) === true || (beforeUser.is_active as any) === 1
      const isNowActive = (updatedUser.is_active as any) === true || (updatedUser.is_active as any) === 1
      if (!wasActive && isNowActive) {
        await logUserEnabled(auditContext)
      } else if (wasActive && !isNowActive) {
        await logUserDisabled(auditContext)

        // 🔒 用户被禁用后：停止该用户的补点击任务 + 暂停换链接任务，并清理队列中已入队的 pending/delayed 任务
        // 任务保持停止/暂停状态，后续启用用户后由用户手动重新开启
        try {
          const { suspendUserBackgroundTasks } = await import('@/lib/background-task-suspension')
          await suspendUserBackgroundTasks(userId, { reason: 'manual_disable', purgeQueue: true })
        } catch (e: any) {
          console.warn('[Admin] suspendUserBackgroundTasks failed:', e?.message || String(e))
        }
      }
    }

    // 如果有其他字段变更，记录更新日志
    const nonStatusFields = changedFields.filter(f => f !== 'is_active')
    if (nonStatusFields.length > 0) {
      await logUserUpdated(auditContext, beforeUser, updatedUser, nonStatusFields)
    }

    return NextResponse.json({ success: true, user: updatedUser })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: Hard delete user permanently
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = parseInt(params.id)
    const db = getDatabase()

    // Prevent deleting self
    if (auth.user?.userId === userId) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
    }

    // Check if user exists and get full user data for audit
    const user = await db.queryOne(
      'SELECT id, username, email, role, package_type, is_active FROM users WHERE id = ?',
      [userId]
    ) as { id: number; username: string; email: string; role: string; package_type: string; is_active: number } | undefined

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Prevent deleting active users
    // 🔧 修复(2025-12-30): PostgreSQL返回boolean类型，SQLite返回number类型
    if ((user.is_active as any) === true || (user.is_active as any) === 1) {
      return NextResponse.json({ error: '无法删除启用状态的用户，请先禁用该用户' }, { status: 400 })
    }

    // Hard delete - permanently remove user from database
    const result = await db.exec('DELETE FROM users WHERE id = ?', [userId])

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
    }

    // 获取操作者的username（从数据库查询）
    const operator = await db.queryOne('SELECT username FROM users WHERE id = ?', [auth.user!.userId]) as { username: string } | undefined

    // 记录审计日志
    const auditContext: UserManagementContext = {
      operatorId: auth.user!.userId,
      operatorUsername: operator?.username || `user_${auth.user!.userId}`,
      targetUserId: userId,
      targetUsername: user.username || user.email,
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent') || 'Unknown',
    }
    await logUserDeleted(auditContext, user)

    return NextResponse.json({ success: true, message: 'User deleted permanently' })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
