import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { decrypt } from '@/lib/crypto'

/**
 * GET /api/export/settings
 * 导出用户的配置数据
 * 注意：敏感信息（如API密钥）会被脱敏处理
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const includeSensitive = searchParams.get('include_sensitive') === 'true'

    const db = await getDatabase()
    const userIdNum = parseInt(userId, 10)

    // 获取用户的配置（优先用户配置，其次全局配置）
    const settings = await db.query(`
      SELECT
        category,
        key,
        value,
        encrypted_value,
        data_type,
        is_sensitive,
        is_required,
        description
      FROM system_settings
      WHERE user_id IS NULL OR user_id = ?
      ORDER BY category, key
    `, [userIdNum]) as any[]

    // 去重：对于同一个 (category, key) 组合，优先使用用户配置
    const settingsMap = new Map<string, any>()
    for (const setting of settings) {
      const key = `${setting.category}:${setting.key}`
      // 简单处理：后出现的覆盖前面的（用户配置在后面）
      settingsMap.set(key, setting)
    }

    // 转换为导出格式
    const exportData: Record<string, Record<string, any>> = {}

    for (const setting of settingsMap.values()) {
      if (!exportData[setting.category]) {
        exportData[setting.category] = {}
      }

      let value = setting.value

      // 处理敏感信息
      if (setting.is_sensitive === 1) {
        if (includeSensitive && setting.encrypted_value) {
          // 解密敏感值（仅在明确请求时）
          try {
            value = decrypt(setting.encrypted_value)
          } catch {
            value = null
          }
        } else {
          // 脱敏处理：显示部分字符
          if (setting.encrypted_value) {
            try {
              const decrypted = decrypt(setting.encrypted_value)
              if (decrypted && decrypted.length > 8) {
                value = decrypted.substring(0, 4) + '****' + decrypted.substring(decrypted.length - 4)
              } else {
                value = '****'
              }
            } catch {
              value = '****'
            }
          } else {
            value = null
          }
        }
      }

      exportData[setting.category][setting.key] = {
        value,
        dataType: setting.data_type,
        isSensitive: setting.is_sensitive === 1,
        description: setting.description,
      }
    }

    // 添加元数据
    const exportPayload = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      userId: userIdNum,
      includeSensitive,
      settings: exportData,
    }

    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="settings_${new Date().toISOString().split('T')[0]}.json"`,
      },
    })
  } catch (error: any) {
    console.error('导出配置失败:', error)
    return NextResponse.json(
      { error: error.message || '导出失败' },
      { status: 500 }
    )
  }
}
