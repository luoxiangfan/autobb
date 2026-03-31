import AppLayout from '@/components/layout/AppLayout'
import { generateMetadata as createMetadata } from '@/lib/seo' // P2-1: SEO优化
import { isPerformanceReleaseEnabled } from '@/lib/feature-flags'

// 强制动态渲染，避免静态生成时的 Context 错误
export const dynamic = 'force-dynamic'

// P2-1: 应用内页面通用metadata
export const metadata = createMetadata({
  title: 'Dashboard',
  description: '管理您的Google Ads广告系列，查看投放效果，优化广告表现',
  noIndex: true, // 应用内页面不需要被搜索引擎索引
})

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const navLinkEnabled = isPerformanceReleaseEnabled('navLink')

  return <AppLayout navLinkEnabled={navLinkEnabled}>{children}</AppLayout>
}
