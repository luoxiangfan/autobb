/**
 * Test-only: routes use verifyAuth (cookie). Unit tests often pass x-user-id for convenience.
 * This setup maps those headers to a successful verifyAuth when tests do not override the mock.
 * withAuth is re-wrapped so it uses the same mocked verifyAuth (importOriginal alone does not).
 */
import { vi } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()

  const verifyAuth = vi.fn(async (request: NextRequest) => {
    const token = request.cookies.get('auth_token')?.value
    if (token) {
      return actual.verifyAuth(request)
    }

    const headerId = request.headers.get('x-user-id')
    if (!headerId) {
      return {
        authenticated: false,
        user: null,
        error: '未提供认证token',
      }
    }

    const userId = parseInt(headerId, 10)
    if (!Number.isFinite(userId) || userId <= 0) {
      return {
        authenticated: false,
        user: null,
        error: '未授权',
      }
    }

    const role = request.headers.get('x-user-role') || 'user'
    return {
      authenticated: true,
      user: {
        userId,
        email: 'test@example.com',
        role,
        packageType: 'pro',
      },
    }
  })

  const withAuth: typeof actual.withAuth = (handler, options) => {
    return async (
      request: NextRequest,
      routeContext?: { params?: Promise<Record<string, string>> }
    ) => {
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

      try {
        return await handler(request, authResult.user, context)
      } catch (error: any) {
        console.error('API处理错误:', error)
        return NextResponse.json({ error: error.message || '服务器内部错误' }, { status: 500 })
      }
    }
  }

  const withOptionalAuth: typeof actual.withOptionalAuth = (handler) => {
    return async (
      request: NextRequest,
      routeContext?: { params?: Promise<Record<string, string>> }
    ) => {
      const { NextResponse } = await import('next/server')

      const authResult = await verifyAuth(request)
      const user = authResult.authenticated && authResult.user ? authResult.user : null

      const resolvedParams = routeContext?.params ? await routeContext.params : undefined
      const context = resolvedParams ? { params: resolvedParams } : undefined

      try {
        return await handler(request, user, context)
      } catch (error: any) {
        console.error('API处理错误:', error)
        return NextResponse.json({ error: error.message || '服务器内部错误' }, { status: 500 })
      }
    }
  }

  return {
    ...actual,
    verifyAuth,
    withAuth,
    withOptionalAuth,
  }
})
