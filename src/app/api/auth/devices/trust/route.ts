import { NextRequest, NextResponse } from 'next/server'
import { withAuth, AuthenticatedHandler } from '@/lib/auth'
import { trustDevice, untrustDevice, generateDeviceFingerprint } from '@/lib/user-sessions'

/**
 * POST /api/auth/devices/trust
 * 信任当前设备
 * Body: { deviceName?: string }
 */
const trustHandler: AuthenticatedHandler = async (request, user) => {
  const body = await request.json()
  const { deviceName } = body

  // 获取当前设备的指纹
  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
                    request.headers.get('x-real-ip') ||
                    'unknown'
  const userAgent = request.headers.get('user-agent') || 'unknown'

  const deviceFingerprint = generateDeviceFingerprint(userAgent, ipAddress)

  const id = await trustDevice(user.userId, deviceFingerprint, deviceName)

  return NextResponse.json({
    success: true,
    message: '设备已信任',
    trustedDevice: {
      id,
      deviceFingerprint,
      deviceName,
    },
  })
}

/**
 * DELETE /api/auth/devices/trust
 * 取消信任特定设备
 * Body: { deviceFingerprint: string }
 */
const untrustHandler: AuthenticatedHandler = async (request, user) => {
  const body = await request.json()
  const { deviceFingerprint } = body

  if (!deviceFingerprint) {
    return NextResponse.json(
      { error: '请提供 deviceFingerprint' },
      { status: 400 }
    )
  }

  const success = await untrustDevice(user.userId, deviceFingerprint)

  if (success) {
    return NextResponse.json({
      success: true,
      message: '设备已取消信任',
    })
  }

  return NextResponse.json(
    { error: '设备不存在或已被取消信任' },
    { status: 404 }
  )
}

export const POST = withAuth(trustHandler)
export const DELETE = withAuth(untrustHandler)
