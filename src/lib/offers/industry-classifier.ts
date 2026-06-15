/**
 * Industry Classifier Service
 * 根据行业代码查询基准数据
 */

import { getDatabase } from '../db'

export interface IndustryBenchmark {
  id: number
  industry_l1: string
  industry_l2: string
  industry_code: string
  avg_ctr: number
  avg_cpc: number
  avg_conversion_rate: number
}

/**
 * 根据行业代码获取基准数据
 */
export async function getIndustryBenchmark(
  industryCode: string
): Promise<IndustryBenchmark | null> {
  const db = await getDatabase()
  return (await db.queryOne(
    `
    SELECT id, industry_l1, industry_l2, industry_code, avg_ctr, avg_cpc, avg_conversion_rate
    FROM industry_benchmarks
    WHERE industry_code = ?
  `,
    [industryCode]
  )) as IndustryBenchmark | null
}
