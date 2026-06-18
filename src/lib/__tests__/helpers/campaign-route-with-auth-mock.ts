import { vi } from 'vitest'
import type { NextRequest } from 'next/server'

type MockVerifyAuth = (request: NextRequest) => Promise<{
  authenticated: boolean
  user: { userId: number; role?: string; email?: string; packageType?: string } | null
  error?: string
}>

type AuthenticatedHandler = (
  request: NextRequest,
  user: NonNullable<Awaited<ReturnType<MockVerifyAuth>>['user']>,
  context?: { params?: Record<string, string> }
) => Promise<Response>

/** Wrap a route handler like production withAuth, driven by a mocked verifyAuth. */
export function buildWithAuthFromVerifyAuth(
  verifyAuth: MockVerifyAuth,
  handler: AuthenticatedHandler,
  options?: { requireAdmin?: boolean }
) {
  return async (
    request: NextRequest,
    routeContext?: { params?: Promise<Record<string, string>> }
  ): Promise<Response> => {
    const { NextResponse } = await import('next/server')

    const authResult = await verifyAuth(request)

    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }

    if (options?.requireAdmin && authResult.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const resolvedParams = routeContext?.params ? await routeContext.params : undefined
    const context = resolvedParams ? { params: resolvedParams } : undefined

    return handler(request, authResult.user, context)
  }
}

export function createWithAuthMock(verifyAuth: MockVerifyAuth) {
  return (handler: AuthenticatedHandler, options?: { requireAdmin?: boolean }) =>
    buildWithAuthFromVerifyAuth(verifyAuth, handler, options)
}

/** Use inside vi.hoisted(() => createCampaignAuthMocks()) so withAuth is available when vi.mock runs. */
export function createCampaignAuthMocks() {
  const verifyAuth = vi.fn<MockVerifyAuth>()
  const withAuth = (handler: AuthenticatedHandler, options?: { requireAdmin?: boolean }) =>
    buildWithAuthFromVerifyAuth(verifyAuth, handler, options)
  return { verifyAuth, withAuth }
}
