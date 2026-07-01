import { pageMetadata } from '@/lib/common/server'

// 强制动态渲染，避免静态生成时的 Context 错误
export const dynamic = 'force-dynamic'

// 登录页SEO metadata
export const metadata = pageMetadata.login

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
