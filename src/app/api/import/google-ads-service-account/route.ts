import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { assertUserCanModifyGoogleAdsAuth } from '@/lib/google-ads/auth/assignment'
import {
  googleAdsServiceAccountBackupImportSchema,
  importGoogleAdsServiceAccountFromBackup,
  isGoogleAdsServiceAccountBackupValidationError,
  isGoogleAdsServiceAccountBackupConflictError,
} from '@/lib/google-ads/service-account/backup'

export const dynamic = 'force-dynamic'

/**
 * POST /api/import/google-ads-service-account
 * 从专用备份文件恢复 Google Ads 服务账号配置
 */
export const POST = withAuth(async (request, user) => {
  try {
    const userId = user.userId

    try {
      await assertUserCanModifyGoogleAdsAuth(userId, userId, user.role)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '无法导入服务账号配置'
      return NextResponse.json({ error: message }, { status: 403 })
    }

    const body = await request.json()
    const validationResult = googleAdsServiceAccountBackupImportSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: '无效的服务账号备份文件格式',
          details: validationResult.error.issues,
        },
        { status: 400 }
      )
    }

    try {
      const { serviceAccountId } = await importGoogleAdsServiceAccountFromBackup(
        userId,
        validationResult.data
      )

      return NextResponse.json({
        success: true,
        message: '服务账号配置已导入',
        data: { serviceAccountId },
      })
    } catch (error: unknown) {
      if (isGoogleAdsServiceAccountBackupConflictError(error)) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }
      if (isGoogleAdsServiceAccountBackupValidationError(error)) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      const message = error instanceof Error ? error.message : '导入服务账号配置失败'
      return NextResponse.json({ error: message }, { status: 400 })
    }
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: '无效的服务账号备份文件格式', details: error.issues },
        { status: 400 }
      )
    }
    console.error('导入服务账号配置失败:', error)
    const message = error instanceof Error ? error.message : '导入失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
})
