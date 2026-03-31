import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

/**
 * 401未授权错误处理器钩子
 *
 * 使用方法:
 * ```typescript
 * const handleUnauthorized = useHandleUnauthorized()
 *
 * // 在API调用后检查401
 * if (response.status === 401) {
 *   handleUnauthorized()
 *   return
 * }
 * ```
 */
export function useHandleUnauthorized() {
  const router = useRouter()

  return useCallback(() => {
    // 清除无效的cookie
    if (typeof document !== 'undefined') {
      document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    }
    // 跳转到登录页，保留当前路径用于登录后跳转回来
    const redirectUrl = encodeURIComponent(
      typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'
    )
    router.push(`/login?redirect=${redirectUrl}`)
  }, [router])
}

/**
 * 检查响应是否为401未授权错误
 *
 * @param response Fetch响应对象
 * @returns 如果是401错误返回true，否则返回false
 */
export function isUnauthorized(response: Response): boolean {
  return response.status === 401
}

/**
 * 通用API调用函数，自动处理401重定向
 *
 * 使用方法:
 * ```typescript
 * const data = await apiFetch('/api/some/endpoint', {
 *   credentials: 'include',
 * })
 * ```
 */
export async function apiFetch(
  url: string,
  options: RequestInit = {},
  onUnauthorized?: () => void
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
  })

  if (response.status === 401) {
    // 清除无效的cookie
    if (typeof document !== 'undefined') {
      document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    }
    // 调用回调或跳转到登录页
    if (onUnauthorized) {
      onUnauthorized()
    } else {
      const redirectUrl = encodeURIComponent(
        typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'
      )
      window.location.href = `/login?redirect=${redirectUrl}`
    }
    throw new Error('UNAUTHORIZED')
  }

  return response
}
