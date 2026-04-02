import { NextRequest, NextResponse } from 'next/server'
import {
  clearUserSettings,
  getAllSettings,
  getSettingsByCategory,
  getUserOnlySettingsByCategory,
  updateSettings,
} from '@/lib/settings'
import { invalidateProxyPoolCache } from '@/lib/offer-utils'
import { GEMINI_PROVIDERS, getGeminiEndpoint, getGeminiApiKeyUrl, type GeminiProvider } from '@/lib/gemini-config'
import { GEMINI_ACTIVE_MODEL, isDeprecatedGeminiModel, normalizeModelForProvider } from '@/lib/gemini-models'
import { getDatabase } from '@/lib/db'
import { z } from 'zod'
import { ProxyProviderRegistry } from '@/lib/proxy/providers/provider-registry'
import { getFixedAffiliateSyncSettingValue } from '@/lib/affiliate-sync-config'

/**
 * GET /api/settings
 * GET /api/settings?category=google_ads
 * 获取系统配置
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    const userIdNum = userId ? parseInt(userId, 10) : undefined

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const category = searchParams.get('category')

    // 根据category参数决定返回全部还是指定分类
    const settings = (() => {
      if (category === 'affiliate_sync') {
        if (!userIdNum) {
          return null
        }
        return getUserOnlySettingsByCategory('affiliate_sync', userIdNum)
      }
      if (category) {
        return getSettingsByCategory(category, userIdNum)
      }
      return getAllSettings(userIdNum)
    })()

    if (settings === null) {
      return NextResponse.json(
        { error: '获取联盟同步配置需要登录' },
        { status: 401 }
      )
    }
    const resolvedSettings = await settings

    // 强制联盟同步配置走用户级隔离，不读取全局兜底
    const effectiveSettings = (!category && userIdNum)
      ? [
          ...resolvedSettings.filter((item) => item.category !== 'affiliate_sync'),
          ...(await getUserOnlySettingsByCategory('affiliate_sync', userIdNum)),
        ]
      : resolvedSettings

    // 自动迁移：将用户历史配置中的 Gemini 2.5 Pro / Flash 统一迁移到 Gemini 3 Flash Preview
    if (userIdNum) {
      const db = await getDatabase()
      const rawGeminiModelSetting = await db.queryOne(
        'SELECT value FROM system_settings WHERE user_id = ? AND category = ? AND key = ? LIMIT 1',
        [userIdNum, 'ai', 'gemini_model']
      ) as { value: string | null } | undefined

      if (isDeprecatedGeminiModel(rawGeminiModelSetting?.value)) {
        await updateSettings([
          {
            category: 'ai',
            key: 'gemini_model',
            value: GEMINI_ACTIVE_MODEL,
          },
        ], userIdNum)
      }
    }

    // 按分类分组配置
    const groupedSettings: Record<string, any[]> = {}
    for (const setting of effectiveSettings) {
      if (!groupedSettings[setting.category]) {
        groupedSettings[setting.category] = []
      }
      groupedSettings[setting.category].push({
        key: setting.key,
        value: setting.value,
        dataType: setting.dataType,
        isSensitive: setting.isSensitive,
        isRequired: setting.isRequired,
        validationStatus: setting.validationStatus,
        validationMessage: setting.validationMessage,
        lastValidatedAt: setting.lastValidatedAt,
        description: setting.description,
      })
    }

    if (groupedSettings['affiliate_sync']) {
      groupedSettings['affiliate_sync'] = groupedSettings['affiliate_sync'].map((setting) => {
        const fixedValue = getFixedAffiliateSyncSettingValue(setting.key)
        if (fixedValue === undefined) return setting
        return {
          ...setting,
          value: fixedValue,
        }
      })
    }


    // 🔧 2025-12-29: 为 AI 分类添加动态计算字段
    if (groupedSettings['ai']) {
      // 获取 gemini_provider 值
      const providerSetting = groupedSettings['ai'].find(s => s.key === 'gemini_provider')
      const provider: GeminiProvider = providerSetting?.value === 'relay' ? 'relay' : 'official'
      const modelSetting = groupedSettings['ai'].find(s => s.key === 'gemini_model')
      const normalizedModel = normalizeModelForProvider(modelSetting?.value || GEMINI_ACTIVE_MODEL, provider)

      // 添加计算字段：gemini_endpoint
      groupedSettings['ai'].push({
        key: 'gemini_endpoint',
        value: getGeminiEndpoint(provider, normalizedModel),
        dataType: 'string',
        isSensitive: false,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: 'Gemini API 端点（系统自动计算，只读）',
      })

      // 添加计算字段：gemini_api_key_url
      groupedSettings['ai'].push({
        key: 'gemini_api_key_url',
        value: getGeminiApiKeyUrl(provider),
        dataType: 'string',
        isSensitive: false,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: 'Gemini API Key 获取地址（系统自动计算，只读）',
      })
    }

    // 确保所有核心分类都存在（即使没有配置值）
    const coreCategories = ['google_ads', 'ai', 'proxy', 'system', 'affiliate_sync']
    for (const category of coreCategories) {
      if (!groupedSettings[category]) {
        groupedSettings[category] = []
      }
    }

    return NextResponse.json({
      success: true,
      settings: groupedSettings,
    })
  } catch (error: any) {
    console.error('获取配置失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取配置失败',
      },
      { status: 500 }
    )
  }
}

const updateSettingsSchema = z.object({
  updates: z.array(
    z.object({
      category: z.string(),
      key: z.string(),
      value: z.string(),
    })
  ),
})

/**
 * PUT /api/settings
 * 批量更新配置
 */
export async function PUT(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    const userIdNum = userId ? parseInt(userId, 10) : undefined

    const body = await request.json()

    // 验证输入
    const validationResult = updateSettingsSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.errors[0].message,
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { updates } = validationResult.data

    // 联盟同步配置必须是用户级，不允许无用户上下文写入
    const hasAffiliateSyncUpdate = updates.some((update) => update.category === 'affiliate_sync')
    if (hasAffiliateSyncUpdate && !userIdNum) {
      return NextResponse.json(
        { error: '更新联盟同步配置需要登录' },
        { status: 401 }
      )
    }

    for (const update of updates) {
      if (update.category !== 'affiliate_sync') continue
      const fixedValue = getFixedAffiliateSyncSettingValue(update.key)
      if (fixedValue !== undefined) {
        update.value = fixedValue
      }
    }

    // 🔧 同步更新：AI配置变更时，按“服务商 + 模型”自动填充 gemini_endpoint
    const hasAIUpdate = updates.some(u => u.category === 'ai')
    if (hasAIUpdate) {
      const currentAISettings = userIdNum
        ? await getSettingsByCategory('ai', userIdNum)
        : []
      const aiSettingsMap = new Map(
        currentAISettings.map(setting => [setting.key, setting.value || ''])
      )

      const geminiProviderUpdate = updates.find(u => u.category === 'ai' && u.key === 'gemini_provider')
      const geminiModelUpdate = updates.find(u => u.category === 'ai' && u.key === 'gemini_model')

      const provider: GeminiProvider = (
        geminiProviderUpdate?.value ||
        aiSettingsMap.get('gemini_provider')
      ) === 'relay' ? 'relay' : 'official'

      const rawModel = geminiModelUpdate?.value ||
        aiSettingsMap.get('gemini_model') ||
        GEMINI_ACTIVE_MODEL
      const normalizedModel = normalizeModelForProvider(rawModel, provider)

      // 强制保持模型与服务商兼容
      if (geminiModelUpdate) {
        geminiModelUpdate.value = normalizedModel
      } else if (normalizedModel !== rawModel) {
        updates.push({
          category: 'ai',
          key: 'gemini_model',
          value: normalizedModel,
        })
      }

      const endpoint = getGeminiEndpoint(provider, normalizedModel)
      const existingEndpointUpdate = updates.find(u => u.category === 'ai' && u.key === 'gemini_endpoint')
      if (existingEndpointUpdate) {
        existingEndpointUpdate.value = endpoint
      } else {
        updates.push({
          category: 'ai',
          key: 'gemini_endpoint',
          value: endpoint,
        })
      }

      console.log(`🔄 根据服务商(${provider})+模型(${normalizedModel})自动更新 gemini_endpoint → ${endpoint}`)
    }

    // 🔥 2026-01-06: 保存前强制校验代理URL（避免客户端校验遗漏导致运行时失败）
    const proxyUrlsUpdate = updates.find(u => u.category === 'proxy' && u.key === 'urls')
    if (proxyUrlsUpdate) {
      let proxyUrls: Array<{ country?: string; url?: string }>
      try {
        proxyUrls = JSON.parse(proxyUrlsUpdate.value)
      } catch (error) {
        return NextResponse.json(
          { error: '代理配置JSON格式错误' },
          { status: 400 }
        )
      }

      if (!Array.isArray(proxyUrls)) {
        return NextResponse.json(
          { error: '代理配置格式错误，应为数组格式' },
          { status: 400 }
        )
      }

      const errors: string[] = []
      for (let i = 0; i < proxyUrls.length; i++) {
        const item = proxyUrls[i]
        const country = (item?.country || '').trim()
        const url = (item?.url || '').trim()

        // 允许用户保存空数组来禁用代理；但数组项必须完整
        if (!country || !url) {
          errors.push(`第${i + 1}个代理配置缺少 country 或 url`)
          continue
        }

        try {
          const provider = ProxyProviderRegistry.getProvider(url)
          const validation = provider.validate(url)
          if (!validation.isValid) {
            errors.push(`第${i + 1}个URL (${country}) 格式错误: ${validation.errors.join(', ')}`)
          }
        } catch (error: any) {
          errors.push(`第${i + 1}个URL (${country}) 不支持: ${error?.message || '未知错误'}`)
        }
      }

      if (errors.length > 0) {
        return NextResponse.json(
          { error: errors.join('；') },
          { status: 400 }
        )
      }
    }

    // 更新配置
    await updateSettings(updates, userIdNum)

    // 🔥 修复（2025-12-11）：如果更新了代理配置，清除代理池缓存
    const hasProxyUpdate = updates.some(u => u.category === 'proxy')
    if (hasProxyUpdate) {
      console.log('🔄 检测到代理配置更新，清除代理池缓存')
      invalidateProxyPoolCache(userIdNum)
    }

    // 🔥 新增：如果更新了Google Ads配置，清除相关缓存
    const hasGoogleAdsUpdate = updates.some(u => u.category === 'google_ads')
    if (hasGoogleAdsUpdate && userIdNum) {
      console.log('🔄 检测到Google Ads配置更新，清除API缓存')
      const { gadsApiCache } = await import('@/lib/cache')
      // 清除该用户的所有Google Ads API缓存
      gadsApiCache.clear()
    }

    return NextResponse.json({
      success: true,
      message: `成功更新 ${updates.length} 个配置项`,
    })
  } catch (error: any) {
    console.error('更新配置失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新配置失败',
      },
      { status: 500 }
    )
  }
}

const deleteSettingsSchema = z.discriminatedUnion('category', [
  z.object({
    category: z.literal('ai'),
    target: z.enum(['gemini-official', 'gemini-relay']),
  }),
  z.object({
    category: z.literal('affiliate_sync'),
  }),
])

const AFFILIATE_SYNC_DELETE_KEYS = [
  'yeahpromos_token',
  'yeahpromos_site_id',
  'partnerboost_token',
  'partnerboost_base_url',
  'openclaw_affiliate_sync_interval_hours',
  'openclaw_affiliate_sync_mode',
]

/**
 * DELETE /api/settings
 * 删除（清空）指定类型的用户级配置
 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')
    const userIdNum = userId ? parseInt(userId, 10) : undefined
    if (!userIdNum) {
      return NextResponse.json({ error: '删除配置需要登录' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = deleteSettingsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message, details: parsed.error.errors },
        { status: 400 }
      )
    }

    let category: 'ai' | 'affiliate_sync'
    let target: 'gemini-official' | 'gemini-relay' | 'affiliate-sync'
    let keysToClear: string[]

    if (parsed.data.category === 'ai') {
      category = 'ai'
      target = parsed.data.target
      keysToClear = (() => {
        switch (parsed.data.target) {
          case 'gemini-official':
            return ['gemini_api_key']
          case 'gemini-relay':
            return ['gemini_relay_api_key']
        }
      })()
    } else {
      category = 'affiliate_sync'
      target = 'affiliate-sync'
      keysToClear = AFFILIATE_SYNC_DELETE_KEYS
    }

    const result = await clearUserSettings(category, keysToClear, userIdNum)

    return NextResponse.json({
      success: true,
      message: '配置已删除',
      cleared: result.cleared,
      category,
      target,
      keys: keysToClear,
    })
  } catch (error: any) {
    console.error('删除配置失败:', error)
    return NextResponse.json(
      { error: error.message || '删除配置失败' },
      { status: 500 }
    )
  }
}
