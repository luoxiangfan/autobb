import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { assertUserCanModifyGoogleAdsAuth } from '@/lib/google-ads-auth-assignment'
import { verifyGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { autoDetectAndUpdateAccessLevel } from '@/lib/google-ads-access-level-detector'
import {
  getGoogleAdsAuthContext,
  resolveConfiguredGoogleAdsAuthType,
} from '@/lib/google-ads-auth-context'
import {
  logGoogleAdsVerifyDebug,
  logGoogleAdsVerifyError,
  logGoogleAdsVerifyInfo,
  logGoogleAdsVerifyWarn,
} from '@/lib/google-ads-auth-route-logger'

/**
 * POST /api/google-ads/credentials/verify
 * 验证Google Ads凭证是否有效
 */
export async function POST(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const userId = authResult.user.userId

    try {
      await assertUserCanModifyGoogleAdsAuth(userId, userId, authResult.user.role)
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    logGoogleAdsVerifyDebug('verify_started', { userId })

    const result = await verifyGoogleAdsCredentials(userId)

    if (result.valid) {
      logGoogleAdsVerifyInfo('verify_succeeded', {
        userId,
        authType: result.authType,
        customerId: result.customer_id,
      })

      try {
        const authContext = result.authContext ?? (await getGoogleAdsAuthContext(userId))
        const accessLevel = await autoDetectAndUpdateAccessLevel(
          userId,
          resolveConfiguredGoogleAdsAuthType(authContext)
        )
        logGoogleAdsVerifyDebug('access_level_detected', { userId, accessLevel })
      } catch (detectError) {
        logGoogleAdsVerifyWarn('access_level_detect_failed', detectError, { userId })
      }

      // 🔧 修复(2025-12-11): snake_case → camelCase
      return NextResponse.json({
        success: true,
        message: 'Google Ads凭证有效',
        data: {
          valid: true,
          customerId: result.customer_id,
        },
      })
    } else {
      logGoogleAdsVerifyInfo('verify_failed', {
        userId,
        authType: result.authType,
        error: result.error,
      })

      return NextResponse.json(
        {
          success: false,
          message: 'Google Ads凭证无效',
          data: {
            valid: false,
            error: result.error,
          },
        },
        { status: 400 }
      )
    }
  } catch (error: any) {
    logGoogleAdsVerifyError('verify_unhandled_error', error)

    return NextResponse.json(
      {
        error: '验证Google Ads凭证失败',
        message: error.message || '未知错误',
      },
      { status: 500 }
    )
  }
}
