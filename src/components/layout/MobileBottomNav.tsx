'use client'

import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Package,
  Boxes,
  Megaphone,
  Lightbulb,
  Bot,
  Settings,
  TrendingUp,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

interface MobileBottomNavUser {
  openclawEnabled?: boolean
  productManagementEnabled?: boolean
  strategyCenterEnabled?: boolean
}

const mainNavItems: NavItem[] = [
  { label: '仪表盘', href: '/dashboard', icon: LayoutDashboard },
  { label: '商品', href: '/products', icon: Boxes },
  { label: 'Offer', href: '/offers', icon: Package },
  { label: '广告', href: '/campaigns', icon: Megaphone },
  { label: '创意', href: '/creatives', icon: Lightbulb },
  { label: 'OpenClaw', href: '/openclaw', icon: Bot },
  { label: '策略', href: '/strategy-center', icon: TrendingUp },
  { label: '设置', href: '/settings', icon: Settings },
]

export function MobileBottomNav({ user }: { user?: MobileBottomNavUser }) {
  const pathname = usePathname()
  const router = useRouter()

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard'
    }
    return pathname?.startsWith(href) || false
  }

  const filteredMainNavItems = mainNavItems.filter(item => {
    if (item.href === '/openclaw') {
      return Boolean(user?.openclawEnabled)
    }
    if (item.href === '/products') {
      return Boolean(user?.productManagementEnabled)
    }
    if (item.href === '/strategy-center') {
      return Boolean(user?.strategyCenterEnabled)
    }
    return true
  })
  // 只显示前7个最重要的导航项
  const visibleItems = filteredMainNavItems.slice(0, 7)

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50">
      {/* 背景模糊效果 */}
      <div className="absolute inset-0 bg-white/90 backdrop-blur-lg border-t border-slate-200" />

      {/* 导航项 */}
      <div className="relative flex items-center justify-around h-16">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)

          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={`
                flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-all duration-200
                ${active
                  ? 'text-blue-600'
                  : 'text-slate-500 hover:text-slate-700'
                }
              `}
            >
              <Icon className={`w-5 h-5 ${active ? 'scale-110' : ''}`} />
              <span className={`text-[10px] font-medium ${active ? 'text-blue-600' : ''}`}>
                {item.label}
              </span>
              {active && (
                <span className="absolute bottom-0 w-1 h-1 rounded-full bg-blue-600" />
              )}
            </button>
          )
        })}
      </div>

      {/* 安全区域适配（iPhone底部） */}
      <div className="h-safe-area-bottom bg-white" />
    </div>
  )
}
