import { NextResponse } from 'next/server'

const DEPRECATED_MESSAGE = '联盟配置已迁移到 /settings?category=affiliate_sync，请使用新入口。'

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: DEPRECATED_MESSAGE,
      code: 'ENDPOINT_DEPRECATED',
      redirectTo: '/settings?category=affiliate_sync',
    },
    { status: 410 }
  )
}

export async function PUT() {
  return NextResponse.json(
    {
      success: false,
      error: DEPRECATED_MESSAGE,
      code: 'ENDPOINT_DEPRECATED',
      redirectTo: '/settings?category=affiliate_sync',
    },
    { status: 410 }
  )
}
