'use client'

/**
 * QuickActions - P2-4优化
 * Dashboard快速操作入口
 */

import { useRouter } from 'next/navigation'
import { Plus, Upload, AlertTriangle, FileText, Settings, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface QuickAction {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  href: string
  variant: 'default' | 'outline' | 'secondary'
  iconBg: string
  iconColor: string
}

const quickActions: QuickAction[] = [
  {
    id: 'create-offer',
    title: '创建Offer',
    description: '添加新的推广Offer',
    icon: <Plus className="w-5 h-5" />,
    href: '/offers?action=create',
    variant: 'default',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  {
    id: 'batch-import',
    title: '批量导入',
    description: '上传CSV批量创建Offer',
    icon: <Upload className="w-5 h-5" />,
    href: '/offers?action=import',
    variant: 'outline',
    iconBg: 'bg-green-100',
    iconColor: 'text-green-600',
  },
  {
    id: 'risk-alerts',
    title: '风险提示',
    description: '查看需要注意的问题',
    icon: <AlertTriangle className="w-5 h-5" />,
    href: '#risk-alerts',
    variant: 'outline',
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
  },
  {
    id: 'campaigns',
    title: '广告系列',
    description: '查看所有广告系列',
    icon: <FileText className="w-5 h-5" />,
    href: '/campaigns',
    variant: 'outline',
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600',
  },
  {
    id: 'google-ads',
    title: 'Google Ads账号',
    description: '管理Google Ads账号',
    icon: <Settings className="w-5 h-5" />,
    href: '/google-ads',
    variant: 'outline',
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-600',
  },
  {
    id: 'data-export',
    title: '导出数据',
    description: '下载Campaign报表',
    icon: <ExternalLink className="w-5 h-5" />,
    href: '#export',
    variant: 'outline',
    iconBg: 'bg-indigo-100',
    iconColor: 'text-indigo-600',
  },
]

export function QuickActions() {
  const router = useRouter()

  const handleAction = (action: QuickAction) => {
    if (action.href.startsWith('#')) {
      // 页内锚点导航
      const element = document.querySelector(action.href.replace('#', '[data-section="') + '"]')
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    } else {
      // 路由导航
      router.push(action.href)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>快速操作</span>
          <span className="text-sm font-normal text-muted-foreground">(常用功能入口)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {quickActions.map((action) => (
            <button
              key={action.id}
              onClick={() => handleAction(action)}
              className="flex flex-col items-center gap-2 p-3 rounded-lg border border-gray-200 hover:border-primary hover:bg-accent transition-all text-center group h-full"
            >
              {/* Icon */}
              <div className={`p-2 rounded-lg ${action.iconBg} group-hover:scale-110 transition-transform`}>
                <div className={action.iconColor}>
                  {action.icon}
                </div>
              </div>

              {/* Content */}
              <div className="w-full min-w-0">
                <h3 className="font-semibold text-xs mb-0.5 group-hover:text-primary transition-colors truncate">
                  {action.title}
                </h3>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
