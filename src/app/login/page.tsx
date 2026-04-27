'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { Loader2, CheckCircle2, ArrowRight, ShieldCheck, Clock3, Target, MessageSquare } from 'lucide-react'
import { ConsultCustomerDialogTrigger } from '@/components/marketing/ConsultCustomerDialogTrigger'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Cloudflare Turnstile types
declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: any) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
      getResponse: (widgetId: string) => string
    }
  }
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCaptcha, setShowCaptcha] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const [securityWarning, setSecurityWarning] = useState<string | null>(null)
  const turnstileWidgetId = useRef<string | null>(null)
  const turnstileLoaded = useRef(false)

  // 检查CAPTCHA功能是否启用
  const captchaEnabled = process.env.NEXT_PUBLIC_CAPTCHA_ENABLED === 'true'

  useEffect(() => {
    const errorParam = searchParams?.get('error')
    if (errorParam) {
      setError(decodeURIComponent(errorParam))
    }

    // 检查是否有安全警告
    const warningParam = searchParams?.get('security_warning')
    if (warningParam === 'true') {
      setSecurityWarning('检测到您的账户存在异常登录活动，请确认是否为本人操作。如非本人操作，建议立即修改密码。')
    }
  }, [searchParams])

  // Load Cloudflare Turnstile script
  useEffect(() => {
    if (captchaEnabled && showCaptcha && !turnstileLoaded.current) {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
      script.async = true
      script.defer = true
      script.onload = () => {
        turnstileLoaded.current = true
        // 确保DOM已更新，使用setTimeout确保renderTurnstile在下一个事件循环执行
        setTimeout(renderTurnstile, 0)
      }
      script.onerror = () => {
        console.error('Failed to load Turnstile script')
        setError('验证码脚本加载失败，请刷新页面重试')
      }
      document.body.appendChild(script)
    }
  }, [captchaEnabled, showCaptcha])

  const renderTurnstile = () => {
    if (window.turnstile && !turnstileWidgetId.current) {
      const container = document.getElementById('turnstile-container')
      if (container) {
        try {
          turnstileWidgetId.current = window.turnstile.render(container, {
            sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
            callback: (token: string) => {
              setCaptchaToken(token)
              setCaptchaLoading(false)
            },
            'error-callback': () => {
              setCaptchaLoading(false)
              setError('验证码加载失败，请刷新页面重试')
            },
            theme: 'light',
          })
          setCaptchaLoading(false)
        } catch (err) {
          console.error('Failed to render Turnstile:', err)
          setCaptchaLoading(false)
          setError('验证码初始化失败，请刷新页面重试')
        }
      }
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const requestBody: { username: string; password: string; captchaToken?: string } = {
        username,
        password,
      }

      // 如果需要CAPTCHA，添加token
      if (showCaptcha && captchaToken) {
        requestBody.captchaToken = captchaToken
      }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const data = await response.json()

      if (!response.ok) {
        // 检查是否需要CAPTCHA
        if (data.errorType === 'captcha_required') {
          setShowCaptcha(true)
          setCaptchaLoading(true)
          setCaptchaToken(null)
          setError(data.error || '请完成验证码验证')
          // 不需要手动调用renderTurnstile，useEffect会自动处理
          // 当showCaptcha状态更新后，useEffect会检查脚本是否加载
          return
        }

        // CAPTCHA验证失败，重置widget
        if (data.errorType === 'captcha_invalid') {
          if (turnstileWidgetId.current && window.turnstile) {
            window.turnstile.reset(turnstileWidgetId.current)
          }
          setCaptchaToken(null)
        }

        throw new Error(data.error || '登录失败')
      }

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

  return (
    <div className="marketing-shell min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-100 selection:text-slate-900">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200/80 bg-white/92 backdrop-blur">
      </header>

      <main className="overflow-x-clip">
        <section>
          <div className="mx-auto flex justify-center items-center w-auto max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.05fr,0.95fr] lg:gap-14 lg:px-8 lg:py-20">
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
                      <Link href="/contact" className="text-sm font-medium text-blue-700 hover:text-blue-600">
                        忘记密码？
                      </Link>
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

                {showCaptcha && (
                  <div className="space-y-2">
                    <Label htmlFor="turnstile-container" className="text-sm font-medium text-slate-800">
                      安全验证
                    </Label>
                    <div className="relative">
                      <div
                        id="turnstile-container"
                        className="flex min-h-[65px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50"
                      />
                      {captchaLoading && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/60 backdrop-blur-sm">
                          <div className="flex flex-col items-center gap-2">
                            <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
                            <span className="text-xs text-slate-600">加载验证码...</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-start gap-2">
                      <p className="flex-1 text-xs text-slate-500">为了账户安全，请完成验证后继续登录</p>
                      {!captchaLoading && turnstileLoaded.current && !captchaToken && (
                        <button
                          type="button"
                          onClick={() => {
                            if (turnstileWidgetId.current && window.turnstile) {
                              window.turnstile.reset(turnstileWidgetId.current)
                            }
                          }}
                          className="shrink-0 whitespace-nowrap text-xs text-blue-700 hover:text-blue-600"
                        >
                          重新加载
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading || captchaLoading || (showCaptcha && !captchaToken)}
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
