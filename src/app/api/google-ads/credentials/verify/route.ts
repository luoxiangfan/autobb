import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { verifyGoogleAdsCredentials } from '@/lib/google-ads/oauth/oauth'
import { autoDetectAndUpdateAccessLevel } from '@/lib/google-ads/settings/access-level-detector'
import {
  getGoogleAdsAuthContext,
  googleAdsAuthReadyFailureHttpStatus,
  googleAdsAuthReadyFailurePayload,
  resolveConfiguredGoogleAdsAuthType,
  resolveGoogleAdsAuthReadyFailure,
  getGoogleAdsAuthContextMetadata,
} from '@/lib/google-ads/auth/context'
import {
  logGoogleAdsVerifyDebug,
  logGoogleAdsVerifyError,
  logGoogleAdsVerifyInfo,
  logGoogleAdsVerifyWarn,
} from '@/lib/google-ads/auth/route-logger'

/**
 * POST /api/google-ads/credentials/verify
 * 验证Google Ads凭证是否有效
 */
export const POST = withAuth(async (_request, user) => {
  try {
    const userId = user.userId

    const metadataCtx = await getGoogleAdsAuthContextMetadata(userId)
    const authFailure = resolveGoogleAdsAuthReadyFailure(metadataCtx)
    if (authFailure) {
      return NextResponse.json(googleAdsAuthReadyFailurePayload(authFailure), {
        status: googleAdsAuthReadyFailureHttpStatus(authFailure.reason),
      })
    }

    logGoogleAdsVerifyDebug('verify_started', { userId, readOnly: !metadataCtx.canModify })

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
})
