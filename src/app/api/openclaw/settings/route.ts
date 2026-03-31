import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import cron from 'node-cron'
import { getSettingsByCategory, getUserOnlySettingsByCategory, updateSettings } from '@/lib/settings'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'
import { auditOpenclawAiAuthOverrides } from '@/lib/openclaw/ai-auth-audit'

const GLOBAL_AI_KEYS = new Set([
  'ai_models_json',
  'openclaw_models_mode',
  'openclaw_models_bedrock_discovery_json',
])

const USER_SCOPED_KEYS = new Set([
  'yeahpromos_page',
  'yeahpromos_limit',
  'yeahpromos_request_delay_ms',
  'yeahpromos_rate_limit_max_retries',
  'yeahpromos_rate_limit_base_delay_ms',
  'yeahpromos_rate_limit_max_delay_ms',
  'yeahpromos_marketplace_templates_json',
  'partnerboost_products_page_size',
  'partnerboost_products_page',
  'partnerboost_products_default_filter',
  'partnerboost_products_country_code',
  'partnerboost_products_brand_id',
  'partnerboost_products_sort',
  'partnerboost_products_asins',
  'partnerboost_products_relationship',
  'partnerboost_products_is_original_currency',
  'partnerboost_products_has_promo_code',
  'partnerboost_products_has_acc',
  'partnerboost_products_filter_sexual_wellness',
  'partnerboost_products_link_batch_size',
  'partnerboost_asin_link_batch_size',
  'partnerboost_request_delay_ms',
  'partnerboost_rate_limit_max_retries',
  'partnerboost_rate_limit_base_delay_ms',
  'partnerboost_rate_limit_max_delay_ms',
  'partnerboost_link_country_code',
  'partnerboost_link_uid',
  'partnerboost_link_return_partnerboost_link',
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_bot_name',
  'feishu_app_secret_file',
  'feishu_domain',
  'feishu_dm_policy',
  'feishu_group_policy',
  'feishu_allow_from',
  'feishu_group_allow_from',
  'feishu_require_mention',
  'feishu_history_limit',
  'feishu_dm_history_limit',
  'feishu_streaming',
  'feishu_block_streaming',
  'feishu_config_writes',
  'feishu_text_chunk_limit',
  'feishu_chunk_mode',
  'feishu_markdown_tables',
  'feishu_media_max_mb',
  'feishu_response_prefix',
  'feishu_auth_mode',
  'feishu_require_tenant_key',
  'feishu_strict_auto_bind',
  'feishu_groups_json',
  'feishu_accounts_json',
  'feishu_target',
  'feishu_doc_folder_token',
  'feishu_doc_title_prefix',
  'feishu_bitable_app_token',
  'feishu_bitable_table_id',
  'feishu_bitable_table_name',
  'openclaw_strategy_enabled',
  'openclaw_strategy_cron',
  'gateway_auth_rate_limit_json',
  'gateway_tools_json',
])

const GLOBAL_SYNC_KEYS = new Set([
  'ai_models_json',
  'openclaw_models_mode',
  'openclaw_models_bedrock_discovery_json',
])

const USER_SYNC_KEYS = new Set([
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_bot_name',
  'feishu_app_secret_file',
  'feishu_domain',
  'feishu_dm_policy',
  'feishu_group_policy',
  'feishu_allow_from',
  'feishu_group_allow_from',
  'feishu_require_mention',
  'feishu_history_limit',
  'feishu_dm_history_limit',
  'feishu_streaming',
  'feishu_block_streaming',
  'feishu_config_writes',
  'feishu_text_chunk_limit',
  'feishu_chunk_mode',
  'feishu_markdown_tables',
  'feishu_media_max_mb',
  'feishu_response_prefix',
  'feishu_auth_mode',
  'feishu_require_tenant_key',
  'feishu_strict_auto_bind',
  'feishu_groups_json',
  'feishu_accounts_json',
  'gateway_auth_rate_limit_json',
  'gateway_tools_json',
])

const ALL_ALLOWED_KEYS = new Set([
  ...Array.from(USER_SCOPED_KEYS),
  ...Array.from(GLOBAL_AI_KEYS),
])

const STRATEGY_KEYS = new Set([
  'openclaw_strategy_enabled',
  'openclaw_strategy_cron',
])

const updateSchema = z.object({
  scope: z.enum(['user', 'global']).default('user'),
  updates: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    })
  ),
})

function validateMergedStrategySettings(settingMap: Record<string, string>): string | null {
  const cronExpr = String(settingMap.openclaw_strategy_cron || '0 9 * * *').trim() || '0 9 * * *'
  if (!cron.validate(cronExpr)) {
    return '策略 Cron 表达式无效，请使用标准 5 段 Cron'
  }

  return null
}

export async function GET(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const userSettings = (await getUserOnlySettingsByCategory('openclaw', auth.user.userId))
    .filter(setting => USER_SCOPED_KEYS.has(setting.key))
  const globalAiSettings = (await getSettingsByCategory('openclaw'))
    .filter(setting => GLOBAL_AI_KEYS.has(setting.key))

  return NextResponse.json({
    success: true,
    isAdmin: auth.user.role === 'admin',
    userId: auth.user.userId,
    user: [...userSettings, ...globalAiSettings],
  })
}

export async function PUT(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => null)
  const parsed = updateSchema.safeParse(body || {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    )
  }

  const { updates, scope } = parsed.data

  const invalidKey = updates.find(item => !ALL_ALLOWED_KEYS.has(item.key))
  if (invalidKey) {
    return NextResponse.json({ error: `不允许修改配置: ${invalidKey.key}` }, { status: 400 })
  }

  const globalUpdates = updates.filter(item => GLOBAL_AI_KEYS.has(item.key))
  const userUpdates = updates.filter(item => USER_SCOPED_KEYS.has(item.key))

  if (scope === 'global' && userUpdates.length > 0) {
    return NextResponse.json({ error: '全局保存仅允许 AI 引擎配置' }, { status: 400 })
  }

  if (scope === 'user' && globalUpdates.length > 0) {
    return NextResponse.json({ error: '用户保存不允许包含全局 AI 配置' }, { status: 400 })
  }

  if (globalUpdates.length > 0 && auth.user.role !== 'admin') {
    return NextResponse.json({ error: '仅管理员可修改全局 AI 配置' }, { status: 403 })
  }

  if (scope === 'user') {
    const strategyUpdates = userUpdates.filter(item => STRATEGY_KEYS.has(item.key))
    if (strategyUpdates.length > 0) {
      const existingUserSettings = await getUserOnlySettingsByCategory('openclaw', auth.user.userId)
      const mergedStrategyMap = existingUserSettings.reduce<Record<string, string>>((acc, item) => {
        acc[item.key] = item.value || ''
        return acc
      }, {})
      for (const item of strategyUpdates) {
        mergedStrategyMap[item.key] = item.value
      }
      const strategyError = validateMergedStrategySettings(mergedStrategyMap)
      if (strategyError) {
        return NextResponse.json({ error: strategyError }, { status: 400 })
      }
    }
  }

  const templateSettings = await getSettingsByCategory('openclaw')
  const templateKeySet = new Set(templateSettings.map((setting) => setting.key))
  const filteredGlobalUpdates = globalUpdates.filter(item => templateKeySet.has(item.key))
  const filteredUserUpdates = userUpdates.filter(item => templateKeySet.has(item.key))
  const skippedKeys = Array.from(new Set(
    updates
      .filter(item => !templateKeySet.has(item.key))
      .map(item => item.key)
  ))

  if (skippedKeys.length > 0) {
    console.warn('⚠️ OpenClaw配置模板缺失，已跳过保存键:', skippedKeys)
  }

  if (filteredGlobalUpdates.length > 0) {
    await updateSettings(
      filteredGlobalUpdates.map(item => ({ category: 'openclaw', key: item.key, value: item.value }))
    )
  }

  if (filteredUserUpdates.length > 0) {
    await updateSettings(
      filteredUserUpdates.map(item => ({ category: 'openclaw', key: item.key, value: item.value })),
      auth.user.userId
    )
  }

  const appliedUpdates = [...filteredGlobalUpdates, ...filteredUserUpdates]
  let aiAuthOverrideWarnings: ReturnType<typeof auditOpenclawAiAuthOverrides> = []
  if (appliedUpdates.length > 0) {
    try {
      const { syncOpenclawConfig } = await import('@/lib/openclaw/config')
      const hasGlobalSync = appliedUpdates.some(item => GLOBAL_SYNC_KEYS.has(item.key))
      const hasUserSync = appliedUpdates.some(item => USER_SYNC_KEYS.has(item.key))
      const reason = hasGlobalSync
        ? 'openclaw-global-ai-settings'
        : hasUserSync
          ? 'openclaw-user-settings'
          : 'openclaw-user-settings-nonsync'

      const syncResult = await syncOpenclawConfig(
        hasGlobalSync
          ? { reason }
          : { reason, actorUserId: auth.user.userId }
      )

      if (hasGlobalSync) {
        aiAuthOverrideWarnings = auditOpenclawAiAuthOverrides({
          config: syncResult?.config,
          configPath: syncResult?.configPath,
        })
      }
    } catch (error) {
      console.error('❌ OpenClaw配置同步失败:', error)
    }
  }

  return NextResponse.json({
    success: true,
    skippedKeys,
    aiAuthOverrideWarnings,
  })
}
