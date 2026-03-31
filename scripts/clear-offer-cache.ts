import * as dotenv from 'dotenv'
import { getRedisClient } from '../src/lib/redis'

// Load environment variables
dotenv.config({ path: '.env' })

async function clearOfferCache(url: string, language: string = 'de', pageType: 'product' | 'store' = 'product') {
  try {
    const redis = getRedisClient()
    await redis.connect()
    console.log('✅ Redis connected')

    // Generate cache key matching the format in src/lib/redis.ts:generateCacheKey
    const normalizedUrl = url
      .replace(/\/$/, '')
      .replace(/[?&](ref|tag|utm_[^&]+)=[^&]*/g, '')

    const typePrefix = pageType ? `${pageType}:` : ''
    const cacheKey = `scrape:${typePrefix}${language}:${Buffer.from(normalizedUrl).toString('base64')}`

    console.log(`🗑️  Deleting cache key for URL: ${url}`)
    console.log(`🔑 Cache key: ${cacheKey}`)

    const result = await redis.del(cacheKey)

    if (result > 0) {
      console.log(`✅ Successfully deleted cache for ${url}`)
    } else {
      console.log(`⚠️  Cache key not found, no cache to clear`)
    }

    await redis.quit()
  } catch (error) {
    console.error('❌ Error clearing cache:', error)
    process.exit(1)
  }
}

// Get URL from command line or use default
const url = process.argv[2] || 'https://www.amazon.com/dp/B0DYDRDJVH'
const language = process.argv[3] || 'de'
const pageType = process.argv[4] || 'product'

clearOfferCache(url, language, pageType)
