/**
 * Redis环境数据清理脚本
 *
 * 用于清理混合环境的Redis数据，确保环境隔离
 *
 * 使用方法:
 * # 清理开发环境数据
 * REDIS_URL="redis://..." node scripts/clean-mixed-redis-data.ts development
 *
 * # 清理生产环境数据
 * REDIS_URL="redis://..." node scripts/clean-mixed-redis-data.ts production
 *
 * # 清理所有混合数据
 * REDIS_URL="redis://..." node scripts/clean-mixed-redis-data.ts all
 */

import Redis from 'ioredis'
import { config } from '../src/lib/config'

interface CleanOptions {
  targetEnv?: string
  dryRun: boolean
}

interface RedisKey {
  key: string
  env: string
  type: string
}

/**
 * 解析Redis Key的环境标识
 */
function parseKeyEnv(key: string): string | null {
  const match = key.match(/autoads:([^:]+):/)
  return match ? match[1] : null
}

/**
 * 解析Redis Key的类型
 */
function parseKeyType(key: string): string {
  if (key.includes(':queue:')) return 'queue'
  if (key.includes(':cache:')) return 'cache'
  if (key.includes(':task:')) return 'task'
  return 'other'
}

/**
 * 获取所有环境相关的keys
 */
async function getAllEnvKeys(client: Redis): Promise<RedisKey[]> {
  const patterns = ['autoads:*', 'autoads:*:*']

  let allKeys: string[] = []

  for (const pattern of patterns) {
    try {
      const keys = await client.keys(pattern)
      allKeys.push(...keys)
    } catch (err) {
      // 忽略pattern错误
    }
  }

  // 去重
  allKeys = [...new Set(allKeys)]

  // 解析每个key
  return allKeys.map(key => ({
    key,
    env: parseKeyEnv(key) || 'unknown',
    type: parseKeyType(key)
  }))
}

/**
 * 清理混合环境数据
 */
async function cleanMixedEnvData(options: CleanOptions) {
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
  })

  try {
    await client.ping()
    console.log('✅ Redis连接成功')
    console.log()

    // 获取所有keys
    console.log('🔍 正在扫描Redis keys...')
    const allKeys = await getAllEnvKeys(client)
    console.log(`   找到 ${allKeys.length} 个相关keys`)
    console.log()

    // 分析keys分布
    const envStats = new Map<string, number>()
    const typeStats = new Map<string, number>()

    allKeys.forEach(({ env, type }) => {
      envStats.set(env, (envStats.get(env) || 0) + 1)
      typeStats.set(type, (typeStats.get(type) || 0) + 1)
    })

    console.log('📊 环境分布:')
    for (const [env, count] of envStats) {
      console.log(`   ${env}: ${count} keys`)
    }
    console.log()

    console.log('📊 类型分布:')
    for (const [type, count] of typeStats) {
      console.log(`   ${type}: ${count} keys`)
    }
    console.log()

    // 确定要清理的keys
    let keysToClean: RedisKey[] = []

    if (options.targetEnv) {
      if (options.targetEnv === 'all') {
        // 清理所有环境keys
        keysToClean = allKeys
        console.log(`🎯 清理模式: 清理所有环境的 ${keysToClean.length} 个keys`)
      } else {
        // 清理指定环境
        keysToClean = allKeys.filter(k => k.env === options.targetEnv)
        console.log(`🎯 清理模式: 清理 ${options.targetEnv} 环境的 ${keysToClean.length} 个keys`)
      }
    } else {
      // 清理混合数据 (包含unknown或多个环境的keys)
      const uniqueEnvs = new Set(allKeys.map(k => k.env))
      if (uniqueEnvs.size > 1) {
        keysToClean = allKeys
        console.log(`⚠️ 检测到混合环境数据`)
        console.log(`   涉及环境: ${Array.from(uniqueEnvs).join(', ')}`)
        console.log(`🎯 清理模式: 清理所有混合数据 (${keysToClean.length} keys)`)
      } else {
        console.log('✅ 未检测到混合环境数据')
        console.log(`   当前环境: ${Array.from(uniqueEnvs)[0] || 'unknown'}`)
        return
      }
    }

    console.log()

    if (keysToClean.length === 0) {
      console.log('✅ 没有需要清理的keys')
      return
    }

    // 显示要清理的keys详情
    console.log('🗑️ 即将清理的keys:')
    const cleanTypeStats = new Map<string, number>()
    keysToClean.forEach(({ type }) => {
      cleanTypeStats.set(type, (cleanTypeStats.get(type) || 0) + 1)
    })
    for (const [type, count] of cleanTypeStats) {
      console.log(`   ${type}: ${count} keys`)
    }
    console.log()

    // 按类型分组显示示例
    const examples = keysToClean.slice(0, 5)
    if (examples.length > 0) {
      console.log('📝 示例keys:')
      examples.forEach(({ key }) => {
        console.log(`   - ${key}`)
      })
      if (keysToClean.length > 5) {
        console.log(`   ... 还有 ${keysToClean.length - 5} 个`)
      }
      console.log()
    }

    // 执行清理
    if (options.dryRun) {
      console.log('🔍 DRY RUN 模式 - 不会实际删除数据')
      console.log(`   模拟删除 ${keysToClean.length} 个keys`)
    } else {
      console.log('⚠️ 即将删除数据 - 此操作不可恢复!')
      console.log()

      const confirmed = process.stdin.isTTY
        ? await new Promise<boolean>((resolve) => {
            process.stdout.write('确认删除? (yes/no): ')
            process.stdin.setEncoding('utf8')
            process.stdin.once('data', (data) => {
              const answer = data.toString().trim().toLowerCase()
              resolve(answer === 'yes' || answer === 'y')
            })
          })
        : false

      if (!confirmed) {
        console.log('❌ 操作已取消')
        return
      }

      console.log('🗑️ 正在删除...')
      let deletedCount = 0
      let errorCount = 0

      for (const { key } of keysToClean) {
        try {
          await client.del(key)
          deletedCount++
        } catch (err) {
          errorCount++
        }
      }

      console.log()
      console.log('✅ 清理完成')
      console.log(`   成功删除: ${deletedCount} keys`)
      if (errorCount > 0) {
        console.log(`   删除失败: ${errorCount} keys`)
      }
    }

  } catch (error: any) {
    console.error('❌ 操作失败:', error.message)
    throw error
  } finally {
    await client.quit()
  }
}

// 命令行参数解析
async function main() {
  const args = process.argv.slice(2)
  const options: CleanOptions = {
    dryRun: args.includes('--dry-run') || args.includes('-n')
  }

  if (args.length > 0 && !args[0].startsWith('--')) {
    options.targetEnv = args[0]
  }

  console.log('=' .repeat(60))
  console.log('🧹 Redis环境数据清理工具')
  console.log('=' .repeat(60))
  console.log()

  console.log('📝 配置信息:')
  console.log(`   当前环境: ${config.NODE_ENV}`)
  console.log(`   Redis URL: ${config.REDIS_URL}`)
  console.log(`   Key Prefix: ${config.REDIS_KEY_PREFIX}`)
  console.log(`   运行模式: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`)
  if (options.targetEnv) {
    console.log(`   目标环境: ${options.targetEnv}`)
  }
  console.log()

  await cleanMixedEnvData(options)

  console.log()
  console.log('=' .repeat(60))
  console.log('✅ 清理完成')
  console.log('=' .repeat(60))
}

// 执行
main().catch(error => {
  console.error('❌ 程序异常:', error)
  process.exit(1)
})
