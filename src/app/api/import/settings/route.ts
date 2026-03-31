import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { z } from 'zod'

// 配置导入验证Schema
const importSettingsSchema = z.object({
  version: z.string().optional(),
  settings: z.record(z.record(z.object({
    value: z.union([z.string(), z.null()]),
    dataType: z.string().optional(),
    isSensitive: z.boolean().optional(),
    description: z.string().optional(),
  }))),
})

/**
 * POST /api/import/settings
 * 导入用户配置数据
 */
export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userIdNum = parseInt(userId, 10)
    const body = await request.json()

    // 验证输入格式
    const validationResult = importSettingsSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: '无效的配置文件格式',
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { settings } = validationResult.data
    const db = await getDatabase()

    // 不允许导入的敏感配置（安全考虑）
    const blockedKeys = [
      'google_ads:refresh_token',
      'google_ads:access_token',
    ]

    let imported = 0
    let skipped = 0
    const errors: string[] = []

    // 遍历所有配置并导入
    for (const [category, categorySettings] of Object.entries(settings)) {
      for (const [configKey, config] of Object.entries(categorySettings)) {
        const fullKey = `${category}:${configKey}`

        // 检查是否为被阻止的配置
        if (blockedKeys.includes(fullKey)) {
          skipped++
          errors.push(`跳过受保护的配置: ${fullKey}`)
          continue
        }

        // 跳过脱敏的值（包含 **** 的值）
        if (config.value && config.value.includes('****')) {
          skipped++
          continue
        }

        // 跳过空值
        if (config.value === null || config.value === '') {
          skipped++
          continue
        }

        try {
          // 检查配置是否已存在
          const existing = await db.queryOne<any>(`
            SELECT id, is_sensitive FROM system_settings
            WHERE category = ? AND key = ? AND (user_id IS NULL OR user_id = ?)
            ORDER BY user_id DESC LIMIT 1
          `, [category, configKey, userIdNum])

          const isSensitive = config.isSensitive || existing?.is_sensitive === 1

          if (existing) {
            // 更新现有配置
            if (isSensitive) {
              await db.exec(`
                UPDATE system_settings
                SET encrypted_value = ?, value = NULL, updated_at = datetime('now')
                WHERE category = ? AND key = ? AND (user_id IS NULL OR user_id = ?)
              `, [encrypt(config.value), category, configKey, userIdNum])
            } else {
              await db.exec(`
                UPDATE system_settings
                SET value = ?, updated_at = datetime('now')
                WHERE category = ? AND key = ? AND (user_id IS NULL OR user_id = ?)
              `, [config.value, category, configKey, userIdNum])
            }
          } else {
            // 插入新配置（用户级别）
            if (isSensitive) {
              await db.exec(`
                INSERT INTO system_settings (user_id, category, key, encrypted_value, data_type, is_sensitive, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
              `, [userIdNum, category, configKey, encrypt(config.value), config.dataType || 'string'])
            } else {
              await db.exec(`
                INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
              `, [userIdNum, category, configKey, config.value, config.dataType || 'string'])
            }
          }

          imported++
        } catch (err: any) {
          errors.push(`导入 ${fullKey} 失败: ${err.message}`)
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `成功导入 ${imported} 个配置项`,
      summary: {
        imported,
        skipped,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error: any) {
    console.error('导入配置失败:', error)
    return NextResponse.json(
      { error: error.message || '导入失败' },
      { status: 500 }
    )
  }
}
