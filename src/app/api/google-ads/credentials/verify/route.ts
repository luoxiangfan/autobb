import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { verifyGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { autoDetectAndUpdateAccessLevel } from '@/lib/google-ads-access-level-detector'
import { getUserAuthType } from '@/lib/google-ads-oauth'

/**
 * POST /api/google-ads/credentials/verify
 * 验证Google Ads凭证是否有效
 */
export async function POST(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    console.log(`🔍 验证Google Ads凭证`)
    console.log(`   用户: ${authResult.user.email}`)

    // 验证凭证
    const result = await verifyGoogleAdsCredentials(authResult.user.userId)

    if (result.valid) {
      console.log(`✅ Google Ads凭证有效`)
      if (result.customer_id) {
        console.log(`   Customer ID: ${result.customer_id}`)
      }

      // 🆕 自动检测并更新API访问级别
      try {
        const auth = await getUserAuthType(authResult.user.userId)
        const accessLevel = await autoDetectAndUpdateAccessLevel(
          authResult.user.userId,
          auth.authType
        )
        console.log(`   检测到API访问级别: ${accessLevel}`)
      } catch (detectError) {
        console.warn('自动检测API访问级别失败:', detectError)
        // 不影响验证结果
      }

      // 🔧 修复(2025-12-11): snake_case → camelCase
      return NextResponse.json({
        success: true,
        message: 'Google Ads凭证有效',
        data: {
          valid: true,
          customerId: result.customer_id
        }
      })
    } else {
      console.log(`❌ Google Ads凭证无效`)
      console.log(`   错误: ${result.error}`)

      return NextResponse.json({
        success: false,
        message: 'Google Ads凭证无效',
        data: {
          valid: false,
          error: result.error
        }
      }, { status: 400 })
    }

  } catch (error: any) {
    console.error('验证Google Ads凭证失败:', error)

    return NextResponse.json(
      {
        error: '验证Google Ads凭证失败',
        message: error.message || '未知错误'
      },
      { status: 500 }
    )
  }
}
