/**
 * Proxy Pool Initialization Script
 *
 * Initializes the proxy pool with preheating for US, DE, UK countries
 * Run this on server startup to warm up the proxy cache
 */

import { initProxyPool, getProxyPoolManager } from '../src/lib/proxy/proxy-pool'

async function main() {
  console.log('🚀 Initializing Proxy Pool...\n')

  try {
    // Initialize with custom configuration
    const pool = await initProxyPool({
      refreshIntervalMs: 5 * 60 * 1000,  // 5 minutes
      minHealthyProxies: 3,
      maxPoolSize: 10,
      countries: ['US', 'DE', 'UK'],
    })

    console.log('\n✅ Proxy Pool Initialized Successfully!')
    console.log('📊 Pool Statistics:')
    console.log(JSON.stringify(pool.getStats(), null, 2))

    // Test retrieving a proxy
    console.log('\n🧪 Testing proxy retrieval...')
    const testProxy = await pool.getHealthyProxy('US')
    if (testProxy) {
      console.log('✅ Test successful - Retrieved US proxy:', `${testProxy.host}:${testProxy.port}`)
    } else {
      console.log('⚠️ No US proxy available')
    }

    console.log('\n✨ Proxy pool is now running in the background')
    console.log('   Refreshing every 5 minutes automatically')
    console.log('   Call `stopProxyPool()` to stop the background refresh')

    // Keep process alive to show the pool is running
    console.log('\n👉 Press Ctrl+C to stop the pool and exit\n')

  } catch (error: any) {
    console.error('❌ Failed to initialize proxy pool:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopping proxy pool...')
  const { stopProxyPool } = require('../src/lib/proxy/proxy-pool')
  stopProxyPool()
  console.log('✅ Proxy pool stopped')
  process.exit(0)
})

main()
