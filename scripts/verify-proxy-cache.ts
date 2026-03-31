/**
 * 验证代理凭证缓存功能
 */

console.log('='.repeat(80))
console.log('验证代理凭证缓存功能')
console.log('='.repeat(80))

// 模拟缓存机制
interface ProxyCredentialsCache {
  credentials: {
    host: string
    port: number
    username: string
    password: string
    fullAddress: string
  }
  cachedAt: number
  expiresAt: number
}

const proxyCredentialsCache = new Map<string, ProxyCredentialsCache>()
const PROXY_CREDENTIALS_CACHE_DURATION = 5 * 60 * 1000 // 5 分钟

function getCachedProxyCredentials(proxyUrl: string): ProxyCredentialsCache['credentials'] | null {
  const cached = proxyCredentialsCache.get(proxyUrl)
  if (!cached) return null

  const now = Date.now()
  if (now >= cached.expiresAt) {
    proxyCredentialsCache.delete(proxyUrl)
    return null
  }

  const remainingTime = Math.floor((cached.expiresAt - now) / 1000)
  console.log(`🔥 [代理凭证缓存] 命中: ${cached.credentials.fullAddress} (剩余 ${remainingTime}s)`)
  return cached.credentials
}

function cacheProxyCredentials(proxyUrl: string, credentials: any): void {
  const now = Date.now()
  proxyCredentialsCache.set(proxyUrl, {
    credentials: {
      host: credentials.host,
      port: credentials.port,
      username: credentials.username,
      password: credentials.password,
      fullAddress: `${credentials.host}:${credentials.port}`,
    },
    cachedAt: now,
    expiresAt: now + PROXY_CREDENTIALS_CACHE_DURATION,
  })
  console.log(`🔥 [代理凭证缓存] 已缓存: ${credentials.host}:${credentials.port} (5分钟)`)
}

// 模拟 API 调用
let apiCallCount = 0
async function mockGetProxyIp(proxyUrl: string): Promise<any> {
  apiCallCount++
  console.log(`🌐 [API 调用 #${apiCallCount}] 获取代理凭证...`)
  await new Promise(r => setTimeout(r, 100)) // 模拟网络延迟
  return {
    host: '192.168.1.100',
    port: 8080,
    username: 'user',
    password: 'pass',
  }
}

// 模拟创建实例
async function mockCreateInstance(proxyUrl: string): Promise<void> {
  console.log(`\n📦 创建 Playwright 实例...`)

  // 优先使用缓存
  const cachedProxy = getCachedProxyCredentials(proxyUrl)
  if (cachedProxy) {
    console.log(`✅ 使用缓存凭证: ${cachedProxy.fullAddress}`)
    return
  }

  // 缓存未命中，调用 API
  console.log(`⚠️ 缓存未命中，调用 API...`)
  const proxy = await mockGetProxyIp(proxyUrl)

  // 缓存新凭证
  cacheProxyCredentials(proxyUrl, proxy)

  console.log(`✅ 使用新凭证: ${proxy.host}:${proxy.port}`)
}

// 测试
async function test() {
  const proxyUrl = 'https://api.iprocket.io/api?username=test&password=test'

  console.log('\n🧪 测试场景 1: 首次创建实例（缓存未命中）')
  await mockCreateInstance(proxyUrl)

  console.log('\n🧪 测试场景 2: 第 2 次创建实例（缓存命中）')
  await mockCreateInstance(proxyUrl)

  console.log('\n🧪 测试场景 3: 第 3 次创建实例（缓存命中）')
  await mockCreateInstance(proxyUrl)

  console.log('\n🧪 测试场景 4: 第 4 次创建实例（缓存命中）')
  await mockCreateInstance(proxyUrl)

  console.log('\n🧪 测试场景 5: 模拟缓存过期')
  // 手动过期缓存
  const cached = proxyCredentialsCache.get(proxyUrl)
  if (cached) {
    cached.expiresAt = Date.now() - 1000 // 设置为已过期
    console.log('⏰ 缓存已手动过期')
  }

  console.log('\n🧪 测试场景 6: 缓存过期后创建实例（缓存未命中）')
  await mockCreateInstance(proxyUrl)

  console.log('\n' + '='.repeat(80))
  console.log('📊 测试结果')
  console.log('='.repeat(80))

  console.log(`\n总 API 调用次数: ${apiCallCount}`)
  console.log(`预期调用次数: 2 (首次 + 过期后)`)

  if (apiCallCount === 2) {
    console.log('\n✅ 缓存功能正常工作！')
    console.log('   - 首次创建: 调用 API ✅')
    console.log('   - 第 2-4 次: 使用缓存 ✅')
    console.log('   - 过期后: 重新调用 API ✅')
  } else {
    console.log(`\n❌ 缓存功能异常！实际调用 ${apiCallCount} 次`)
  }

  console.log('\n💡 效果分析:')
  console.log(`   - 缓存命中率: ${((4 / 6) * 100).toFixed(0)}%`)
  console.log(`   - API 调用减少: ${(((6 - apiCallCount) / 6) * 100).toFixed(0)}%`)
}

test().catch(console.error)
