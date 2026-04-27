'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import {
  Activity,
  LayoutDashboard,
  Package,
  Boxes,
  Megaphone,
  Lightbulb,
  Rocket,
  Settings,
  Users,
  Database,
  LogOut,
  Menu,
  X,
  ChevronDown,
  User as UserIcon,
  Shield,
  Key,
  Link2,
  Beaker,
  TrendingUp,
  FileText,
  Clock,
  Zap,
  RefreshCw,
  Bot,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'

// 动态导入模态框组件，实现代码分割
const UserProfileModal = dynamic(
  () => import('./AppLayoutModals').then(mod => mod.UserProfileModal),
  { ssr: false }
)

const ChangePasswordModal = dynamic(
  () => import('./AppLayoutModals').then(mod => mod.ChangePasswordModal),
  { ssr: false }
)

// 移动端底部导航（动态导入以减小主包体积）
const MobileBottomNav = dynamic(
  () => import('./MobileBottomNav').then(mod => mod.MobileBottomNav),
  { ssr: false }
)

// 套餐类型中文映射
const PACKAGE_TYPE_MAP: Record<string, string> = {
  trial: '试用版',
  annual: '年卡',
  lifetime: '长期会员',
  enterprise: '私有化部署',
}

// 角色中文映射
const ROLE_MAP: Record<string, string> = {
  admin: '管理员',
  user: '普通用户',
}

interface UserInfo {
  id: number
  email: string
  username?: string
  displayName: string | null
  role: string
  packageType: string
  openclawEnabled?: boolean
  productManagementEnabled?: boolean
  strategyCenterEnabled?: boolean
}

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  requireAdmin?: boolean
}

interface SidebarLinkProps {
  href: string
  className: string
  title?: string
  useNextLink: boolean
  onIntentPrefetch?: (href: string) => void
  children: React.ReactNode
}

function SidebarLink({
  href,
  className,
  title,
  useNextLink,
  onIntentPrefetch,
  children,
}: SidebarLinkProps) {
  if (useNextLink) {
    const handleIntent = () => {
      onIntentPrefetch?.(href)
    }

    return (
      <Link
        href={href}
        prefetch={false}
        onMouseEnter={handleIntent}
        onFocus={handleIntent}
        className={className}
        title={title}
      >
        {children}
      </Link>
    )
  }

  return (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  )
}

const collapsibleNavigationHrefs = new Set(['/data-management', '/analytics/roi', '/analytics/budget', '/openclaw'])

const navigationItems: NavItem[] = [
  {
    label: '仪表盘',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: '商品管理',
    href: '/products',
    icon: Boxes,
  },
  {
    label: 'Offer管理',
    href: '/offers',
    icon: Package,
  },
  // {
  //   label: '已解除关联的Offer',
  //   href: '/unlinked-offers',
  //   icon: Package,
  // },
  {
    label: '广告系列',
    href: '/campaigns',
    icon: Megaphone,
  },
  {
    label: '广告系列备份',
    href: '/campaign-backups',
    icon: Megaphone,
  },
  {
    label: '最近14天新增广告系列',
    href: '/recent-14-days-campaigns',
    icon: Megaphone,
  },
  {
    label: '创意管理',
    href: '/creatives',
    icon: Lightbulb,
  },
  // {
  //   label: '投放评分',
  //   href: '/launch-score',
  //   icon: Rocket,
  // },
  {
    label: 'Google Ads账号',
    href: '/google-ads',
    icon: Link2,
  },
  {
    label: '数据管理',
    href: '/data-management',
    icon: Database,
  },
  {
    label: 'ROI分析',
    href: '/analytics/roi',
    icon: TrendingUp,
  },
  {
    label: '预算分析',
    href: '/analytics/budget',
    icon: Activity,
  },
  {
    label: 'OpenClaw',
    href: '/openclaw',
    icon: Bot,
  },
  {
    label: '策略中心',
    href: '/strategy-center',
    icon: TrendingUp,
  },
  {
    label: '补点击任务',
    href: '/click-farm',
    icon: Zap,
  },
  {
    label: '换链接任务',
    href: '/url-swap',
    icon: Link2,
  },
  {
    label: '系统设置',
    href: '/settings',
    icon: Settings,
  },
]

function filterNavigationItemsByUser(items: NavItem[], user: UserInfo): NavItem[] {
  return items.filter(item => {
    if (item.href === '/openclaw') {
      return Boolean(user.openclawEnabled)
    }
    if (item.href === '/products') {
      return Boolean(user.productManagementEnabled)
    }
    if (item.href === '/strategy-center') {
      return Boolean(user.strategyCenterEnabled)
    }
    return true
  })
}

const adminNavigationItems: NavItem[] = [
  {
    label: '用户管理',
    href: '/admin/users',
    icon: Users,
    requireAdmin: true,
  },
  {
    label: 'MCC分配',
    href: '/admin/mcc-assignment',
    icon: Users,
    requireAdmin: true,
  },
  {
    label: '备份与定时任务',
    href: '/admin/backups',
    icon: Clock,
    requireAdmin: true,
  },
  {
    label: '队列配置与监控',
    href: '/admin/queue',
    icon: TrendingUp,
    requireAdmin: true,
  },
  {
    label: '性能监控',
    href: '/admin/performance',
    icon: Activity,
    requireAdmin: true,
  },
  // {
  //   label: '抓取与AI测试',
  //   href: '/admin/scrape-test',
  //   icon: Beaker,
  //   requireAdmin: true,
  // },
  {
    label: 'Prompt管理',
    href: '/admin/prompts',
    icon: FileText,
    requireAdmin: true,
  },
  {
    label: '补点击管理',
    href: '/admin/click-farm',
    icon: Zap,
    requireAdmin: true,
  },
  {
    label: '换链接管理',
    href: '/admin/url-swap',
    icon: RefreshCw,
    requireAdmin: true,
  },
]

// 全局用户缓存，避免重复请求
let cachedUser: UserInfo | null = null
let cacheTimestamp: number = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5分钟缓存

export default function AppLayout({
  children,
  navLinkEnabled = false,
}: {
  children: React.ReactNode
  navLinkEnabled?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<UserInfo | null>(cachedUser)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [advancedNavOpen, setAdvancedNavOpen] = useState(() =>
    Array.from(collapsibleNavigationHrefs).some(href => pathname?.startsWith(href))
  )
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [loading, setLoading] = useState(!cachedUser)
  const fetchingRef = useRef(false)
  const prefetchedNavHrefsRef = useRef(new Set<string>())

  const prefetchNavLinkByIntent = (href: string) => {
    if (!navLinkEnabled) return
    if (prefetchedNavHrefsRef.current.has(href)) return

    prefetchedNavHrefsRef.current.add(href)
    router.prefetch(href)
  }

  useEffect(() => {
    // 如果已有缓存且未过期，直接使用
    const now = Date.now()
    if (cachedUser && (now - cacheTimestamp) < CACHE_DURATION) {
      setUser(cachedUser)
      setLoading(false)
      return
    }

    // 避免重复请求
    if (fetchingRef.current) return
    fetchUserInfo()
  }, [])

  const fetchUserInfo = async () => {
    // 防止并发请求
    if (fetchingRef.current) return
    fetchingRef.current = true

    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
        cache: 'no-store', // 禁用 Next.js 自动缓存
      })

      if (!response.ok) {
        cachedUser = null
        cacheTimestamp = 0
        router.push('/login')
        return
      }

      const data = await response.json()
      // 更新缓存
      cachedUser = data.user
      cacheTimestamp = Date.now()
      setUser(data.user)
    } catch (err) {
      cachedUser = null
      cacheTimestamp = 0
      router.push('/login')
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }

  // 提供刷新用户信息的方法（用于登出后清除缓存）
  const clearUserCache = () => {
    cachedUser = null
    cacheTimestamp = 0
  }

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })

      // 清除用户缓存（无论API是否成功）
      clearUserCache()
      setUser(null)

      if (response.ok) {
        toast.success('已退出登录')
      } else {
        // API失败时也要退出，因为可能是token已失效
        console.warn('Logout API returned error, but proceeding with logout')
      }

      // 使用 replace 防止用户后退回到需要登录的页面
      router.replace('/login')
    } catch (err) {
      console.error('Logout error:', err)
      // 即使API调用失败，也清除本地状态并跳转
      clearUserCache()
      setUser(null)
      toast.error('退出登录时发生错误')
      router.replace('/login')
    }
  }

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard'
    }
    return pathname?.startsWith(href) || false
  }

  useEffect(() => {
    const hasActiveCollapsibleRoute = Array.from(collapsibleNavigationHrefs).some(href => pathname?.startsWith(href))
    if (hasActiveCollapsibleRoute) {
      setAdvancedNavOpen(true)
    }
  }, [pathname])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
      </div>
    )
  }

  if (!user) return null

  const filteredNavigationItems = filterNavigationItemsByUser(navigationItems, user)
  const mainNavigationItems = filteredNavigationItems.filter(item => !collapsibleNavigationHrefs.has(item.href))
  const advancedNavigationItems = filteredNavigationItems.filter(item => collapsibleNavigationHrefs.has(item.href))

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-900 lg:pb-0 pb-16">
      {/* 桌面端顶部Header - 移动端隐藏 */}
      <div className="hidden lg:flex h-16 items-center justify-between px-4 border-b border-slate-200 bg-white/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <h1 className="font-bold text-xl bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            AutoAds
          </h1>
        </div>
        <div className="flex items-center gap-4">
          {/* 用户信息（侧边栏收起时显示） */}
          {!sidebarOpen && user && (
            <button
              onClick={() => setProfileModalOpen(true)}
              className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white">
                <UserIcon className="w-4 h-4" />
              </div>
              <span className="text-sm text-slate-700">{user.username || user.email}</span>
            </button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-slate-400 hover:text-slate-600"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>
      </div>

      {/* 桌面端侧边栏 - 移动端隐藏 */}
      <aside
        className={`
          hidden lg:block fixed top-0 left-0 h-full bg-white/80 backdrop-blur-xl border-r border-slate-200/60 z-40 transition-all duration-300 shadow-sm
          ${sidebarOpen ? 'w-56' : 'w-20'}
        `}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 mb-2">
          {sidebarOpen && (
            <h1 className="font-bold text-2xl bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent tracking-tight">
              AutoAds
            </h1>
          )}
        </div>

        {/* User Info - Clickable */}
        <div className="px-3 mb-6">
          <button
            onClick={() => setProfileModalOpen(true)}
            className={`
              w-full flex items-center gap-3 p-2 rounded-xl transition-all duration-200
              ${sidebarOpen ? 'bg-slate-50 hover:bg-slate-100 border border-slate-100' : 'justify-center hover:bg-slate-50'}
            `}
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-200">
              <UserIcon className="w-5 h-5" />
            </div>
            {sidebarOpen && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {user.displayName || user.username || user.email}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <p className="text-xs text-slate-500 font-medium">{user.packageType}</p>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-400" />
              </>
            )}
          </button>
        </div>

        {/* Navigation */}
        <nav className="px-3 space-y-1 flex-1 overflow-y-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          {sidebarOpen && (
            <div className="px-3 py-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Main Menu
              </span>
            </div>
          )}
          {mainNavigationItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)

            return (
              <SidebarLink
                key={item.href}
                href={item.href}
                useNextLink={navLinkEnabled}
                onIntentPrefetch={prefetchNavLinkByIntent}
                className={`
                  group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
                  ${active
                    ? 'bg-blue-50/80 text-blue-600 font-medium shadow-sm shadow-blue-100/50'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                  }
                  ${!sidebarOpen && 'justify-center'}
                `}
                title={!sidebarOpen ? item.label : undefined}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 transition-colors ${active ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                {sidebarOpen && <span className="text-sm">{item.label}</span>}
                {sidebarOpen && active && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-600" />
                )}
              </SidebarLink>
            )
          })}

          {sidebarOpen && advancedNavigationItems.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setAdvancedNavOpen(prev => !prev)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-all duration-200"
                aria-expanded={advancedNavOpen}
              >
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  数据与扩展
                </span>
                <ChevronDown
                  className={`
                    w-4 h-4 text-slate-400 transition-transform duration-200
                    ${advancedNavOpen ? 'rotate-180' : ''}
                  `}
                />
              </button>

              {advancedNavOpen && (
                <div className="mt-1 space-y-1">
                  {advancedNavigationItems.map((item) => {
                    const Icon = item.icon
                    const active = isActive(item.href)

                    return (
                      <SidebarLink
                        key={item.href}
                        href={item.href}
                        useNextLink={navLinkEnabled}
                        onIntentPrefetch={prefetchNavLinkByIntent}
                        className={`
                          group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
                          ${active
                            ? 'bg-blue-50/80 text-blue-600 font-medium shadow-sm shadow-blue-100/50'
                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                          }
                        `}
                      >
                        <Icon className={`w-5 h-5 flex-shrink-0 transition-colors ${active ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                        <span className="text-sm">{item.label}</span>
                        {active && (
                          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-600" />
                        )}
                      </SidebarLink>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* 管理员功能区 - 仅管理员可见 */}
          {user.role === 'admin' && (
            <>
              {sidebarOpen && (
                <div className="px-3 py-2 mt-6">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Shield className="w-3 h-3" />
                    Admin
                  </span>
                </div>
              )}
              {!sidebarOpen && (
                <div className="my-3 border-t border-slate-100" />
              )}
              {adminNavigationItems.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)

                return (
                  <SidebarLink
                    key={item.href}
                    href={item.href}
                    useNextLink={navLinkEnabled}
                    onIntentPrefetch={prefetchNavLinkByIntent}
                    className={`
                      group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
                      ${active
                        ? 'bg-purple-50/80 text-purple-600 font-medium shadow-sm shadow-purple-100/50'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                      }
                      ${!sidebarOpen && 'justify-center'}
                    `}
                    title={!sidebarOpen ? item.label : undefined}
                  >
                    <Icon className={`w-5 h-5 flex-shrink-0 transition-colors ${active ? 'text-purple-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                    {sidebarOpen && <span className="text-sm">{item.label}</span>}
                  </SidebarLink>
                )
              })}
            </>
          )}
        </nav>

        {/* Logout Button */}
        <div className="p-3 border-t border-slate-100 bg-slate-50/50">
          <Button
            variant="ghost"
            onClick={handleLogout}
            className={`
              w-full flex items-center gap-3 text-slate-500 hover:text-red-600 hover:bg-red-50/50 transition-colors
              ${!sidebarOpen && 'justify-center'}
            `}
          >
            <LogOut className="w-5 h-5" />
            {sidebarOpen && <span className="font-medium">退出登录</span>}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className={`
          transition-all duration-300 min-h-screen
          lg:pt-0 pt-16
          ${sidebarOpen ? 'lg:ml-56 lg:pb-0 pb-16' : 'lg:ml-20 lg:pb-0 pb-16'}
        `}
      >
        {children}
      </main>

      {/* 移动端底部导航 */}
      <MobileBottomNav user={user} />

      {/* 动态导入的模态框组件 */}
      {user && (
        <UserProfileModal
          open={profileModalOpen}
          onOpenChange={setProfileModalOpen}
          user={user}
          onOpenPasswordModal={() => setPasswordModalOpen(true)}
          onLogout={() => {
            setProfileModalOpen(false)
            handleLogout()
          }}
        />
      )}

      <ChangePasswordModal
        open={passwordModalOpen}
        onOpenChange={setPasswordModalOpen}
      />
    </div>
  )
}
