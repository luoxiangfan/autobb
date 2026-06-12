import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { assertUserCanModifyGoogleAdsAuth } from '@/lib/google-ads/auth/assignment'
import { getOwnServiceAccountConfigForBackup } from '@/lib/google-ads/service-account/service-account'
import { buildGoogleAdsServiceAccountBackupPayload } from '@/lib/google-ads/service-account/backup'

export const dynamic = 'force-dynamic'

/**
 * GET /api/export/google-ads-service-account
 * 导出当前用户自有的 Google Ads 服务账号配置（专用备份格式）
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId

    try {
      await assertUserCanModifyGoogleAdsAuth(userId, userId, authResult.user.role)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '无法导出服务账号配置'
      return NextResponse.json({ error: message }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const includeSensitive = searchParams.get('include_sensitive') === 'true'

    const account = await getOwnServiceAccountConfigForBackup(userId)
    if (!account) {
      return NextResponse.json({ error: '当前未配置 Google Ads 服务账号' }, { status: 404 })
    }

    if (!account.privateKey?.trim()) {
      return NextResponse.json({ error: '服务账号私钥不可用，无法导出备份' }, { status: 500 })
    }

    const exportPayload = buildGoogleAdsServiceAccountBackupPayload({
      userId,
      includeSensitive,
      account: {
        name: account.name,
        mccCustomerId: account.mccCustomerId,
        developerToken: account.developerToken,
        serviceAccountEmail: account.serviceAccountEmail,
        privateKey: account.privateKey,
        projectId: account.projectId ?? null,
        apiAccessLevel: account.apiAccessLevel,
      },
    })

    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="google_ads_service_account_${new Date().toISOString().split('T')[0]}.json"`,
      },
    })
  } catch (error: unknown) {
    console.error('导出服务账号配置失败:', error)
    const message = error instanceof Error ? error.message : '导出失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
