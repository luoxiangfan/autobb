/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  productionBrowserSourceMaps: false,
  compress: true,

  images: {
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 60,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },

  serverExternalPackages: [
    'better-sqlite3',
    'cheerio',
    'postgres',
    'playwright',
    'playwright-core',
    '@crawlee/playwright',
    '@crawlee/browser',
    '@crawlee/browser-pool',
    '@crawlee/core',
    '@crawlee/utils',
    '@crawlee/types',
    'fingerprint-generator',
    'fingerprint-injector',
    'header-generator',
  ],

  // Next.js 16 默认 Turbopack；显式声明以允许保留 webpack 回退选项
  turbopack: {},

  experimental: {
    serverActions: {
      allowedOrigins: [
        'autoads.dev',
        'www.autoads.dev',
        'app.autoads.dev',
        'localhost:3000',
        'localhost',
        'autobb-yt54xvsg5q-an.a.run.app',
      ],
      allowedForwardedHosts: [
        'autoads.dev',
        'www.autoads.dev',
        'app.autoads.dev',
        'autobb-yt54xvsg5q-an.a.run.app',
      ],
    },
  },

  // 可选：`next build --webpack` 时保留原生模块 externals
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push(
        'better-sqlite3',
        'cheerio',
        'postgres',
        'playwright',
        'playwright-core',
        '@crawlee/playwright',
        '@crawlee/browser',
        '@crawlee/browser-pool',
        '@crawlee/core',
        '@crawlee/utils',
        '@crawlee/types',
        'fingerprint-generator',
        'fingerprint-injector',
        'header-generator'
      )
    }
    return config
  },

  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:all*(svg|jpg|png|webp|avif)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]
  },

  async redirects() {
    return [
      {
        source: '/',
        destination: '/login',
        statusCode: 301,
      },
    ]
  },
}

module.exports = nextConfig
