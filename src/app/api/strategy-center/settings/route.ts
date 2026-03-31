import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import cron from 'node-cron'
import { getSettingsByCategory, getUserOnlySettingsByCategory, updateSettings } from '@/lib/settings'
import { verifyStrategyCenterSessionAuth } from '@/lib/openclaw/request-auth'

const STRATEGY_CENTER_USER_KEYS = new Set([
  'openclaw_strategy_enabled',
  'openclaw_strategy_cron',
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_app_secret_file',
  'feishu_target',
  'feishu_accounts_json',
  'feishu_domain',
  'feishu_bot_name',
  'feishu_auth_mode',
  'feishu_require_tenant_key',
  'feishu_strict_auto_bind',
])

const STRATEGY_KEYS = new Set([
  'openclaw_strategy_enabled',
  'openclaw_strategy_cron',
])

const updateSchema = z.object({
  updates: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    })
  ),
})

function parseJsonStringArray(value: string | undefined): string[] {
  const raw = String(value || '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(item => String(item || '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function resolveFeishuPersonalIdFromTarget(value: string | undefined): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const normalized = raw
    .replace(/^(feishu|lark):/i, '')
    .replace(/^(open_id|union_id):/i, '')
    .replace(/^(user|dm|chat|group):/i, '')
    .trim()

  const lowered = normalized.toLowerCase()
  if (lowered.startsWith('ou_') || lowered.startsWith('on_')) {
    return normalized
  }

  return null
}

function validateMergedStrategySettings(settingMap: Record<string, string>): string | null {
  const cronExpr = String(settingMap.openclaw_strategy_cron || '0 9 * * *').trim() || '0 9 * * *'
  if (!cron.validate(cronExpr)) {
    return '策略 Cron 表达式无效，请使用标准 5 段 Cron'
  }

  return null
}

export async function GET(request: NextRequest) {
  const auth = await verifyStrategyCenterSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const settings = (await getUserOnlySettingsByCategory('openclaw', auth.user.userId))
    .filter(setting => STRATEGY_CENTER_USER_KEYS.has(setting.key))

  return NextResponse.json({
    success: true,
    userId: auth.user.userId,
    settings,
  })
}

export async function PUT(request: NextRequest) {
  const auth = await verifyStrategyCenterSessionAuth(request)
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

  const { updates } = parsed.data
  const invalidKey = updates.find(item => !STRATEGY_CENTER_USER_KEYS.has(item.key))
  if (invalidKey) {
    return NextResponse.json({ error: `不允许修改配置: ${invalidKey.key}` }, { status: 400 })
  }

  let existingSettings: Awaited<ReturnType<typeof getUserOnlySettingsByCategory>> | null = null
  const getExistingSettings = async () => {
    if (!existingSettings) {
      existingSettings = await getUserOnlySettingsByCategory('openclaw', auth.user.userId)
    }
    return existingSettings
  }

  const strategyUpdates = updates.filter(item => STRATEGY_KEYS.has(item.key))
  if (strategyUpdates.length > 0) {
    const currentSettings = await getExistingSettings()
    const mergedStrategyMap = currentSettings.reduce<Record<string, string>>((acc, item) => {
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

  const effectiveUpdates = [...updates]
  const targetUpdate = updates.find(item => item.key === 'feishu_target')
  if (targetUpdate) {
    const inferredFeishuId = resolveFeishuPersonalIdFromTarget(targetUpdate.value)
    if (inferredFeishuId) {
      const currentSettings = await getExistingSettings()
      const currentMap = currentSettings.reduce<Record<string, string>>((acc, item) => {
        acc[item.key] = String(item.value || '')
        return acc
      }, {})
      const existingAllowFrom = parseJsonStringArray(currentMap.feishu_allow_from)
      const mergedAllowFrom = Array.from(new Set([
        ...existingAllowFrom,
        inferredFeishuId,
      ]))

      effectiveUpdates.push({
        key: 'feishu_allow_from',
        value: JSON.stringify(mergedAllowFrom),
      })
      effectiveUpdates.push({
        key: 'feishu_dm_policy',
        value: 'allowlist',
      })
    }
  }

  const templateSettings = await getSettingsByCategory('openclaw')
  const templateKeySet = new Set(templateSettings.map((setting) => setting.key))
  const dedupedUpdates = Array.from(new Map(
    effectiveUpdates.map(item => [item.key, item])
  ).values())
  const filteredUpdates = dedupedUpdates.filter(item => templateKeySet.has(item.key))
  const skippedKeys = Array.from(new Set(
    dedupedUpdates
      .filter(item => !templateKeySet.has(item.key))
      .map(item => item.key)
  ))

  if (filteredUpdates.length > 0) {
    await updateSettings(
      filteredUpdates.map(item => ({ category: 'openclaw', key: item.key, value: item.value })),
      auth.user.userId
    )

    try {
      const { syncOpenclawConfig } = await import('@/lib/openclaw/config')
      await syncOpenclawConfig({
        reason: 'strategy-center-settings',
        actorUserId: auth.user.userId,
      })
    } catch (error) {
      console.error('❌ 策略中心配置同步失败:', error)
    }
  }

  return NextResponse.json({
    success: true,
    skippedKeys,
  })
}
