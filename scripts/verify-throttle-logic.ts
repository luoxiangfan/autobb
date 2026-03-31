/**
 * 简单验证频率限制逻辑是否正确
 */

console.log('='.repeat(80))
console.log('验证 IPRocket 频率限制代码')
console.log('='.repeat(80))

// 模拟频率限制逻辑
interface ThrottleQueueItem {
  execute: () => Promise<void>
  resolve: (value: any) => void
  reject: (error: any) => void
}

const iprocketCallQueue: ThrottleQueueItem[] = []
let lastIprocketCallTime = 0
let isProcessingQueue = false
const MIN_IPROCKET_CALL_INTERVAL = 100

async function throttleIprocketCall<T>(providerName: string, fn: () => Promise<T>): Promise<T> {
  if (providerName !== 'IPRocket') {
    return fn()
  }

  return new Promise((resolve, reject) => {
    const execute = async () => {
      try {
        const now = Date.now()
        const timeSinceLastCall = now - lastIprocketCallTime

        if (timeSinceLastCall < MIN_IPROCKET_CALL_INTERVAL) {
          const waitTime = MIN_IPROCKET_CALL_INTERVAL - timeSinceLastCall
          console.log(`⏳ [IPRocket 频率限制] 等待 ${waitTime}ms...`)
          await new Promise(r => setTimeout(r, waitTime))
        }

        lastIprocketCallTime = Date.now()
        const result = await fn()
        resolve(result)
      } catch (error) {
        reject(error)
      }
    }

    iprocketCallQueue.push({ execute, resolve, reject })

    if (!isProcessingQueue) {
      processIprocketQueue()
    }
  })
}

async function processIprocketQueue(): Promise<void> {
  if (isProcessingQueue) return

  isProcessingQueue = true

  while (iprocketCallQueue.length > 0) {
    const item = iprocketCallQueue.shift()
    if (item) {
      await item.execute()
    }
  }

  isProcessingQueue = false
}

// 测试
async function test() {
  console.log('\n🧪 测试 1: 非 IPRocket Provider（不应限制）')
  const start1 = Date.now()
  await throttleIprocketCall('Oxylabs', async () => {
    console.log('  - Oxylabs 调用')
    return 'ok'
  })
  const elapsed1 = Date.now() - start1
  console.log(`  ✅ 耗时: ${elapsed1}ms (应该 < 10ms)`)

  console.log('\n🧪 测试 2: IPRocket Provider 并发调用（应该排队）')
  const start2 = Date.now()
  const callTimes: number[] = []

  const promises = Array.from({ length: 5 }, async (_, i) => {
    await throttleIprocketCall('IPRocket', async () => {
      const now = Date.now()
      callTimes.push(now)
      console.log(`  - [${i + 1}] IPRocket 调用 (${now - start2}ms)`)
      return 'ok'
    })
  })

  await Promise.all(promises)
  const elapsed2 = Date.now() - start2

  console.log(`\n  总耗时: ${elapsed2}ms`)
  console.log(`  预期耗时: >= ${(5 - 1) * 100}ms (4 个间隔 × 100ms)`)

  // 计算间隔
  console.log('\n  调用间隔:')
  for (let i = 1; i < callTimes.length; i++) {
    const interval = callTimes[i] - callTimes[i - 1]
    const status = interval >= 100 ? '✅' : '❌'
    console.log(`    [${i}→${i + 1}] ${interval}ms ${status}`)
  }

  console.log('\n' + '='.repeat(80))
  console.log('✅ 验证完成')
  console.log('='.repeat(80))
}

test().catch(console.error)
