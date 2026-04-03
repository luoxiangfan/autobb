import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'

/**
 * Sync configuration interface
 */
export interface SyncConfig {
  id: number
  userId: number
  autoSyncEnabled: boolean
  syncIntervalHours: number
  maxRetryAttempts: number
  retryDelayMinutes: number
  notifyOnSuccess: boolean
  notifyOnFailure: boolean
  notificationEmail: string | null
  lastAutoSyncAt: string | null
  nextScheduledSyncAt: string | null
  consecutiveFailures: number
  createdAt: string
  updatedAt: string
}

const DEFAULT_SYNC_INTERVAL_HOURS = 4

/**
 * GET /api/sync/config
 *
 * Get user's sync configuration
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 1. Validate user
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const db = await getDatabase()

    // 2. Get sync config (create default if not exists)
    let config = await db.queryOne(
      `SELECT
        id,
        user_id as userId,
        auto_sync_enabled as autoSyncEnabled,
        sync_interval_hours as syncIntervalHours,
        max_retry_attempts as maxRetryAttempts,
        retry_delay_minutes as retryDelayMinutes,
        notify_on_success as notifyOnSuccess,
        notify_on_failure as notifyOnFailure,
        notification_email as notificationEmail,
        last_auto_sync_at as lastAutoSyncAt,
        next_scheduled_sync_at as nextScheduledSyncAt,
        consecutive_failures as consecutiveFailures,
        created_at as createdAt,
        updated_at as updatedAt
      FROM sync_config WHERE user_id = ?`,
      [userId]
    ) as SyncConfig | undefined

    if (!config) {
      // Create default config
      const result = await db.exec(
        `
          INSERT INTO sync_config (
            user_id, auto_sync_enabled, sync_interval_hours,
            max_retry_attempts, retry_delay_minutes,
            notify_on_success, notify_on_failure
          ) VALUES (?, 0, ?, 3, 15, 0, 1)
        `,
        [userId, DEFAULT_SYNC_INTERVAL_HOURS]
      )

      const configId = getInsertedId(result, db.type)

      config = await db.queryOne(
        `SELECT
          id,
          user_id as userId,
          auto_sync_enabled as autoSyncEnabled,
          sync_interval_hours as syncIntervalHours,
          max_retry_attempts as maxRetryAttempts,
          retry_delay_minutes as retryDelayMinutes,
          notify_on_success as notifyOnSuccess,
          notify_on_failure as notifyOnFailure,
          notification_email as notificationEmail,
          last_auto_sync_at as lastAutoSyncAt,
          next_scheduled_sync_at as nextScheduledSyncAt,
          consecutive_failures as consecutiveFailures,
          created_at as createdAt,
          updated_at as updatedAt
        FROM sync_config WHERE id = ?`,
        [configId]
      ) as SyncConfig
    }

    // 3. Convert integer booleans to actual booleans
    const formattedConfig = {
      ...config,
      autoSyncEnabled: Boolean(config.autoSyncEnabled),
      notifyOnSuccess: Boolean(config.notifyOnSuccess),
      notifyOnFailure: Boolean(config.notifyOnFailure),
    }

    return NextResponse.json({
      success: true,
      config: formattedConfig,
    })
  } catch (error: any) {
    console.error('Get sync config error:', error)
    return NextResponse.json(
      { error: error.message || '获取同步配置失败' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/sync/config
 *
 * Update user's sync configuration
 */
export async function PUT(request: NextRequest) {
  try {
    // 1. Validate user
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const body = await request.json()

    // 2. Validate input - 🔧 修复(2025-12-11): 接受 camelCase 字段
    const {
      autoSyncEnabled,
      syncIntervalHours,
      maxRetryAttempts,
      retryDelayMinutes,
      notifyOnSuccess,
      notifyOnFailure,
      notificationEmail,
    } = body

    // Validation rules
    if (
      typeof autoSyncEnabled !== 'boolean' &&
      autoSyncEnabled !== undefined
    ) {
      return NextResponse.json(
        { error: 'autoSyncEnabled必须是布尔值' },
        { status: 400 }
      )
    }

    if (
      syncIntervalHours !== undefined &&
      (syncIntervalHours < 1 || syncIntervalHours > 24)
    ) {
      return NextResponse.json(
        { error: '同步间隔必须在1-24小时之间' },
        { status: 400 }
      )
    }

    if (
      maxRetryAttempts !== undefined &&
      (maxRetryAttempts < 0 || maxRetryAttempts > 10)
    ) {
      return NextResponse.json(
        { error: '重试次数必须在0-10之间' },
        { status: 400 }
      )
    }

    if (
      retryDelayMinutes !== undefined &&
      (retryDelayMinutes < 5 || retryDelayMinutes > 120)
    ) {
      return NextResponse.json(
        { error: '重试延迟必须在5-120分钟之间' },
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 3. Build update query dynamically - 🔧 修复: 使用 camelCase 变量
    const updates: string[] = []
    const values: any[] = []

    if (autoSyncEnabled !== undefined) {
      updates.push('auto_sync_enabled = ?')
      values.push(autoSyncEnabled ? 1 : 0)

      // If enabling auto sync, calculate next sync time
      if (autoSyncEnabled) {
        const interval =
          syncIntervalHours !== undefined ? syncIntervalHours : DEFAULT_SYNC_INTERVAL_HOURS
        const nextSync = new Date()
        nextSync.setHours(nextSync.getHours() + interval)

        updates.push('next_scheduled_sync_at = ?')
        values.push(nextSync.toISOString())
      } else {
        // If disabling, clear next sync time
        updates.push('next_scheduled_sync_at = NULL')
      }
    }

    if (syncIntervalHours !== undefined) {
      updates.push('sync_interval_hours = ?')
      values.push(syncIntervalHours)

      // Recalculate next sync time if auto sync is enabled
      const currentConfig = await db.queryOne(
        'SELECT auto_sync_enabled FROM sync_config WHERE user_id = ?',
        [userId]
      ) as { auto_sync_enabled: number } | undefined

      if (currentConfig?.auto_sync_enabled) {
        const nextSync = new Date()
        nextSync.setHours(nextSync.getHours() + syncIntervalHours)

        updates.push('next_scheduled_sync_at = ?')
        values.push(nextSync.toISOString())
      }
    }

    if (maxRetryAttempts !== undefined) {
      updates.push('max_retry_attempts = ?')
      values.push(maxRetryAttempts)
    }

    if (retryDelayMinutes !== undefined) {
      updates.push('retry_delay_minutes = ?')
      values.push(retryDelayMinutes)
    }

    if (notifyOnSuccess !== undefined) {
      updates.push('notify_on_success = ?')
      values.push(notifyOnSuccess ? 1 : 0)
    }

    if (notifyOnFailure !== undefined) {
      updates.push('notify_on_failure = ?')
      values.push(notifyOnFailure ? 1 : 0)
    }

    if (notificationEmail !== undefined) {
      updates.push('notification_email = ?')
      values.push(notificationEmail || null)
    }

    // Always update updated_at
    updates.push('updated_at = datetime("now")')

    if (updates.length === 0) {
      return NextResponse.json({ error: '没有需要更新的字段' }, { status: 400 })
    }

    // 4. Update config
    values.push(userId)
    const query = `UPDATE sync_config SET ${updates.join(', ')} WHERE user_id = ?`

    await db.exec(query, [...values])

    // 5. Get updated config
    const updatedConfig = await db.queryOne(
      `SELECT
        id,
        user_id as userId,
        auto_sync_enabled as autoSyncEnabled,
        sync_interval_hours as syncIntervalHours,
        max_retry_attempts as maxRetryAttempts,
        retry_delay_minutes as retryDelayMinutes,
        notify_on_success as notifyOnSuccess,
        notify_on_failure as notifyOnFailure,
        notification_email as notificationEmail,
        last_auto_sync_at as lastAutoSyncAt,
        next_scheduled_sync_at as nextScheduledSyncAt,
        consecutive_failures as consecutiveFailures,
        created_at as createdAt,
        updated_at as updatedAt
      FROM sync_config WHERE user_id = ?`,
      [userId]
    ) as SyncConfig

    const formattedConfig = {
      ...updatedConfig,
      autoSyncEnabled: Boolean(updatedConfig.autoSyncEnabled),
      notifyOnSuccess: Boolean(updatedConfig.notifyOnSuccess),
      notifyOnFailure: Boolean(updatedConfig.notifyOnFailure),
    }

    return NextResponse.json({
      success: true,
      config: formattedConfig,
      message: '同步配置已更新',
    })
  } catch (error: any) {
    console.error('Update sync config error:', error)
    return NextResponse.json(
      { error: error.message || '更新同步配置失败' },
      { status: 500 }
    )
  }
}
