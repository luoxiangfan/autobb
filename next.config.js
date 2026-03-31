/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker优化：启用standalone输出模式
  output: 'standalone',

  // 性能优化：启用SWC minification
  swcMinify: true,

  // 生产环境优化
  productionBrowserSourceMaps: false,

  // 启用压缩
  compress: true,

  // 性能优化：优化字体加载
  optimizeFonts: true,

  // 图片优化配置
  images: {
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 60,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },

  // 外部包配置：避免webpack打包特定库
  experimental: {
    serverComponentsExternalPackages: [
      'better-sqlite3',
      'cheerio',
      'postgres',
      // 🔥 Crawlee相关包（需要动态加载playwright）
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
    // 启用 instrumentation
    instrumentationHook: true,
    // 🔐 Server Actions 安全配置
    serverActions: {
      // 允许的来源域名（生产环境）
      allowedOrigins: [
        'autoads.dev',
        'www.autoads.dev',
        'app.autoads.dev',
        'localhost:3000',
        'localhost',
        // GCP Cloud Run
        'autobb-yt54xvsg5q-an.a.run.app',
      ],
      // 允许转发的请求（nginx反向代理场景）
      allowedForwardedHosts: [
        'autoads.dev',
        'www.autoads.dev',
        'app.autoads.dev',
        // GCP Cloud Run
        'autobb-yt54xvsg5q-an.a.run.app',
      ],
    },
  },

  webpack: (config, { isServer }) => {
    // 支持better-sqlite3, cheerio, postgres, Crawlee相关包
    if (isServer) {
      config.externals.push(
        'better-sqlite3',
        'cheerio',
        'postgres',
        // 🔥 Crawlee相关包
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
      );
    }
    // 不再自定义chunk splitting，使用Next.js默认配置
    return config;
  },

  // 页面和API路由配置
  poweredByHeader: false,

  // Headers优化
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
    ];
  },
}

module.exports = nextConfig
