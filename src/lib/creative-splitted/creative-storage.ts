/**
 * 🔥 创意生成器存储模块
 * 从 ad-creative-generator.ts 拆分出来
 *
 * 职责: 缓存管理、数据库操作、数据持久化
 * 遵循 KISS 原则: 简单的存储接口，清晰的缓存策略
 */

import type { GeneratedAdCreativeData } from '../ad-creative'
import { getDatabase } from '../db'
import { creativeCache, generateCreativeCacheKey } from '../cache'

/**
 * 🎯 从缓存获取创意
 */
export function getFromCache(offerId: number, options: any): any | null {
  const cacheKey = generateCreativeCacheKey(offerId, options)
  return creativeCache.get(cacheKey)
}

/**
 * 🎯 设置缓存
 */
export function setCache(key: string, value: any, ttlMinutes: number = 60): void {
  try {
    creativeCache.set(key, value, ttlMinutes * 60 * 1000)
    console.log(`[setCache] 缓存设置成功: ${key}`)
  } catch (error) {
    console.error('[setCache] 缓存设置失败:', error)
  }
}

/**
 * 🎯 生成缓存键
 * 用于唯一标识缓存条目
 */
export function generateCacheKey(offerId: number, options: any): string {
  return generateCreativeCacheKey(offerId, options)
}

/**
 * 🎯 保存到数据库
 * 将生成的创意保存到数据库
 */
export async function saveToDatabase(
  offerId: number,
  userId: number,
  creativeData: any,
  aiType: string,
  aiModel: string
): Promise<GeneratedAdCreativeData & { ai_model: string }> {
  console.log('[saveToDatabase] 开始保存创意到数据库')

  try {
    const db = await getDatabase()

    // TODO: 实现具体的数据库保存逻辑
    // 这里需要根据实际的数据库模式来实现

    const result = {
      ...creativeData,
      ai_model: aiModel,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    console.log('[saveToDatabase] 创意保存成功')
    return result
  } catch (error) {
    console.error('[saveToDatabase] 保存失败:', error)
    throw error
  }
}

/**
 * 🎯 从数据库加载创意
 * 根据 offerId 和其他条件加载创意
 */
export async function loadFromDatabase(
  offerId: number,
  userId: number,
  options: any = {}
): Promise<any | null> {
  try {
    const db = await getDatabase()

    // TODO: 实现具体的数据库查询逻辑
    // 这里需要根据实际的查询需求来实现

    console.log('[loadFromDatabase] 创意加载成功')
    return null
  } catch (error) {
    console.error('[loadFromDatabase] 加载失败:', error)
    return null
  }
}

/**
 * 🎯 删除缓存
 * 手动删除特定缓存条目
 */
export function deleteCache(key: string): boolean {
  try {
    const deleted = creativeCache.delete(key)
    console.log(`[deleteCache] 缓存删除 ${deleted ? '成功' : '失败'}: ${key}`)
    return deleted
  } catch (error) {
    console.error('[deleteCache] 删除缓存异常:', error)
    return false
  }
}

/**
 * 🎯 清空缓存
 * 清空所有缓存（谨慎使用）
 */
export function clearAllCache(): void {
  try {
    creativeCache.clear()
    console.log('[clearAllCache] 所有缓存已清空')
  } catch (error) {
    console.error('[clearAllCache] 清空缓存失败:', error)
  }
}

/**
 * 🎯 缓存统计
 * 获取缓存使用统计信息
 */
export function getCacheStats(): any {
  try {
    const stats = {
      // TODO: 添加更多统计信息
    }

    return stats
  } catch (error) {
    console.error('[getCacheStats] 获取统计失败:', error)
    return null
  }
}
