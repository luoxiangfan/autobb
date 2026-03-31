import { NextRequest, NextResponse } from 'next/server'
import {
  validateGoogleAdsConfig,
  validateGeminiConfig,
} from '@/lib/settings'
import { z } from 'zod'
import { ProxyProviderRegistry } from '@/lib/proxy/providers/provider-registry'
import { normalizeGeminiModel } from '@/lib/gemini-models'
import { getAffiliateSyncSettingsMap } from '@/lib/openclaw/settings'
import { validateAffiliateSyncConfig } from '@/lib/affiliate-sync-validation'

const validateSchema = z.object({
  category: z.string(),
  config: z.record(z.string()),
})

/**
 * POST /api/settings/validate
 * 验证配置
 */
export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    const userIdNum = userId ? parseInt(userId, 10) : undefined

    const body = await request.json()

    // 验证输入
    const validationResult = validateSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.errors[0].message,
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { category, config } = validationResult.data

    let result: { valid: boolean; message: string }

    // 根据分类执行不同的验证逻辑
    switch (category) {
      case 'google_ads':
        result = await validateGoogleAdsConfig(
          config.client_id || '',
          config.client_secret || '',
          config.developer_token || ''
        )
        break

      case 'ai': {
        if (!userIdNum) {
          return NextResponse.json(
            { error: '验证AI配置需要登录' },
            { status: 401 }
          )
        }

        const { getUserOnlySetting } = await import('@/lib/settings')

        let geminiApiKey: string
        let geminiRelayApiKey: string
        let selectedModel: string
        let geminiProvider: string

        if (config.gemini_provider) {
          geminiProvider = config.gemini_provider
        } else {
          const providerSetting = await getUserOnlySetting('ai', 'gemini_provider', userIdNum)
          geminiProvider = providerSetting?.value || 'official'
        }

        console.log(`🔍 验证AI配置: 服务商=${geminiProvider}`)

        if (geminiProvider === 'relay') {
          if (config.gemini_relay_api_key && config.gemini_relay_api_key !== '············') {
            geminiRelayApiKey = config.gemini_relay_api_key
            console.log('🔍 使用前端传来的中转 API Key（已隐藏）')
          } else {
            const relayApiKeySetting = await getUserOnlySetting('ai', 'gemini_relay_api_key', userIdNum)
            if (!relayApiKeySetting?.value) {
              return NextResponse.json(
                { error: '请先保存第三方中转 API Key 配置' },
                { status: 400 }
              )
            }
            geminiRelayApiKey = relayApiKeySetting.value
            console.log(`🔍 使用数据库中的中转 API Key（已隐藏，前缀：${geminiRelayApiKey.substring(0, 8)}）`)
          }
        } else {
          if (config.gemini_api_key && config.gemini_api_key !== '············') {
            geminiApiKey = config.gemini_api_key
          } else {
            const apiKeySetting = await getUserOnlySetting('ai', 'gemini_api_key', userIdNum)
            if (!apiKeySetting?.value) {
              return NextResponse.json(
                { error: '请先保存 Gemini 官方 API Key 配置' },
                { status: 400 }
              )
            }
            geminiApiKey = apiKeySetting.value
          }
          console.log('🔍 使用官方服务商的 API Key 验证')
        }

        if (config.gemini_model) {
          selectedModel = normalizeGeminiModel(config.gemini_model)
        } else {
          const geminiModelSetting = await getUserOnlySetting('ai', 'gemini_model', userIdNum)
          if (!geminiModelSetting?.value) {
            return NextResponse.json(
              { error: '请先在AI配置中选择要使用的模型' },
              { status: 400 }
            )
          }
          selectedModel = normalizeGeminiModel(geminiModelSetting.value)
        }

        console.log(`🔍 验证AI配置: 使用模型配置 ${selectedModel}`)

        const apiKeyToValidate = geminiProvider === 'relay' ? geminiRelayApiKey! : geminiApiKey!
        result = await validateGeminiConfig(apiKeyToValidate, selectedModel, userIdNum, geminiProvider)
        break
      }

      case 'proxy':
        // 代理URL列表验证（JSON格式）
        if (config.urls) {
          try {
            const proxyUrls = JSON.parse(config.urls)

            if (!Array.isArray(proxyUrls)) {
              result = {
                valid: false,
                message: '代理配置格式错误，应为数组格式',
              }
              break
            }

            if (proxyUrls.length === 0) {
              result = {
                valid: true,
                message: '未配置代理URL，代理功能已禁用',
              }
              break
            }

            const errors: string[] = []

            for (let i = 0; i < proxyUrls.length; i++) {
              const item = proxyUrls[i]
              if (!item.url || !item.country) {
                errors.push(`第${i + 1}个配置缺少必要字段`)
                continue
              }

              // 🔧 调试：记录原始URL
              console.log(`🔍 验证代理 #${i + 1}:`, {
                country: item.country,
                url: item.url,
                urlType: typeof item.url,
                urlLength: item.url.length,
                trimmedUrl: item.url.trim()
              })

              // 🔥 使用新的Provider系统验证URL
              try {
                const trimmedUrl = item.url.trim()
                const provider = ProxyProviderRegistry.getProvider(trimmedUrl)
                const validation = provider.validate(trimmedUrl)

                if (!validation.isValid) {
                  errors.push(`第${i + 1}个URL (${item.country}) 格式错误: ${validation.errors.join(', ')}`)
                } else {
                  console.log(`✅ 第${i + 1}个URL验证通过: ${provider.name} Provider`)
                }
              } catch (error) {
                console.error(`❌ 第${i + 1}个URL验证失败:`, error)
                errors.push(`第${i + 1}个URL (${item.country}) 验证失败:${error instanceof Error ? error.message : String(error)}`)
              }
            }

            if (errors.length > 0) {
              result = {
                valid: false,
                message: errors.join('；'),
              }
            } else {
              result = {
                valid: true,
                message: `✅ 已配置 ${proxyUrls.length} 个代理URL，格式验证通过`,
              }
            }
          } catch {
            result = {
              valid: false,
              message: '代理配置JSON解析失败',
            }
          }
        } else {
          result = {
            valid: true,
            message: '未配置代理URL，代理功能已禁用',
          }
        }
        break

      case 'affiliate_sync': {
        if (!userIdNum) {
          return NextResponse.json(
            { error: '验证联盟同步配置需要登录' },
            { status: 401 }
          )
        }

        const savedSettings = await getAffiliateSyncSettingsMap(userIdNum)
        result = await validateAffiliateSyncConfig({
          partnerboostToken: config.partnerboost_token || savedSettings.partnerboost_token,
          partnerboostBaseUrl: config.partnerboost_base_url || savedSettings.partnerboost_base_url,
          yeahpromosToken: config.yeahpromos_token || savedSettings.yeahpromos_token,
          yeahpromosSiteId: config.yeahpromos_site_id || savedSettings.yeahpromos_site_id,
        })
        break
      }

      default:
        return NextResponse.json(
          {
            error: `不支持的配置分类: ${category}`,
          },
          { status: 400 }
        )
    }

    return NextResponse.json({
      success: true,
      valid: result.valid,
      message: result.message,
    })
  } catch (error: any) {
    console.error('配置验证失败:', error)

    return NextResponse.json(
      {
        error: error.message || '配置验证失败',
      },
      { status: 500 }
    )
  }
}
