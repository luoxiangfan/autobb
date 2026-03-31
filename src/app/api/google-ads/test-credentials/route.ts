import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { deleteGoogleAdsTestCredentials, getGoogleAdsTestCredentialStatus } from '@/lib/google-ads-test-credentials'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/google-ads/test-credentials
 * 获取 Google Ads 测试OAuth凭证状态（不影响现有 OAuth 用户授权）
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const status = await getGoogleAdsTestCredentialStatus(authResult.user.userId)
    return NextResponse.json({ success: true, data: status })
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取测试凭证状态失败', message: error.message || '未知错误' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/google-ads/test-credentials
 * 清除 Google Ads 测试OAuth凭证（方案3：撤销/停用 + 清空测试 token 字段 + 删除 test_* 配置）
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const db = await getDatabase()

    // 1) 尝试撤销测试 Refresh Token（最佳努力，不影响本地清理）
    try {
      const row = await db.queryOne<{ refresh_token?: string | null }>(
        `SELECT refresh_token FROM google_ads_test_credentials WHERE user_id = ?`,
        [userId]
      )
      const refreshToken = row?.refresh_token || ''
      if (refreshToken.trim()) {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${encodeURIComponent(refreshToken)}`,
        })
      }
    } catch (err) {
      console.warn('撤销测试 Refresh Token 失败（将继续清理本地凭证）:', err)
    }

    // 2) 清空/停用测试OAuth凭证（google_ads_test_credentials）
    await deleteGoogleAdsTestCredentials(userId)

    // 3) 删除 Settings 页保存的测试配置（system_settings 的用户实例）
    // 注意：必须限定 user_id = ?，避免误删全局模板记录(user_id IS NULL)
    const keysToClear = ['test_login_customer_id', 'test_client_id', 'test_client_secret', 'test_developer_token']
    const placeholders = keysToClear.map(() => '?').join(', ')
    await db.exec(
      `
        DELETE FROM system_settings
        WHERE user_id = ?
          AND category = 'google_ads'
          AND key IN (${placeholders})
      `,
      [userId, ...keysToClear]
    )

    return NextResponse.json({ success: true, message: '测试 OAuth 授权与测试配置已清除' })
  } catch (error: any) {
    return NextResponse.json(
      { error: '清除测试凭证失败', message: error.message || '未知错误' },
      { status: 500 }
    )
  }
}
