'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, ArrowRight, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchWithRetry } from '@/lib/api-error-handler'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [securityWarning, setSecurityWarning] = useState<string | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    let cancelled = false

    const checkAuthAndRedirect = async () => {
      try {
        const result = await fetchWithRetry<{ user?: { mustChangePassword?: boolean } }>(
          '/api/auth/me',
          {
            credentials: 'include',
            cache: 'no-store',
          },
          { maxRetries: 1, retryDelay: 500 }
        )

        if (result.success) {
          const redirect = searchParams?.get('redirect')
          const target = redirect && redirect !== '/login' ? redirect : '/dashboard'
          router.replace(target)
          return
        }
      } catch {
        // Keep user on login page when auth check fails.
      }

      if (!cancelled) {
        setCheckingSession(false)
      }
    }

    checkAuthAndRedirect()

    return () => {
      cancelled = true
    }
  }, [router, searchParams])

  useEffect(() => {
    const errorParam = searchParams?.get('error')
    if (errorParam) {
      setError(decodeURIComponent(errorParam))
    }

    const warningParam = searchParams?.get('security_warning')
    if (warningParam === 'true') {
      setSecurityWarning('检测到您的账户存在异常登录活动，请确认是否为本人操作。如非本人操作，建议立即修改密码。')
    }
  }, [searchParams])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await fetchWithRetry<{
        user?: { mustChangePassword?: boolean }
        error?: string
      }>(
        '/api/auth/login',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, password }),
        },
        { maxRetries: 2, retryDelay: 600 }
      )

      if (!result.success) {
        throw new Error(result.userMessage)
      }

      const data = result.data

      if (data.user && data.user.mustChangePassword) {
        router.push('/change-password?forced=true')
        return
      }

      const redirect = searchParams?.get('redirect')
      router.push(redirect || '/dashboard')
    } catch (err: any) {
      setError(err.message || '登录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    )
  }

  return (
    <div className="marketing-shell min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-100 selection:text-slate-900">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200/80 bg-white/92 backdrop-blur-sm">
      </header>

      <main className="overflow-x-clip">
        <section>
          <div className="mx-auto flex justify-center items-center w-auto max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:px-8 lg:py-20">
            <div className="rounded-[28px] md:w-1/2 max-w-full border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-900/10 sm:p-8">
              <div className="mb-6 space-y-2">
                <h2 className="font-display text-3xl font-bold tracking-tight text-slate-950">欢迎回来</h2>
                <p className="text-base text-slate-600">请输入账号信息，登录 AutoAds 控制台。</p>
              </div>

              {error && (
                <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600 animate-in fade-in slide-in-from-top-2">
                  <div className="rounded-full bg-red-100 p-1">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  {error}
                </div>
              )}

              {securityWarning && (
                <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 animate-in fade-in slide-in-from-top-2">
                  <div className="mt-0.5 rounded-full bg-amber-100 p-1">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="mb-1 font-medium">安全提醒</div>
                    <div className="text-amber-700">{securityWarning}</div>
                  </div>
                </div>
              )}

              <form className="space-y-6" onSubmit={handleLogin}>
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="username" className="text-sm font-medium text-slate-800">
                      用户名 / 邮箱
                    </Label>
                    <Input
                      id="username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      required
                      placeholder="name@company.com"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="h-12 rounded-xl border-slate-300 bg-white px-4 text-base"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-sm font-medium text-slate-800">
                        密码
                      </Label>
                      <span className="text-sm text-slate-500">忘记密码请联系管理员</span>
                    </div>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-12 rounded-xl border-slate-300 bg-white px-4 text-base"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="h-12 w-full rounded-full bg-blue-700 text-base font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      登录中...
                    </>
                  ) : (
                    <>
                      账号登录
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </>
                  )}
                </Button>
              </form>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
