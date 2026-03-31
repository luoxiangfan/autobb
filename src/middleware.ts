import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

// Middleware在Edge Runtime中运行，使用jose库进行JWT验证
// 注意：Edge Runtime不支持直接import config.ts，需要直接读取环境变量
// 🔴 重要：必须验证环境变量存在，否则会静默失败导致所有用户被登出
const JWT_SECRET_RAW = process.env.JWT_SECRET
if (!JWT_SECRET_RAW) {
  console.error('❌ CRITICAL: JWT_SECRET environment variable is not defined in Edge Runtime!')
  console.error('   This will cause ALL authenticated requests to fail.')
  console.error('   Please ensure JWT_SECRET is set in .env file and restart the server.')
}
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW || '')

/**
 * 验证JWT Token（Edge Runtime兼容）
 */
async function verifyTokenEdge(token: string): Promise<any | null> {
  // 🔴 检查 JWT_SECRET 是否正确加载
  if (JWT_SECRET.length === 0) {
    console.error('❌ JWT_SECRET is empty! Token verification will fail.')
    console.error('   JWT_SECRET_RAW:', JWT_SECRET_RAW ? `${JWT_SECRET_RAW.substring(0, 10)}... (${JWT_SECRET_RAW.length} chars)` : 'UNDEFINED')
    return null
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload
  } catch (error: any) {
    // 详细的错误日志帮助诊断
    console.error('❌ JWT验证失败:', {
      errorName: error?.name,
      errorMessage: error?.message,
      tokenPreview: token ? `${token.substring(0, 20)}...` : 'NO_TOKEN',
      secretLength: JWT_SECRET.length,
    })
    return null
  }
}

// 需要认证的路径前缀（仅API路由，页面路由在客户端组件中检查）
const protectedPaths = [
  '/api/offers',
  '/api/products',
  '/api/campaigns',
  '/api/settings',
  '/api/creatives',
  '/api/user',
  '/api/google-ads',
  '/api/ads-accounts',
]

// 公开路径（无需认证） - 需求27: 除首页和登录页，其他页面都需要登录
const publicPaths = [
  '/',               // 营销首页
  '/login',          // 登录页面
  '/privacy',        // 隐私政策
  '/terms',          // 服务条款
  '/about',          // 关于我们
  '/contact',        // 联系我们
  '/api/auth/login', // 登录API
  '/api/auth/google', // Google OAuth
  '/api/products/yeahpromos/session/capture', // YP 书签脚本回传登录态
  '/api/health',     // 容器内健康检查（nginx/supervisor 启动探针）
  '/robots.txt',     // SEO - robots.txt
  '/sitemap.xml',    // SEO - sitemap.xml
]

// 强制修改密码时允许访问的路径
const passwordChangeAllowedPaths = [
  '/change-password',           // 修改密码页面
  '/api/auth/change-password',  // 修改密码API
  '/api/auth/logout',           // 退出登录API
  '/api/auth/me',               // 获取用户信息API（页面需要）
]

// 🛡️ 第一层防御：通用危险文件扩展名拦截
// 这些扩展名在Web根目录下不应该被公开访问，直接返回404
// 这比黑名单更有效，因为它基于"行为模式"而非"具体文件名"
const DANGEROUS_EXTENSIONS = /^\/?[^\/]+\.(zip|rar|tar|tgz|tar\.gz|7z|bz2|gz|sql|mdb|accdb|bak|backup|old|orig|swp|swo|tmp|temp|log|env|ini|conf|cfg|config|yml|yaml|json\.bak|xml\.bak|htaccess|htpasswd|npmrc|dockerignore|gitignore|ssh|pem|key|crt|pfx|p12)$/i

// 🛡️ 第二层防御：恶意请求路径模式拦截
// 这些是自动化漏洞扫描器常见的攻击路径
const MALICIOUS_PATTERNS = [
  // PHP文件（本项目是Next.js，不存在PHP）
  /\.php($|\?|\/)/i,
  // ASP/ASPX文件（Windows服务器）
  /\.(asp|aspx)($|\?|\/)/i,
  // WordPress相关路径（包括目录）
  /^\/wp-/i,
  /^\/wordpress/i,
  // .well-known 漏洞探测（保留合法的 /.well-known/security.txt 等）
  /^\/\.well-known\/?$/i,                    // /.well-known 或 /.well-known/
  /^\/\.well-known\/acme-challenge/i,        // SSL证书验证路径探测
  /^\/\.well-known\/pki-validation/i,        // PKI验证路径探测
  /^\/\.well-knownold/i,                     // 旧版本探测
  // 常见漏洞路径
  /^\/vendor\/?/i,                           // Composer vendor目录
  /^\/cgi-bin/i,
  /^\/\.git/i,
  /^\/\.env/i,
  /^\/\.htaccess/i,
  /^\/\.svn/i,
  /^\/\.hg/i,
  /^\/\.DS_Store/i,
  /^\/phpmyadmin/i,
  /^\/pma/i,
  /^\/mysql/i,
  /^\/adminer/i,
  /^\/xmlrpc/i,
  /^\/xmrlpc/i,                              // xmlrpc变种拼写
  // 常见后门/Web Shell路径
  /^\/shell/i,
  /^\/c99/i,
  /^\/r57/i,
  /^\/webshell/i,
  /^\/backdoor/i,
  /^\/alfa/i,                                // ALFA Shell
  /^\/ALFA/i,
  /^\/b374k/i,                               // b374k Shell
  /^\/wso/i,                                 // WSO Shell
  // 上传目录探测（根级别目录）
  /^\/uploads?\/?$/i,                        // /upload 或 /uploads
  /^\/upload\//i,                            // /upload/*
  /^\/uploads\//i,                           // /uploads/*
  /^\/files?\/?$/i,                          // /file 或 /files
  /^\/temp\/?$/i,
  /^\/tmp\/?$/i,
  // 备份文件和目录探测（常见的备份路径模式）
  /^\/backup/i,                              // /backup.*, /backups/*
  /^\/bak/i,                                 // /bak*
  /^\/old/i,                                 // /old*
  /^\/copy/i,                                // /copy*
  /^\/restore/i,                             // /restore/*
  /^\/back/i,                                // /back/*
  /\.(bak|backup|old|orig)$/i,               // 备份文件后缀
  // 常见备份文件名模式
  /^\/[^\/]*backup[^\/]*\.(zip|tar|gz|tgz|rar|7z|sql)$/i,
  /^\/full_backup/i,
  /^\/site_backup/i,
  /^\/db_backup/i,
  /^\/sql_backup/i,
  // 数据库备份文件
  /\.(sql|sql\.zip|sql\.gz|sql\.tar\.gz|dump)$/i,
  // 常见网站目录打包文件
  /^\/[^\/]*(www|public_html|html|web|site)\.(zip|tar|gz|rar)$/i,
  // SFTP配置文件
  /sftp-config\.json$/i,
  // 配置文件探测
  /^\/config\.(php|inc|ini|conf|yml|yaml|json|xml)$/i,
  /^\/configuration\./i,
  /^\/settings\.(php|inc|ini)$/i,
  /^\/database\./i,
  /^\/db\.(php|inc|sql)$/i,
  // 日志文件探测
  /^\/logs?\/?$/i,
  /^\/error_log/i,
  /^\/access_log/i,
  /\.(log|logs)$/i,
  // 其他常见攻击路径
  /^\/test\.(php|html?)$/i,
  /^\/info\.php$/i,
  /^\/phpinfo/i,
  /^\/debug/i,
  /^\/console/i,
  /^\/manager\/?$/i,
  /^\/administrator\/?$/i,
  /^\/admin\/?$/i,                           // 注意：不影响 /admin/queue 等合法路径

  // === 以下是根据真实攻击日志新增的模式 ===

  // CMS相关目录探测（Joomla, Drupal等）
  /^\/components\/?$/i,                      // Joomla组件目录
  /^\/modules\/?$/i,                         // Drupal/Joomla模块目录
  /^\/modules\/mod_/i,                       // Joomla模块文件上传漏洞
  /^\/sites\/default\/files/i,              // Drupal默认文件目录
  /^\/images\/stories/i,                     // Joomla媒体目录
  /^\/plugins\/?$/i,                         // 插件目录探测

  // 编辑器漏洞探测
  /\/fckeditor\//i,                          // FCKEditor漏洞
  /\/ckeditor\//i,                           // CKEditor漏洞
  /\/kindeditor\//i,                         // KindEditor漏洞
  /\/ueditor\//i,                            // UEditor漏洞

  // 常见目录探测（根级别）
  /^\/images\/?$/i,                          // /images 目录探测
  /^\/assets\/?$/i,                          // /assets 目录探测
  /^\/css\/?$/i,                             // /css 目录探测
  /^\/js\/?$/i,                              // /js 目录探测
  /^\/fonts\/?$/i,                           // /fonts 目录探测
  /^\/include\/?$/i,                         // /include 目录探测
  /^\/includes\/?$/i,                        // /includes 目录探测
  /^\/template\/?$/i,                        // /template 目录探测
  /^\/templates\/?$/i,                       // /templates 目录探测
  /^\/public\/?$/i,                          // /public 目录探测（区分大小写）
  /^\/Public\/?$/i,                          // /Public 目录探测
  /^\/local\/?$/i,                           // /local 目录探测
  /^\/system\/?$/i,                          // /system 目录探测
  /^\/shop\/?$/i,                            // /shop 目录探测
  /^\/site\/?$/i,                            // /site 目录探测
  /^\/Site\/?$/i,                            // /Site 目录探测
  /^\/php\/?$/i,                             // /php 目录探测
  /^\/Assets\/?$/i,                          // /Assets 目录探测

  // OpenCart/电商平台漏洞
  /\/controller\/extension/i,               // OpenCart扩展目录

  // 常见漏洞文件名（不带扩展名已在.php规则中处理）
  /^\/autoload_classmap/i,                   // PHP自动加载配置
  /^\/function\//i,                          // 函数目录
  /^\/index\//i,                             // index目录探测
  /^\/mah\//i,                               // 常见后门路径
]

// 🛡️ 合法路径白名单（优先于恶意模式检查）
const LEGITIMATE_PATHS = [
  /^\/admin\//,                              // /admin/queue, /admin/users 等合法管理页面
  /^\/api\//,                                // API路由
  /^\/settings/,                             // 设置页面
  /^\/dashboard/,                            // 仪表盘
  /^\/products/,                             // 商品管理
  /^\/offers/,                               // Offer管理
  /^\/campaigns/,                            // 广告系列
  /^\/creatives/,                            // 创意管理
  /^\/analytics/,                            // 数据分析
  /^\/optimization/,                         // 优化迭代
  /^\/strategy-center/,                      // 策略中心
  /^\/change-password/,                      // 修改密码
]

export async function middleware(request: NextRequest) {
  const { pathname} = request.nextUrl

  // 统一生成/透传 requestId，供日志与跨服务调用关联
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)

  const attachRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId)
    return response
  }

  // 🛡️ 第一道防线：危险文件扩展名拦截（最高优先级）
  // 无论文件名是什么，根目录下的 .zip/.sql/.bak 等文件都不应该被访问
  if (DANGEROUS_EXTENSIONS.test(pathname)) {
    return attachRequestId(new NextResponse(null, { status: 404 }))
  }

  // 🛡️ 第二道防线：恶意路径模式拦截
  // 先检查白名单，避免误拦截合法路径
  const isLegitimate = LEGITIMATE_PATHS.some(pattern => pattern.test(pathname))
  if (!isLegitimate && MALICIOUS_PATTERNS.some(pattern => pattern.test(pathname))) {
    return attachRequestId(new NextResponse(null, { status: 404 }))
  }

  // 检查是否是公开路径
  const isPublicPath = publicPaths.some(path => {
    if (path === '/') {
      // 首页需要精确匹配
      return pathname === '/'
    }
    // 其他路径使用startsWith匹配
    return pathname === path || pathname.startsWith(path + '/')
  })

  // 公开路径直接放行
  if (isPublicPath) {
    return attachRequestId(NextResponse.next({ request: { headers: requestHeaders } }))
  }

  // OpenClaw / Strategy Center API 允许 Bearer Token 直接透传（由路由内二次鉴权）
  const isOpenclawApiRoute = pathname === '/api/openclaw' || pathname.startsWith('/api/openclaw/')
  const isStrategyCenterApiRoute = pathname === '/api/strategy-center' || pathname.startsWith('/api/strategy-center/')
  const hasAuthorizationHeader = Boolean(request.headers.get('authorization')?.trim())
  if ((isOpenclawApiRoute || isStrategyCenterApiRoute) && hasAuthorizationHeader) {
    return attachRequestId(NextResponse.next({ request: { headers: requestHeaders } }))
  }

  // 从Cookie中读取token（HttpOnly Cookie方式）
  const token = request.cookies.get('auth_token')?.value
  const isApiRoute = pathname.startsWith('/api/')

  // 如果没有token，重定向到登录页
  if (!token) {

    if (isApiRoute) {
      // API路径：返回401 JSON
      return attachRequestId(NextResponse.json(
        { error: '未提供认证token，请先登录' },
        { status: 401 }
      ))
    } else {
      // 页面路径：重定向到登录页
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return attachRequestId(NextResponse.redirect(loginUrl))
    }
  }

  // 验证token（异步）
  const payload = await verifyTokenEdge(token)
  if (!payload) {
    if (isApiRoute) {
      // API路径：返回401 JSON
      return attachRequestId(NextResponse.json(
        { error: 'Token无效或已过期，请重新登录' },
        { status: 401 }
      ))
    } else {
      // 页面路径：重定向到登录页并清除无效cookie
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      loginUrl.searchParams.set('error', encodeURIComponent('登录已过期，请重新登录'))

      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete('auth_token')
      return attachRequestId(response)
    }
  }

  // Token有效，在请求头中添加用户信息，供后续API使用
  requestHeaders.set('x-user-id', String(payload.userId))
  requestHeaders.set('x-user-email', String(payload.email))
  requestHeaders.set('x-user-role', String(payload.role))
  requestHeaders.set('x-user-package', String(payload.packageType))

  // 🔐 强制修改密码检查
  // 如果用户需要强制修改密码，只允许访问特定路径
  if (payload.mustChangePassword === true) {
    const isPasswordChangeAllowed = passwordChangeAllowedPaths.some(path => {
      return pathname === path || pathname.startsWith(path + '/')
    })

    if (!isPasswordChangeAllowed) {
      if (isApiRoute) {
        // API路径：返回403，提示需要先修改密码
        return attachRequestId(NextResponse.json(
          { error: '请先修改初始密码', code: 'PASSWORD_CHANGE_REQUIRED' },
          { status: 403 }
        ))
      } else {
        // 页面路径：重定向到修改密码页面
        const changePasswordUrl = new URL('/change-password', request.url)
        changePasswordUrl.searchParams.set('forced', 'true')
        return attachRequestId(NextResponse.redirect(changePasswordUrl))
      }
    }
  }

  return attachRequestId(NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  }))
}

// 配置中间件匹配的路径
export const config = {
  matcher: [
    /*
     * 匹配所有请求路径，除了：
     * - _next/static (静态文件)
     * - _next/image (图片优化)
     * - favicon.ico (网站图标)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
