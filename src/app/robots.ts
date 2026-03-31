/**
 * 动态生成robots.txt
 * P0-4: SEO优化 - 使用环境变量
 */

import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.autoads.dev'

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin/',
        '/dashboard/',
        '/offers/',
        '/campaigns/',
        '/settings/',
        '/creatives/',
        '/google-ads/',
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
