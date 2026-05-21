/**
 * Test-only: routes use verifyAuth (cookie). Unit tests often pass x-user-id for convenience.
 * This setup maps those headers to a successful verifyAuth when tests do not override the mock.
 */
import { vi } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return {
    ...actual,
    verifyAuth: vi.fn(async (request: NextRequest) => {
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
    }),
  }
})
