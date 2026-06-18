import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import {
  ConfigRequiredError,
  checkAffiliatePlatformConfig,
  createAffiliateProductSyncRun,
  getAffiliateProductById,
} from '@/lib/affiliate/products'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/gateway/request-auth'

export const POST = withAuth(async (request, user, context) => {
  try {
    const userId = user.userId

    const productManagementEnabled = await isProductManagementEnabledForUser(userId)
    if (!productManagementEnabled) {
      return NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 })
    }

    const productId = Number(context?.params?.id)
    if (!Number.isFinite(productId) || productId <= 0) {
      return NextResponse.json({ error: '无效的商品ID' }, { status: 400 })
    }

    const product = await getAffiliateProductById(userId, productId)
    if (!product) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 })
    }

    const configCheck = await checkAffiliatePlatformConfig(userId, product.platform)
    if (!configCheck.configured) {
      throw new ConfigRequiredError(product.platform, configCheck.missingKeys)
    }

    const runId = await createAffiliateProductSyncRun({
      userId,
      platform: product.platform,
      mode: 'single',
      triggerSource: 'manual',
      status: 'queued',
    })

    const queue = getQueueManagerForTaskType('affiliate-product-sync')
    const taskId = await queue.enqueue(
      'affiliate-product-sync',
      {
        userId,
        platform: product.platform,
        mode: 'single',
        runId,
        productId,
        trigger: 'manual',
      },
      userId,
      {
        priority: 'normal',
        maxRetries: 1,
        parentRequestId: request.headers.get('x-request-id') || undefined,
      }
    )

    return NextResponse.json({
      success: true,
      runId,
      taskId,
      message: '商品同步任务已提交',
    })
  } catch (error: any) {
    if (error instanceof ConfigRequiredError) {
      return NextResponse.json(
        {
          error: '请先在商品管理页完成联盟平台配置',
          code: error.code,
          platform: error.platform,
          missingKeys: error.missingKeys,
          redirect: '/products',
        },
        { status: 400 }
      )
    }

    console.error('[POST /api/products/:id/sync] failed:', error)
    return NextResponse.json({ error: error?.message || '提交同步任务失败' }, { status: 500 })
  }
})
