/**
 * SEO Metadata Configuration - P2-1优化
 * 统一管理网站SEO信息，确保品牌一致性
 */

import { Metadata } from 'next'

/**
 * 基础SEO配置
 */
export const baseSEO = {
  siteName: 'AutoAds',
  siteUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  locale: 'zh_CN',
  author: 'AutoAds Team',
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
}

/**
 * OpenGraph图片配置
 * 注意: 建议创建专门的 og-image.png (1200x630px) 用于社交媒体分享
 * 当前使用 logo.png 作为临时方案
 */
export const ogImage = {
  url: '/logo.png', // 临时使用logo，建议替换为 /og-image.png (1200x630)
  width: 1200,
  height: 630,
  alt: 'AutoAds - Google Ads AI广告自动化投放系统',
}

/**
 * 生成页面metadata的工具函数
 */
export function generateMetadata({
  title,
  description,
  path = '',
  keywords = [],
  ogImage: customOgImage,
  noIndex = false,
}: {
  title: string
  description: string
  path?: string
  keywords?: string[]
  ogImage?: { url: string; width: number; height: number; alt: string }
  noIndex?: boolean
}): Metadata {
  const url = `${baseSEO.siteUrl}${path}`
  const fullTitle = `${title} | AutoAds`
  const image = customOgImage || ogImage

  return {
    title: fullTitle,
    description,
    keywords: [...baseSEO.keywords, ...keywords],
    authors: [{ name: baseSEO.author }],
    creator: baseSEO.siteName,
    publisher: baseSEO.siteName,
    metadataBase: new URL(baseSEO.siteUrl),
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: baseSEO.siteName,
      images: [image],
      locale: baseSEO.locale,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [image.url],
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
        }
      : {
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
  }
}

/**
 * 预定义页面metadata
 */
export const pageMetadata = {
  // 首页
  home: generateMetadata({
    title: 'Google Ads快速测试和一键优化营销平台',
    description:
      'AutoAds - AI驱动的Google Ads自动化投放平台。自动生成高质量广告文案、获取真实Keyword Planner数据、数据驱动持续优化、构建"印钞机"增长飞轮。适合BB新人和独立工作室，最大化投放ROI。',
    path: '/',
  }),

  // 登录页
  login: generateMetadata({
    title: '登录',
    description: '登录AutoAds账户，开始使用AI驱动的Google Ads自动化投放平台',
    path: '/login',
    noIndex: true, // 登录页不需要索引
  }),

  // Dashboard
  dashboard: generateMetadata({
    title: '仪表盘',
    description:
      '查看广告系列表现概况、KPI指标、风险提示和优化建议。实时监控Google Ads投放效果，数据驱动优化决策。',
    path: '/dashboard',
    keywords: ['广告数据分析', 'KPI监控', '投放效果', '数据可视化'],
    noIndex: true, // 内部页面不需要索引
  }),

  // Offers管理
  offers: generateMetadata({
    title: 'Offer管理',
    description:
      '集中管理所有推广Offer。创建、编辑、批量导入Offer信息，一键生成AI广告创意，快速启动Google Ads投放。',
    path: '/offers',
    keywords: ['Offer管理', '批量导入', 'AI广告创意', '快速投放'],
    noIndex: true,
  }),

  // 创建Offer
  offersNew: generateMetadata({
    title: '创建Offer',
    description:
      '创建新的推广Offer，填写品牌信息、目标国家、落地页URL，获取AI投放评分和优化建议。',
    path: '/offers/new',
    keywords: ['创建Offer', '投放评分', 'Launch Score'],
    noIndex: true,
  }),

  // 批量导入Offer
  offersBatch: generateMetadata({
    title: '批量导入Offer',
    description: '通过CSV批量导入Offer信息，快速创建多个推广项目，提升工作效率。',
    path: '/offers/batch',
    keywords: ['批量导入', 'CSV导入', '批量创建'],
    noIndex: true,
  }),

  // 广告系列
  campaigns: generateMetadata({
    title: '广告系列',
    description:
      '查看所有Google Ads广告系列，监控投放效果，调整预算和出价策略，优化广告表现。',
    path: '/campaigns',
    keywords: ['广告系列管理', 'Google Ads', '投放优化', 'CPC调整'],
    noIndex: true,
  }),

  // 广告创意
  creatives: generateMetadata({
    title: '广告创意',
    description:
      'AI自动生成高质量广告创意。查看、编辑、评分广告文案，确保广告内容吸引目标受众。',
    path: '/creatives',
    keywords: ['AI广告文案', '广告创意', '创意评分', '文案优化'],
    noIndex: true,
  }),

  // Launch Score
  launchScore: generateMetadata({
    title: '投放评分',
    description:
      '5维度投放评分系统。评估关键词质量、市场契合度、着陆页优化、预算合理性、内容质量，提供专业优化建议。',
    path: '/launch-score',
    keywords: ['投放评分', 'Launch Score', '关键词评分', '着陆页优化', '预算评估'],
    noIndex: true,
  }),

  // 数据管理
  dataManagement: generateMetadata({
    title: '数据管理',
    description:
      '管理Google Ads数据同步、数据导出、数据备份。确保数据安全，支持数据分析和报表生成。',
    path: '/data-management',
    keywords: ['数据同步', '数据导出', '数据备份', 'Google Ads API'],
    noIndex: true,
  }),

  // Google Ads账号管理
  googleAdsSettings: generateMetadata({
    title: 'Google Ads账号管理',
    description:
      '管理Google Ads账号、查看关联的Offer、监控账户状态。支持MCC管理账户和子账户。',
    path: '/google-ads',
    keywords: ['Google Ads账号', 'MCC账户', '账号管理', '关联Offer'],
    noIndex: true,
  }),

  // 完成Google Ads设置
  googleAdsCompleteSetup: generateMetadata({
    title: '完成Google Ads设置',
    description: '完成Google Ads账号授权和配置，开始使用AutoAds自动化投放功能。',
    path: '/google-ads/complete-setup',
    noIndex: true,
  }),

  // 设置
  settings: generateMetadata({
    title: '设置',
    description: '管理账户设置、通知偏好、集成配置等。个性化您的AutoAds使用体验。',
    path: '/settings',
    keywords: ['账户设置', '通知设置', '偏好配置'],
    noIndex: true,
  }),

  // 管理后台 - 用户管理
  adminUsers: generateMetadata({
    title: '用户管理',
    description: '管理员专用：查看所有用户、管理用户权限、监控用户活动。',
    path: '/admin/users',
    noIndex: true, // 管理后台不需要索引
  }),

  // 管理后台 - 备份
  adminBackups: generateMetadata({
    title: '数据备份',
    description: '管理员专用：管理数据库备份、恢复数据、查看备份历史。',
    path: '/admin/backups',
    noIndex: true,
  }),
}

/**
 * 获取页面metadata的快捷函数
 */
export function getPageMetadata(pageKey: keyof typeof pageMetadata): Metadata {
  return pageMetadata[pageKey]
}
