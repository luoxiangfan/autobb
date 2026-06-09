import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getSetting, getUserOnlySetting, updateSetting } from '@/lib/settings'
import { invalidateProxyPoolCache } from '@/lib/offer-utils'
import { assertUserCanModifyGoogleAdsAuth } from '@/lib/google-ads-auth-assignment'
import {
  getGoogleAdsCredentialBackedSettingValue,
  isGoogleAdsCredentialBackedSettingKey,
  isGoogleAdsSettingsValidationError,
  upsertSingleGoogleAdsCredentialBackedSetting,
} from '@/lib/google-ads-settings-store'
import { z } from 'zod'

/**
 * GET /api/settings/:category/:key
 * 获取单个配置项
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ category: string; key: string }> }
) {
  const params = await props.params
  try {
    const { category, key } = params

    const authResult = await verifyAuth(request)
    const userIdNum =
      authResult.authenticated && authResult.user ? authResult.user.userId : undefined

    if (category === 'affiliate_sync' && !userIdNum) {
      return NextResponse.json({ error: '获取联盟同步配置需要登录' }, { status: 401 })
    }

    const setting =
      category === 'affiliate_sync' && userIdNum
        ? await getUserOnlySetting(category, key, userIdNum)
        : await getSetting(category, key, userIdNum)

    if (!setting) {
      return NextResponse.json(
        {
          error: `配置项不存在: ${category}.${key}`,
        },
        { status: 404 }
      )
    }

    let value = setting.value
    if (category === 'google_ads' && userIdNum && isGoogleAdsCredentialBackedSettingKey(key)) {
      const stored = await getGoogleAdsCredentialBackedSettingValue(userIdNum, key, {
        isSensitive: setting.isSensitive,
      })
      if (stored) {
        value = stored
      }
    }

    return NextResponse.json({
      success: true,
      setting: {
        category: setting.category,
        key: setting.key,
        value,
        dataType: setting.dataType,
        isSensitive: setting.isSensitive,
        isRequired: setting.isRequired,
        validationStatus: setting.validationStatus,
        validationMessage: setting.validationMessage,
        lastValidatedAt: setting.lastValidatedAt,
        description: setting.description,
      },
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

const updateSettingSchema = z.object({
  value: z.string(),
})

/**
 * PUT /api/settings/:category/:key
 * 更新单个配置项
 */
export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ category: string; key: string }> }
) {
  const params = await props.params
  try {
    const { category, key } = params

    const authResult = await verifyAuth(request)
    const userIdNum =
      authResult.authenticated && authResult.user ? authResult.user.userId : undefined

    const body = await request.json()

    const validationResult = updateSettingSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.issues[0].message,
          details: validationResult.error.issues,
        },
        { status: 400 }
      )
    }

    const { value } = validationResult.data

    if (category === 'affiliate_sync' && !userIdNum) {
      return NextResponse.json({ error: '更新联盟同步配置需要登录' }, { status: 401 })
    }

    if (category === 'google_ads' && isGoogleAdsCredentialBackedSettingKey(key)) {
      if (!userIdNum) {
        return NextResponse.json({ error: '更新 Google Ads OAuth 配置需要登录' }, { status: 401 })
      }

      try {
        await assertUserCanModifyGoogleAdsAuth(userIdNum, userIdNum, authResult.user!.role)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '无法修改 Google Ads 认证配置'
        return NextResponse.json({ error: message }, { status: 403 })
      }

      try {
        const syncResult = await upsertSingleGoogleAdsCredentialBackedSetting(
          userIdNum,
          key,
          value,
          { skipAuthContextInvalidate: true }
        )

        const { invalidateGoogleAdsAuthContextForCredentialUser } =
          await import('@/lib/google-ads-auth-context')
        await invalidateGoogleAdsAuthContextForCredentialUser(userIdNum)

        return NextResponse.json({
          success: true,
          message: `配置项 ${category}.${key} 更新成功`,
          ...(syncResult?.oauthClientCredentialsChanged ? { oauthReauthRequired: true } : {}),
        })
      } catch (saveError: unknown) {
        const message = saveError instanceof Error ? saveError.message : '保存 Google Ads 配置失败'
        const status = isGoogleAdsSettingsValidationError(saveError) ? 400 : 500
        return NextResponse.json({ error: message }, { status })
      }
    }

    await updateSetting(category, key, value, userIdNum)

    if (category === 'proxy') {
      console.log('🔄 检测到代理配置更新，清除代理池缓存')
      invalidateProxyPoolCache(userIdNum)
    }

    return NextResponse.json({
      success: true,
      message: `配置项 ${category}.${key} 更新成功`,
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
