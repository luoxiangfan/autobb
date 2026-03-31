/**
 * Redis客户端单例
 *
 * 用于AI缓存和其他需要Redis的功能
 *
 * 优化：
 * - 增加连接保活机制，防止空闲超时断开
 * - 优化重连策略，避免频繁断开重连
 * - 添加心跳检测，主动维持连接活跃
 */

import Redis from 'ioredis'

let redisClient: Redis | null = null
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10

/**
 * 获取Redis客户端实例（单例模式）
 */
export function getRedisClient(): Redis | null {
  // 如果已有实例且连接正常，直接返回
  if (redisClient && redisClient.status === 'ready') {
    return redisClient
  }

  // 检查Redis URL配置
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.warn('⚠️ REDIS_URL 未配置，Redis缓存功能已禁用')
    return null
  }

  try {
    // 创建Redis客户端，增强连接保活配置
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,

      // 连接保活配置
      keepAlive: 30000,  // 每30秒发送TCP keepalive包
      connectTimeout: 10000,  // 连接超时10秒

      // 重连策略：指数退避，最大延迟10秒
      retryStrategy(times) {
        reconnectAttempts = times

        if (times > MAX_RECONNECT_ATTEMPTS) {
          console.error(`❌ Redis重连失败，已达到最大重试次数(${MAX_RECONNECT_ATTEMPTS})`)
          return null  // 停止重连
        }

        const delay = Math.min(times * 200, 10000)
        console.log(`⏳ Redis重连中... (第${times}次，${delay}ms后重试)`)
        return delay
      },

      // 自动重连
      autoResubscribe: true,
      autoResendUnfulfilledCommands: true,
    })

    // 监听连接事件
    redisClient.on('connect', () => {
      console.log('🔗 Redis正在建立连接...')
    })

    redisClient.on('ready', () => {
      reconnectAttempts = 0
      console.log('✅ Redis连接就绪')
    })

    redisClient.on('error', (err) => {
      // 只在首次错误或关键错误时打印完整信息
      if (reconnectAttempts === 0 || err.message.includes('ECONNREFUSED')) {
        console.error('❌ Redis连接错误:', err.message)
      }
    })

    redisClient.on('close', () => {
      if (reconnectAttempts === 0) {
        console.warn('⚠️ Redis连接已关闭，将尝试重连...')
      }
    })

    redisClient.on('reconnecting', (delay: number) => {
      if (reconnectAttempts <= 3) {
        console.log(`🔄 Redis正在重连... (延迟${delay}ms)`)
      }
    })

    // 定期心跳检测，保持连接活跃
    setInterval(async () => {
      if (redisClient && redisClient.status === 'ready') {
        try {
          await redisClient.ping()
        } catch (err) {
          // 心跳失败静默处理，让重连机制自动处理
        }
      }
    }, 30000)  // 每30秒心跳一次

    return redisClient
  } catch (error) {
    console.error('❌ Redis客户端初始化失败:', error)
    return null
  }
}

/**
 * 关闭Redis连接
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
    console.log('✅ Redis连接已关闭')
  }
}

/**
 * 检查Redis是否可用
 */
export function isRedisAvailable(): boolean {
  return redisClient !== null && redisClient.status === 'ready'
}
