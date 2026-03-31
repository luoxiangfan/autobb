import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { ToasterProvider } from '@/components/ToasterProvider'
import FrontendErrorReporter from '@/components/monitoring/FrontendErrorReporter'
import WebVitalsReporter from '@/components/monitoring/WebVitalsReporter'
import { getPerformanceReleaseSnapshot, isPerformanceReleaseEnabled } from '@/lib/feature-flags'
import './globals.css'

// ⚡ P0性能优化: 移除全局force-dynamic，按需在各页面单独设置
// 这允许静态页面（如登录页、文档页）使用Next.js静态优化
// 实时数据页面（dashboard、offers等）在各自的page.tsx中设置dynamic='force-dynamic'

const bodyFont = localFont({
  src: [
    {
      path: './fonts/NotoSansLatin-Regular.ttf',
      weight: '400',
      style: 'normal',
    },
  ],
  variable: '--font-body',
  display: 'swap',
})
const webVitalsMonitoringEnabled = isPerformanceReleaseEnabled('webVitalsMonitoring')
const frontendErrorMonitoringEnabled = isPerformanceReleaseEnabled('frontendErrorMonitoring')
const buildId = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_BUILD_ID || 'local').slice(0, 64)
const flagSnapshot = (() => {
  const snapshot = getPerformanceReleaseSnapshot()
  const enabledMap: Record<string, boolean> = {}
  for (const [flagName, flagValue] of Object.entries(snapshot)) {
    enabledMap[flagName] = flagValue.enabled
  }
  return JSON.stringify(enabledMap)
})()

export const metadata: Metadata = {
  // P0-4: SEO优化 - 更精准的标题和描述
  title: 'AutoAds - Google Ads快速测试和一键优化营销平台 | AI自动生成高质量广告文案',
  description: 'AutoAds - AI驱动的Google Ads自动化投放平台。自动生成高质量广告文案、获取真实Keyword Planner数据、数据驱动持续优化、构建"印钞机"增长飞轮。适合BB新人和独立工作室，最大化投放ROI。',
  keywords: [
    'Google Ads',
    'Google Ads自动化',
    'AI广告文案',
    '广告自动化投放',
    'ROI优化',
    'Google Keyword Planner',
    '关键词规划',
    '广告效果优化',
    'AI营销',
    '联盟营销',
    'Affiliate Marketing',
    'BB推广',
    '印钞机组合',
    '增长飞轮',
  ],
  authors: [{ name: 'AutoAds Team' }],
  creator: 'AutoAds',
  publisher: 'AutoAds',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  openGraph: {
    title: 'AutoAds - Google Ads AI广告自动化投放系统',
    description: '自动化Offer管理、AI广告文案生成、真实关键词数据、增长飞轮，最大化投放ROI',
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    siteName: 'AutoAds',
    images: [
      {
        url: '/assets/marketing/hero-demo.png', // P2-1: 使用 Hero Demo 作为 OG 图片
        width: 1200,
        height: 630,
        alt: 'AutoAds - Google Ads AI广告自动化投放系统',
      },
    ],
    locale: 'zh_CN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AutoAds - Google Ads AI广告自动化投放系统',
    description: '自动化Offer管理、AI广告文案生成、真实关键词数据，最大化投放ROI',
    images: ['/assets/marketing/hero-demo.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/logo-icon.svg',
    shortcut: '/logo-icon.svg',
    apple: '/logo-icon.svg', // iOS usually prefers PNG, but SVG might work in some contexts or fallback
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body className={`${bodyFont.variable} font-body`}>
        {children}
        <ToasterProvider />
        {webVitalsMonitoringEnabled ? <WebVitalsReporter enabled={true} buildId={buildId} flagSnapshot={flagSnapshot} /> : null}
        {frontendErrorMonitoringEnabled ? <FrontendErrorReporter enabled={true} buildId={buildId} flagSnapshot={flagSnapshot} /> : null}
      </body>
    </html>
  )
}
