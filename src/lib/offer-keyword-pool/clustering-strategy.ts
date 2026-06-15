import type { ClusteringStrategy } from './types'

/**
 * 根据关键词数量确定聚类策略
 */
export function determineClusteringStrategy(keywordCount: number): ClusteringStrategy {
  if (keywordCount < 15) {
    return {
      bucketCount: 1,
      strategy: 'single',
      message: '关键词太少 (<15)，只生成 1 个创意',
    }
  }
  if (keywordCount < 30) {
    return {
      bucketCount: 2,
      strategy: 'dual',
      message: '关键词较少 (15-29)，生成 2 个创意',
    }
  }
  return {
    bucketCount: 3,
    strategy: 'full',
    message: '关键词充足 (>=30)，生成 3 个创意',
  }
}
