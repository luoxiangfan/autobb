import { generateMetadata as createMetadata } from '@/lib/seo'

// 强制动态渲染
export const dynamic = 'force-dynamic'

// 修改密码页面的metadata
export const metadata = createMetadata({
  title: '修改密码',
  description: '修改您的账户密码',
  noIndex: true, // 不需要被搜索引擎索引
})

export default function ChangePasswordLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // 不使用AppLayout，避免显示侧边栏
  return <>{children}</>
}
