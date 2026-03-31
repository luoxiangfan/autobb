import type { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { verifyOpenclawGatewayToken } from '@/lib/openclaw/auth'
import { verifyOpenclawUserToken } from '@/lib/openclaw/tokens'
import { resolveOpenclawUserFromBinding } from '@/lib/openclaw/bindings'
import { hasPackageExpired } from '@/lib/user-execution-eligibility'

type ResolvedUser = {
  userId: number
  authType: 'session' | 'user-token' | 'gateway-binding'
}

export type ResolveOpenclawRequestUserContext = {
  channel?: string | null
  senderId?: string | null
  accountId?: string | null
  tenantKey?: string | null
}

export type OpenclawSessionAuthResult =
  | {
      authenticated: true
      user: {
        userId: number
        email: string
        role: string
        packageType: string
      }
    }
  | {
      authenticated: false
      status: 401 | 403
      error: string
    }

type UserFeatureAccessFlags = {
  isActive: boolean
  openclawEnabled: boolean
  productManagementEnabled: boolean
  strategyCenterEnabled: boolean
}

async function getUserFeatureAccessFlags(userId: number): Promise<UserFeatureAccessFlags | null> {
  const db = await getDatabase()
  const user = await db.queryOne<{
    openclaw_enabled: boolean | number
    product_management_enabled?: boolean | number
    strategy_center_enabled?: boolean | number
    is_active: boolean | number
    package_expires_at: string | null
  }>(
    'SELECT openclaw_enabled, product_management_enabled, strategy_center_enabled, is_active, package_expires_at FROM users WHERE id = ?',
    [userId]
  )
  if (!user) return null

  const isActive = (user.is_active as any) === true || (user.is_active as any) === 1
  if (!isActive || hasPackageExpired(user.package_expires_at, new Date(), { invalidAsExpired: true })) {
    return {
      isActive: false,
      openclawEnabled: false,
      productManagementEnabled: false,
      strategyCenterEnabled: false,
    }
  }

  const openclawEnabled = (user.openclaw_enabled as any) === true || (user.openclaw_enabled as any) === 1
  const productManagementEnabled = (user.product_management_enabled as any) === true || (user.product_management_enabled as any) === 1
  const strategyCenterEnabled = (user.strategy_center_enabled as any) === true || (user.strategy_center_enabled as any) === 1

  return {
    isActive: true,
    openclawEnabled,
    productManagementEnabled,
    strategyCenterEnabled,
  }
}

export async function isOpenclawEnabledForUser(userId: number): Promise<boolean> {
  const flags = await getUserFeatureAccessFlags(userId)
  if (!flags || !flags.isActive) return false
  return flags.openclawEnabled
}

export async function isProductManagementEnabledForUser(userId: number): Promise<boolean> {
  const flags = await getUserFeatureAccessFlags(userId)
  if (!flags || !flags.isActive) return false
  return flags.productManagementEnabled
}

export async function isStrategyCenterEnabledForUser(userId: number): Promise<boolean> {
  const flags = await getUserFeatureAccessFlags(userId)
  if (!flags || !flags.isActive) return false
  return flags.strategyCenterEnabled
}

export async function verifyOpenclawSessionAuth(
  request: NextRequest
): Promise<OpenclawSessionAuthResult> {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || !auth.user) {
    return {
      authenticated: false,
      status: 401,
      error: auth.error || '未授权',
    }
  }

  const openclawEnabled = await isOpenclawEnabledForUser(auth.user.userId)
  if (!openclawEnabled) {
    return {
      authenticated: false,
      status: 403,
      error: 'OpenClaw 功能未开启',
    }
  }

  return {
    authenticated: true,
    user: auth.user,
  }
}

export async function verifyStrategyCenterSessionAuth(
  request: NextRequest
): Promise<OpenclawSessionAuthResult> {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || !auth.user) {
    return {
      authenticated: false,
      status: 401,
      error: auth.error || '未授权',
    }
  }

  const strategyCenterEnabled = await isStrategyCenterEnabledForUser(auth.user.userId)
  if (!strategyCenterEnabled) {
    return {
      authenticated: false,
      status: 403,
      error: '策略中心功能未开启',
    }
  }

  return {
    authenticated: true,
    user: auth.user,
  }
}

export async function verifyProductManagementSessionAuth(
  request: NextRequest
): Promise<OpenclawSessionAuthResult> {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || !auth.user) {
    return {
      authenticated: false,
      status: 401,
      error: auth.error || '未授权',
    }
  }

  const productManagementEnabled = await isProductManagementEnabledForUser(auth.user.userId)
  if (!productManagementEnabled) {
    return {
      authenticated: false,
      status: 403,
      error: '商品管理功能未开启',
    }
  }

  return {
    authenticated: true,
    user: auth.user,
  }
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const value = authHeader.trim()
  if (!value) return null
  if (value.toLowerCase().startsWith('bearer ')) {
    return value.slice(7).trim()
  }
  return value
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (normalized) {
      return normalized
    }
  }
  return null
}

export async function resolveOpenclawRequestUser(
  request: NextRequest,
  context: ResolveOpenclawRequestUserContext = {}
): Promise<ResolvedUser | null> {
  const auth = await verifyAuth(request)
  if (auth.authenticated && auth.user) {
    const openclawEnabled = await isOpenclawEnabledForUser(auth.user.userId)
    if (!openclawEnabled) {
      return null
    }
    return { userId: auth.user.userId, authType: 'session' }
  }

  const token = extractBearerToken(request.headers.get('authorization'))
  if (!token) return null

  if (await verifyOpenclawGatewayToken(token)) {
    const channel = firstNonEmpty(context.channel, request.headers.get('x-openclaw-channel'))
    const senderId = firstNonEmpty(
      context.senderId,
      request.headers.get('x-openclaw-sender'),
      request.headers.get('x-openclaw-sender-id'),
      request.headers.get('x-openclaw-sender-open-id')
    )
    const accountId = firstNonEmpty(context.accountId, request.headers.get('x-openclaw-account-id'))
    const tenantKey = firstNonEmpty(context.tenantKey, request.headers.get('x-openclaw-tenant-key'))
    const userId = await resolveOpenclawUserFromBinding(channel, senderId, { accountId, tenantKey })
    if (!userId) return null
    const openclawEnabled = await isOpenclawEnabledForUser(userId)
    if (!openclawEnabled) {
      return null
    }
    return { userId, authType: 'gateway-binding' }
  }

  const tokenRecord = await verifyOpenclawUserToken(token)
  if (!tokenRecord) return null
  const openclawEnabled = await isOpenclawEnabledForUser(tokenRecord.user_id)
  if (!openclawEnabled) {
    return null
  }
  return { userId: tokenRecord.user_id, authType: 'user-token' }
}

export async function resolveStrategyCenterRequestUser(
  request: NextRequest,
  context: ResolveOpenclawRequestUserContext = {}
): Promise<ResolvedUser | null> {
  const auth = await verifyAuth(request)
  if (auth.authenticated && auth.user) {
    const strategyCenterEnabled = await isStrategyCenterEnabledForUser(auth.user.userId)
    if (!strategyCenterEnabled) {
      return null
    }
    return { userId: auth.user.userId, authType: 'session' }
  }

  const token = extractBearerToken(request.headers.get('authorization'))
  if (!token) return null

  if (await verifyOpenclawGatewayToken(token)) {
    const channel = firstNonEmpty(context.channel, request.headers.get('x-openclaw-channel'))
    const senderId = firstNonEmpty(
      context.senderId,
      request.headers.get('x-openclaw-sender'),
      request.headers.get('x-openclaw-sender-id'),
      request.headers.get('x-openclaw-sender-open-id')
    )
    const accountId = firstNonEmpty(context.accountId, request.headers.get('x-openclaw-account-id'))
    const tenantKey = firstNonEmpty(context.tenantKey, request.headers.get('x-openclaw-tenant-key'))
    const userId = await resolveOpenclawUserFromBinding(channel, senderId, { accountId, tenantKey })
    if (!userId) return null
    const strategyCenterEnabled = await isStrategyCenterEnabledForUser(userId)
    if (!strategyCenterEnabled) {
      return null
    }
    return { userId, authType: 'gateway-binding' }
  }

  const tokenRecord = await verifyOpenclawUserToken(token)
  if (!tokenRecord) return null
  const strategyCenterEnabled = await isStrategyCenterEnabledForUser(tokenRecord.user_id)
  if (!strategyCenterEnabled) {
    return null
  }
  return { userId: tokenRecord.user_id, authType: 'user-token' }
}
