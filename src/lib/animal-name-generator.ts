/**
 * 动物名用户名生成器
 * 生成格式: {形容词}{动物名}{数字}
 * 长度: 8-12个字符
 * 示例: swiftelephant12, bravepenguin456
 */

import { getDatabase } from './db'

// 形容词列表
const ADJECTIVES = [
  'swift', 'brave', 'clever', 'gentle', 'mighty',
  'wise', 'bold', 'calm', 'eager', 'fierce',
  'happy', 'jolly', 'keen', 'loyal', 'noble',
  'proud', 'quick', 'smart', 'strong', 'wild',
  'agile', 'bright', 'cool', 'daring', 'epic',
  'free', 'grand', 'hero', 'iron', 'just',
]

// 动物名列表
const ANIMALS = [
  'eagle', 'tiger', 'bear', 'wolf', 'lion',
  'fox', 'hawk', 'owl', 'lynx', 'puma',
  'shark', 'whale', 'dolphin', 'orca', 'ray',
  'dragon', 'phoenix', 'griffin', 'pegasus', 'unicorn',
  'falcon', 'raven', 'cobra', 'viper', 'panther',
  'jaguar', 'leopard', 'cheetah', 'cougar', 'badger',
]

/**
 * 生成单个动物名用户名
 */
function generateSingleName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
  const number = Math.floor(Math.random() * 900) + 100 // 100-999

  return `${adjective}${animal}${number}`
}

/**
 * 检查用户名是否已存在
 */
async function isUsernameExists(username: string): Promise<boolean> {
  const db = await getDatabase()
  const user = await db.queryOne('SELECT id FROM users WHERE username = ?', [username])
  return !!user
}

/**
 * 生成唯一的动物名用户名
 * @param maxAttempts 最大尝试次数,默认10次
 * @returns 唯一的用户名
 * @throws Error 如果超过最大尝试次数仍无法生成唯一用户名
 */
export async function generateAnimalUsername(maxAttempts: number = 10): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const username = generateSingleName()

    // 检查是否已存在
    if (!(await isUsernameExists(username))) {
      return username
    }
  }

  // 如果10次都冲突,抛出错误
  throw new Error('无法生成唯一用户名,请稍后重试')
}

/**
 * 批量生成唯一用户名(用于预览)
 * @param count 生成数量,默认5个
 * @returns 用户名数组
 */
export async function generateBatchUsernames(count: number = 5): Promise<string[]> {
  const usernames: string[] = []
  const usedNames = new Set<string>()

  let attempts = 0
  const maxAttempts = count * 10 // 总尝试次数

  while (usernames.length < count && attempts < maxAttempts) {
    const username = generateSingleName()
    attempts++

    // 检查是否在本批次中重复或数据库中存在
    if (!usedNames.has(username) && !(await isUsernameExists(username))) {
      usernames.push(username)
      usedNames.add(username)
    }
  }

  if (usernames.length < count) {
    throw new Error(`仅生成了${usernames.length}个唯一用户名,请求${count}个`)
  }

  return usernames
}

/**
 * 验证用户名格式是否符合动物名规范
 * @param username 用户名
 * @returns 是否符合规范
 */
export function isValidAnimalUsername(username: string): boolean {
  // 长度检查: 8-20个字符
  if (username.length < 8 || username.length > 20) {
    return false
  }

  // 格式检查: 小写字母+数字组合
  if (!/^[a-z]+[0-9]+$/.test(username)) {
    return false
  }

  // 检查是否包含已知的形容词和动物名
  const hasAdjective = ADJECTIVES.some(adj => username.startsWith(adj))
  const hasAnimal = ANIMALS.some(animal => {
    const adjMatch = ADJECTIVES.find(adj => username.startsWith(adj))
    if (adjMatch) {
      return username.substring(adjMatch.length).startsWith(animal)
    }
    return false
  })

  return hasAdjective && hasAnimal
}

/**
 * 获取可用的形容词列表(用于管理界面展示)
 */
export function getAvailableAdjectives(): string[] {
  return [...ADJECTIVES]
}

/**
 * 获取可用的动物名列表(用于管理界面展示)
 */
export function getAvailableAnimals(): string[] {
  return [...ANIMALS]
}
