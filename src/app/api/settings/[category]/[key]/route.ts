import { NextRequest, NextResponse } from 'next/server'
import { getSetting, getUserOnlySetting, updateSetting } from '@/lib/settings'
import { invalidateProxyPoolCache } from '@/lib/offer-utils'
import { z } from 'zod'

/**
 * GET /api/settings/:category/:key
 * 获取单个配置项
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { category: string; key: string } }
) {
  try {
    const { category, key } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    const userIdNum = userId ? parseInt(userId, 10) : undefined

    if (category === 'affiliate_sync' && !userIdNum) {
      return NextResponse.json(
        { error: '获取联盟同步配置需要登录' },
        { status: 401 }
      )
    }

    const setting = category === 'affiliate_sync' && userIdNum
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

    return NextResponse.json({
      success: true,
      setting: {
        category: setting.category,
        key: setting.key,
        value: setting.value,
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
  { params }: { params: { category: string; key: string } }
) {
  try {
    const { category, key } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    const userIdNum = userId ? parseInt(userId, 10) : undefined

    const body = await request.json()

    // 验证输入
    const validationResult = updateSettingSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.errors[0].message,
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { value } = validationResult.data

    if (category === 'affiliate_sync' && !userIdNum) {
      return NextResponse.json(
        { error: '更新联盟同步配置需要登录' },
        { status: 401 }
      )
    }

    // 更新配置
    await updateSetting(category, key, value, userIdNum)

    // 🔥 修复（2025-12-11）：如果更新了代理配置，清除代理池缓存
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
