/**
 * 关键词聚类：AI 语义聚类引擎
 */
import { loadPrompt } from '../../ai/server'
import { recordTokenUsage, estimateTokenCost } from '../../ai/server'
import {
  type KeywordBuckets,
  type KeywordPoolProgressReporter,
  type StoreKeywordBuckets,
} from './types'
import {
  buildDeterministicClusteringFallback,
  extractHttpStatusFromError,
  isRetryableClusteringError,
  KEYWORD_CLUSTERING_MAX_OUTPUT_TOKENS,
  KEYWORD_CLUSTERING_MAX_SPLIT_DEPTH,
  KEYWORD_CLUSTERING_MIN_SPLIT_KEYWORDS,
  runKeywordClustering,
  shouldUseDeterministicClusteringFallback,
  appendKeywordClusteringOutputGuardrails,
  parseKeywordClusteringJson,
  isLikelyKeywordClusteringTruncated,
  splitKeywordsForRetry,
} from './keyword-clustering-utils'
import {
  createEmptyBuckets,
  createEmptyStoreBuckets,
  validateBuckets,
  validateStoreBuckets,
  applyStoreBucketPostProcessing,
  filterBucketsToAllowedKeywords,
  redistributeStoreBucketsFromS,
  recalculateStoreBucketStatistics,
} from './keyword-clustering-buckets'

// AI 语义聚类

/**
 * 重大分批处理大规模关键词聚类
 *
 * 问题：249个关键词一次性聚类导致超时（即使flash模型也需要180s+）
 * 解决：将关键词分批处理，每批80-100个关键词，并行处理后合并结果
 *
 * 性能提升
 * 批量处理：每批处理时间从180s+降至45-60s
 * 并行执行：3个批次并行处理，总时间减少60%
 * 超时风险：从>90%降至<1%
 *
 * 策略
 * 1. 关键词数量 <= 100：直接处理（原逻辑）
 * 2. 关键词数量 > 100：分批处理（3批次并行）
 * 3. 每批次独立聚类，保持桶A/B/C结构
 * 4. 合并时去重并计算平均意图描述
 */

/**
 * 批量聚类单个批次
 * v4.16: 支持店铺链接的5桶模式
 */
async function clusterBatchKeywords(
  batchKeywords: string[],
  brandName: string,
  category: string | null,
  userId: number,
  batchIndex: number,
  totalBatches: number,
  pageType: 'product' | 'store' = 'product',
  splitDepth: number = 0
): Promise<KeywordBuckets | StoreKeywordBuckets> {
  console.log(
    `📦 处理批次 ${batchIndex}/${totalBatches}: ${batchKeywords.length} 个关键词 (${pageType}链接)`
  )

  // 1. 加载聚类 prompt
  const promptTemplate = await loadPrompt('keyword_intent_clustering')

  // 2. 构建 prompt（v4.16 支持 store 链接）
  let prompt = promptTemplate
    .replace('{{brandName}}', brandName)
    .replace('{{productCategory}}', category || '未分类')
    .replace('{{keywords}}', batchKeywords.join('\n'))
    // v4.16: 添加链接类型参数到 prompt
    .replace(/\{\{linkType\}\}/g, pageType)
  prompt = appendKeywordClusteringOutputGuardrails(prompt)

  // 3. 定义结构化输出 schema（支持4桶产品 或 5桶店铺）
  const isStore = pageType === 'store'
  const responseSchema = {
    type: 'OBJECT' as const,
    properties: {
      bucketA: {
        type: 'OBJECT' as const,
        properties: {
          intent: { type: 'STRING' as const },
          intentEn: { type: 'STRING' as const },
          description: { type: 'STRING' as const },
          keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
        },
        required: ['intent', 'intentEn', 'description', 'keywords'],
      },
      bucketB: {
        type: 'OBJECT' as const,
        properties: {
          intent: { type: 'STRING' as const },
          intentEn: { type: 'STRING' as const },
          description: { type: 'STRING' as const },
          keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
        },
        required: ['intent', 'intentEn', 'description', 'keywords'],
      },
      bucketC: {
        type: 'OBJECT' as const,
        properties: {
          intent: { type: 'STRING' as const },
          intentEn: { type: 'STRING' as const },
          description: { type: 'STRING' as const },
          keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
        },
        required: ['intent', 'intentEn', 'description', 'keywords'],
      },
      bucketD: {
        type: 'OBJECT' as const,
        properties: {
          intent: { type: 'STRING' as const },
          intentEn: { type: 'STRING' as const },
          description: { type: 'STRING' as const },
          keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
        },
        required: ['intent', 'intentEn', 'description', 'keywords'],
      },
      // v4.16: 店铺链接添加 bucketS
      ...(isStore
        ? {
            bucketS: {
              type: 'OBJECT' as const,
              properties: {
                intent: { type: 'STRING' as const },
                intentEn: { type: 'STRING' as const },
                description: { type: 'STRING' as const },
                keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
              },
              required: ['intent', 'intentEn', 'description', 'keywords'],
            },
          }
        : {}),
      statistics: {
        type: 'OBJECT' as const,
        properties: {
          totalKeywords: { type: 'INTEGER' as const },
          bucketACount: { type: 'INTEGER' as const },
          bucketBCount: { type: 'INTEGER' as const },
          bucketCCount: { type: 'INTEGER' as const },
          bucketDCount: { type: 'INTEGER' as const },
          // v4.16: 店铺链接添加 bucketSCount
          ...(isStore ? { bucketSCount: { type: 'INTEGER' as const } } : {}),
          balanceScore: { type: 'NUMBER' as const },
        },
        required: isStore
          ? [
              'totalKeywords',
              'bucketACount',
              'bucketBCount',
              'bucketCCount',
              'bucketDCount',
              'bucketSCount',
              'balanceScore',
            ]
          : [
              'totalKeywords',
              'bucketACount',
              'bucketBCount',
              'bucketCCount',
              'bucketDCount',
              'balanceScore',
            ],
      },
    },
    required: isStore
      ? ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'bucketS', 'statistics']
      : ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'statistics'],
  }

  // 4. 调用 AI（使用智能模型选择，60-90s）
  const aiResponse = await runKeywordClustering(
    {
      operationType: 'keyword_clustering',
      prompt,
      temperature: 0.3,
      responseSchema,
      responseMimeType: 'application/json',
    },
    userId
  )

  // 5. 记录 token 使用
  if (aiResponse.usage) {
    const cost = estimateTokenCost(
      aiResponse.model,
      aiResponse.usage.inputTokens,
      aiResponse.usage.outputTokens
    )
    await recordTokenUsage({
      userId,
      model: aiResponse.model,
      operationType: 'keyword_clustering',
      inputTokens: aiResponse.usage.inputTokens,
      outputTokens: aiResponse.usage.outputTokens,
      totalTokens: aiResponse.usage.totalTokens,
      cost,
      apiType: aiResponse.apiType,
    })
  }

  let batchResult
  try {
    batchResult = parseKeywordClusteringJson(aiResponse.text)
  } catch (parseError) {
    const likelyTruncated = isLikelyKeywordClusteringTruncated(aiResponse)
    const canSplitFurther =
      likelyTruncated &&
      splitDepth < KEYWORD_CLUSTERING_MAX_SPLIT_DEPTH &&
      batchKeywords.length >= KEYWORD_CLUSTERING_MIN_SPLIT_KEYWORDS * 2

    if (canSplitFurther) {
      const [leftKeywords, rightKeywords] = splitKeywordsForRetry(batchKeywords)
      console.warn(
        `⚠️ 批次 ${batchIndex}/${totalBatches} 响应疑似被 token 截断 ` +
          `(${aiResponse.usage?.outputTokens || 0}/${KEYWORD_CLUSTERING_MAX_OUTPUT_TOKENS})，` +
          `拆分为 ${leftKeywords.length}+${rightKeywords.length} 重试`
      )

      const leftResult = await clusterBatchKeywords(
        leftKeywords,
        brandName,
        category,
        userId,
        batchIndex,
        totalBatches,
        pageType,
        splitDepth + 1
      )
      const rightResult = await clusterBatchKeywords(
        rightKeywords,
        brandName,
        category,
        userId,
        batchIndex,
        totalBatches,
        pageType,
        splitDepth + 1
      )

      return mergeBatchResults([leftResult, rightResult])
    }

    console.error('❌ JSON解析失败:', parseError)
    console.error('   原始响应:', aiResponse.text.slice(0, 500))
    const errorMessage = parseError instanceof Error ? parseError.message : '未知错误'
    throw new Error(`JSON解析失败: ${errorMessage}`)
  }

  // 添加数据结构验证（支持4个桶）
  // v4.16: 店铺链接支持5个桶
  if (isStore) {
    // 店铺链接：验证5个桶
    if (
      !batchResult.bucketA ||
      !batchResult.bucketB ||
      !batchResult.bucketC ||
      !batchResult.bucketD ||
      !batchResult.bucketS
    ) {
      console.error('❌ AI返回数据结构不完整(店铺):', batchResult)
      throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D/S')
    }

    if (
      !Array.isArray(batchResult.bucketA.keywords) ||
      !Array.isArray(batchResult.bucketB.keywords) ||
      !Array.isArray(batchResult.bucketC.keywords) ||
      !Array.isArray(batchResult.bucketD.keywords) ||
      !Array.isArray(batchResult.bucketS.keywords)
    ) {
      console.error('❌ AI返回的keywords不是数组(店铺):', batchResult)
      throw new Error('AI返回的keywords不是数组')
    }

    console.log(
      `✅ 批次 ${batchIndex} 完成 (店铺5桶): A=${batchResult.bucketA.keywords.length}, B=${batchResult.bucketB.keywords.length}, C=${batchResult.bucketC.keywords.length}, D=${batchResult.bucketD.keywords.length}, S=${batchResult.bucketS.keywords.length}`
    )
  } else {
    // 产品链接：验证4个桶
    if (
      !batchResult.bucketA ||
      !batchResult.bucketB ||
      !batchResult.bucketC ||
      !batchResult.bucketD
    ) {
      console.error('❌ AI返回数据结构不完整(产品):', batchResult)
      throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D')
    }

    if (
      !Array.isArray(batchResult.bucketA.keywords) ||
      !Array.isArray(batchResult.bucketB.keywords) ||
      !Array.isArray(batchResult.bucketC.keywords) ||
      !Array.isArray(batchResult.bucketD.keywords)
    ) {
      console.error('❌ AI返回的keywords不是数组(产品):', batchResult)
      throw new Error('AI返回的keywords不是数组')
    }

    console.log(
      `✅ 批次 ${batchIndex} 完成 (产品4桶): A=${batchResult.bucketA.keywords.length}, B=${batchResult.bucketB.keywords.length}, C=${batchResult.bucketC.keywords.length}, D=${batchResult.bucketD.keywords.length}`
    )
  }

  return batchResult
}

/**
 * 合并多个批次的聚类结果（支持4桶和5桶模式）
 * 支持店铺链接的bucketS
 */
function mergeBatchResults(
  batchResults: Array<{
    bucketA: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketB: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketC: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketD: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketS?: { intent: string; intentEn: string; description: string; keywords: string[] } // 可选：店铺链接专用
    statistics: {
      totalKeywords: number
      bucketACount: number
      bucketBCount: number
      bucketCCount: number
      bucketDCount: number
      bucketSCount?: number
      balanceScore: number
    }
  }>
): KeywordBuckets {
  // 合并所有关键词（去重）
  const allBucketAKeywords = Array.from(new Set(batchResults.flatMap((r) => r.bucketA.keywords)))
  const allBucketBKeywords = Array.from(new Set(batchResults.flatMap((r) => r.bucketB.keywords)))
  const allBucketCKeywords = Array.from(new Set(batchResults.flatMap((r) => r.bucketC.keywords)))
  const allBucketDKeywords = Array.from(new Set(batchResults.flatMap((r) => r.bucketD.keywords)))
  const allBucketSKeywords = Array.from(
    new Set(batchResults.flatMap((r) => r.bucketS?.keywords || []))
  ) // 处理可选的bucketS

  // 选择最详细的意图描述（选择最长的描述）
  const bucketAIntent = batchResults.reduce((best, current) =>
    current.bucketA.description.length > best.bucketA.description.length ? current : best
  ).bucketA

  const bucketBIntent = batchResults.reduce((best, current) =>
    current.bucketB.description.length > best.bucketB.description.length ? current : best
  ).bucketB

  const bucketCIntent = batchResults.reduce((best, current) =>
    current.bucketC.description.length > best.bucketC.description.length ? current : best
  ).bucketC

  const bucketDIntent = batchResults.reduce((best, current) =>
    current.bucketD.description.length > best.bucketD.description.length ? current : best
  ).bucketD

  // 处理bucketS（店铺链接专用）
  const bucketSIntent = batchResults.find((r) => r.bucketS)?.bucketS

  // 计算统计数据
  const totalKeywords =
    allBucketAKeywords.length +
    allBucketBKeywords.length +
    allBucketCKeywords.length +
    allBucketDKeywords.length +
    allBucketSKeywords.length
  const averageBalanceScore =
    batchResults.reduce((sum, r) => sum + r.statistics.balanceScore, 0) / batchResults.length

  console.log(`🔄 合并 ${batchResults.length} 个批次结果:`)
  console.log(`   桶A: ${allBucketAKeywords.length} 个关键词`)
  console.log(`   桶B: ${allBucketBKeywords.length} 个关键词`)
  console.log(`   桶C: ${allBucketCKeywords.length} 个关键词`)
  console.log(`   桶D: ${allBucketDKeywords.length} 个关键词`)
  if (allBucketSKeywords.length > 0) {
    console.log(`   桶S: ${allBucketSKeywords.length} 个关键词`) // 店铺链接显示bucketS
  }
  console.log(`   平均均衡度: ${averageBalanceScore.toFixed(2)}`)

  const result: KeywordBuckets = {
    bucketA: { ...bucketAIntent, keywords: allBucketAKeywords },
    bucketB: { ...bucketBIntent, keywords: allBucketBKeywords },
    bucketC: { ...bucketCIntent, keywords: allBucketCKeywords },
    bucketD: { ...bucketDIntent, keywords: allBucketDKeywords },
    statistics: {
      totalKeywords,
      bucketACount: allBucketAKeywords.length,
      bucketBCount: allBucketBKeywords.length,
      bucketCCount: allBucketCKeywords.length,
      bucketDCount: allBucketDKeywords.length,
      balanceScore: averageBalanceScore,
    },
  }

  // 添加bucketS（如果存在）
  if (bucketSIntent && allBucketSKeywords.length > 0) {
    result.bucketS = { ...bucketSIntent, keywords: allBucketSKeywords }
    result.statistics.bucketSCount = allBucketSKeywords.length
  }

  return result
}

/**
 * AI 语义聚类：将非品牌关键词分成 3 个语义桶（优化版）
 *
 * 重大
 * 小批量（<=100）：直接处理
 * 大批量（>100）：分批并行处理
 * 解决249个关键词超时问题
 *
 * 整合
 * 支持4个桶（A/B/C/D）的聚类
 * 商品需求扩展词也参与AI语义聚类
 * 保持语义聚类的一致性
 *
 * 桶A：品牌商品锚点（品牌与商品/型号强相关）
 * 桶B：商品需求场景（用户有明确商品需求或使用场景）
 * 桶C：功能规格特性（关注技术规格、功能与参数）
 * 桶D：商品需求扩展（补足高相关需求覆盖）
 *
 * v4.16: 店铺链接支持5个桶
 * 桶A：品牌商品集合
 * 桶B：商品需求场景
 * 桶C：热门商品线
 * 桶D：信任服务信号
 * 桶S：店铺全量覆盖
 *
 * @param keywords - 非品牌关键词列表
 * @param brandName - 品牌名称
 * @param category - 产品类别
 * @param userId - 用户 ID（用于 AI 调用）
 * @param targetCountry - 目标国家
 * @param targetLanguage - 目标语言
 * @param pageType - 链接类型 ('product' | 'store')
 * @returns 关键词桶
 */
export async function clusterKeywordsByIntent(
  keywords: string[],
  brandName: string,
  category: string | null,
  userId: number,
  targetCountry?: string,
  targetLanguage?: string,
  pageType: 'product' | 'store' = 'product',
  progress?: KeywordPoolProgressReporter
): Promise<KeywordBuckets> {
  if (keywords.length === 0) {
    console.log('⚠️ 无关键词需要聚类，返回空桶')
    return pageType === 'store' ? createEmptyStoreBuckets() : createEmptyBuckets()
  }

  console.log(`🎯 开始 AI 语义聚类: ${keywords.length} 个关键词 (${pageType}链接)`)
  await progress?.({ phase: 'cluster', message: `语义聚类准备中 (${keywords.length}个关键词)` })

  const allKeywordsForClustering = [...keywords]
  console.log(`📊 总计聚类关键词: ${allKeywordsForClustering.length} 个`)

  // 进一步减小批次大小，降低超时风险
  // 原因：减小单次请求处理量，提高稳定性
  const BATCH_SIZE = 30 // 每批30个关键词（降低超时风险）
  const needsBatching = allKeywordsForClustering.length > 40 // 从60改为40
  const batchCount = needsBatching ? Math.ceil(allKeywordsForClustering.length / BATCH_SIZE) : 1

  if (!needsBatching) {
    // 小批量：直接处理（原逻辑）
    console.log(`📝 小批量模式：直接处理 ${allKeywordsForClustering.length} 个关键词`)
    await progress?.({
      phase: 'cluster',
      message: `语义聚类：小批量处理(${allKeywordsForClustering.length})`,
    })
    try {
      const directBuckets = await clusterKeywordsDirectly(
        allKeywordsForClustering,
        brandName,
        category,
        userId,
        pageType
      )
      filterBucketsToAllowedKeywords(
        directBuckets,
        new Set(allKeywordsForClustering.map((k) => k.toLowerCase()))
      )
      return directBuckets
    } catch (error: any) {
      if (shouldUseDeterministicClusteringFallback(error)) {
        const fallbackBuckets = buildDeterministicClusteringFallback({
          keywords: allKeywordsForClustering,
          pageType,
          error,
          scope: 'direct',
        })
        filterBucketsToAllowedKeywords(
          fallbackBuckets,
          new Set(allKeywordsForClustering.map((k) => k.toLowerCase()))
        )
        return fallbackBuckets
      }
      throw error
    }
  }

  // 大批量：分批处理（有限并发）
  const MAX_CONCURRENT_BATCHES = 3
  console.log(
    `🚀 大批量模式：将 ${allKeywordsForClustering.length} 个关键词分成 ${batchCount} 个批次并发处理 (最大并发 ${MAX_CONCURRENT_BATCHES})`
  )
  await progress?.({ phase: 'cluster', message: `语义聚类：分批处理(${batchCount}批)` })

  // 1. 分批
  const batches: string[][] = []
  for (let i = 0; i < batchCount; i++) {
    const start = i * BATCH_SIZE
    const end = Math.min(start + BATCH_SIZE, allKeywordsForClustering.length)
    batches.push(allKeywordsForClustering.slice(start, end))
  }

  console.log(`📦 批次划分: ${batches.map((b, i) => `批次${i + 1}=${b.length}个`).join(', ')}`)

  // 2. 有限并发处理以支持多用户并发
  // 原因：纯串行会影响吞吐量，过度并发又会增加超时风险
  // 优化措施：限制并发 + 增大重试次数 + 随机抖动
  const maxRetries = 3 // 从2改为3（4次尝试）
  const baseDelay = 5000
  let lastError: any

  for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
    try {
      // 并发处理批次（限制最大并发）
      const batchResults: KeywordBuckets[] = new Array(batches.length)
      let completed = 0
      let nextIndex = 0

      const worker = async () => {
        while (true) {
          const current = nextIndex++
          if (current >= batches.length) break
          await progress?.({
            phase: 'cluster',
            current: completed,
            total: batchCount,
            message: `语义聚类：开始批次 ${current + 1}/${batchCount} (${batches[current].length}个)`,
          })
          batchResults[current] = await clusterBatchKeywords(
            batches[current],
            brandName,
            category,
            userId,
            current + 1,
            batchCount,
            pageType
          ).catch((error) => {
            console.error(`❌ 批次 ${current + 1} 失败:`, error.message)
            throw error
          })
          completed += 1
          await progress?.({
            phase: 'cluster',
            current: completed,
            total: batchCount,
            message: `语义聚类：完成批次 ${current + 1}/${batchCount}`,
          })
        }
      }

      const workerCount = retryCount === 0 ? Math.min(MAX_CONCURRENT_BATCHES, batches.length) : 1
      if (retryCount > 0 && workerCount === 1) {
        console.warn(`⚠️ 分批聚类重试阶段降级为串行执行（第 ${retryCount + 1} 轮）`)
      }
      const workers = Array.from({ length: workerCount }, () => worker())
      await Promise.all(workers)

      // 3. 合并结果
      await progress?.({ phase: 'cluster', message: '语义聚类：合并批次结果' })
      const mergedBuckets = mergeBatchResults(batchResults)
      filterBucketsToAllowedKeywords(
        mergedBuckets,
        new Set(allKeywordsForClustering.map((k) => k.toLowerCase()))
      )

      // 4. 验证结果（店铺/单品分别处理）
      if (pageType === 'store') {
        const storeBuckets = mergedBuckets as unknown as StoreKeywordBuckets
        redistributeStoreBucketsFromS(storeBuckets, allKeywordsForClustering)
        applyStoreBucketPostProcessing(storeBuckets)
        recalculateStoreBucketStatistics(storeBuckets)
        validateStoreBuckets(storeBuckets, allKeywordsForClustering)

        console.log(`✅ 分批 AI 聚类完成 (店铺):`)
        console.log(`   桶A [品牌商品集合]: ${storeBuckets.bucketA.keywords.length} 个`)
        console.log(`   桶B [商品需求场景]: ${storeBuckets.bucketB.keywords.length} 个`)
        console.log(`   桶C [热门商品线]: ${storeBuckets.bucketC.keywords.length} 个`)
        console.log(`   桶D [信任服务信号]: ${storeBuckets.bucketD.keywords.length} 个`)
        console.log(`   桶S [店铺全量覆盖]: ${storeBuckets.bucketS.keywords.length} 个`)
        console.log(`   均衡度得分: ${storeBuckets.statistics.balanceScore.toFixed(2)}`)
      } else {
        validateBuckets(mergedBuckets, allKeywordsForClustering)

        console.log(`✅ 分批 AI 聚类完成:`)
        console.log(`   桶A [品牌商品锚点]: ${mergedBuckets.bucketA.keywords.length} 个`)
        console.log(`   桶B [商品需求场景]: ${mergedBuckets.bucketB.keywords.length} 个`)
        console.log(`   桶C [功能规格特性]: ${mergedBuckets.bucketC.keywords.length} 个`)
        console.log(`   桶D [商品需求扩展]: ${mergedBuckets.bucketD.keywords.length} 个`)
        console.log(`   均衡度得分: ${mergedBuckets.statistics.balanceScore.toFixed(2)}`)
      }

      return mergedBuckets
    } catch (error: any) {
      lastError = error
      const status = extractHttpStatusFromError(error)
      const retryable = isRetryableClusteringError(error)

      if (retryCount < maxRetries && retryable) {
        // 添加随机抖动，避免重试风暴
        const baseDelayMs = baseDelay * Math.pow(2, retryCount)
        const jitter = Math.random() * 2000 // 0-2秒随机抖动
        const delay = Math.min(baseDelayMs + jitter, 60000) // 最多60秒
        const errorInfo = status ? `HTTP ${status}` : String(error?.message || '').substring(0, 80)
        console.warn(
          `⚠️ 分批聚类第 ${retryCount + 1} 次失败 (${errorInfo})，${(delay / 1000).toFixed(1)}s 后重试...`
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      if (shouldUseDeterministicClusteringFallback(error)) {
        const fallbackBuckets = buildDeterministicClusteringFallback({
          keywords: allKeywordsForClustering,
          pageType,
          error,
          scope: 'batch',
        })
        filterBucketsToAllowedKeywords(
          fallbackBuckets,
          new Set(allKeywordsForClustering.map((k) => k.toLowerCase()))
        )
        return fallbackBuckets
      }

      console.error('❌ 分批 AI 语义聚类失败:', error.message)
      throw new Error(`关键词AI语义分类失败（分批处理）: ${error.message}`)
    }
  }

  throw new Error(
    `关键词AI语义分类失败（重试${maxRetries}次均失败）: ${lastError?.message || '未知错误'}`
  )
}

/**
 * 直接处理小批量关键词聚类（原逻辑）
 * v4.16: 支持店铺链接的5桶模式
 * 增加重试次数，与分批处理保持一致
 */
async function clusterKeywordsDirectly(
  keywords: string[],
  brandName: string,
  category: string | null,
  userId: number,
  pageType: 'product' | 'store' = 'product'
): Promise<KeywordBuckets | StoreKeywordBuckets> {
  // 增加重试次数，与分批处理保持一致
  const maxRetries = 3 // 从2改为3（4次尝试）
  const baseDelay = 5000
  let lastError: any

  for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
    try {
      // 1. 加载聚类 prompt（v4.16 支持 pageType 参数）
      const promptTemplate = await loadPrompt('keyword_intent_clustering')

      // 2. 构建 prompt（v4.16 支持 store 链接）
      let prompt = promptTemplate
        .replace('{{brandName}}', brandName)
        .replace('{{productCategory}}', category || '未分类')
        .replace('{{keywords}}', keywords.join('\n'))
        // v4.16: 添加链接类型参数到 prompt
        .replace(/\{\{linkType\}\}/g, pageType)
      prompt = appendKeywordClusteringOutputGuardrails(prompt)

      // 3. 定义结构化输出 schema（支持4桶产品 或 5桶店铺）
      const isStore = pageType === 'store'
      const responseSchema = {
        type: 'OBJECT' as const,
        properties: {
          bucketA: {
            type: 'OBJECT' as const,
            properties: {
              intent: { type: 'STRING' as const },
              intentEn: { type: 'STRING' as const },
              description: { type: 'STRING' as const },
              keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
            },
            required: ['intent', 'intentEn', 'description', 'keywords'],
          },
          bucketB: {
            type: 'OBJECT' as const,
            properties: {
              intent: { type: 'STRING' as const },
              intentEn: { type: 'STRING' as const },
              description: { type: 'STRING' as const },
              keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
            },
            required: ['intent', 'intentEn', 'description', 'keywords'],
          },
          bucketC: {
            type: 'OBJECT' as const,
            properties: {
              intent: { type: 'STRING' as const },
              intentEn: { type: 'STRING' as const },
              description: { type: 'STRING' as const },
              keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
            },
            required: ['intent', 'intentEn', 'description', 'keywords'],
          },
          bucketD: {
            type: 'OBJECT' as const,
            properties: {
              intent: { type: 'STRING' as const },
              intentEn: { type: 'STRING' as const },
              description: { type: 'STRING' as const },
              keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
            },
            required: ['intent', 'intentEn', 'description', 'keywords'],
          },
          // v4.16: 店铺链接添加 bucketS
          ...(isStore
            ? {
                bucketS: {
                  type: 'OBJECT' as const,
                  properties: {
                    intent: { type: 'STRING' as const },
                    intentEn: { type: 'STRING' as const },
                    description: { type: 'STRING' as const },
                    keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
                  },
                  required: ['intent', 'intentEn', 'description', 'keywords'],
                },
              }
            : {}),
          statistics: {
            type: 'OBJECT' as const,
            properties: {
              totalKeywords: { type: 'INTEGER' as const },
              bucketACount: { type: 'INTEGER' as const },
              bucketBCount: { type: 'INTEGER' as const },
              bucketCCount: { type: 'INTEGER' as const },
              bucketDCount: { type: 'INTEGER' as const },
              // v4.16: 店铺链接添加 bucketSCount
              ...(isStore ? { bucketSCount: { type: 'INTEGER' as const } } : {}),
              balanceScore: { type: 'NUMBER' as const },
            },
            required: isStore
              ? [
                  'totalKeywords',
                  'bucketACount',
                  'bucketBCount',
                  'bucketCCount',
                  'bucketDCount',
                  'bucketSCount',
                  'balanceScore',
                ]
              : [
                  'totalKeywords',
                  'bucketACount',
                  'bucketBCount',
                  'bucketCCount',
                  'bucketDCount',
                  'balanceScore',
                ],
          },
        },
        required: isStore
          ? ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'bucketS', 'statistics']
          : ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'statistics'],
      }

      // 4. 调用 AI（使用智能模型选择）
      const aiResponse = await runKeywordClustering(
        {
          operationType: 'keyword_clustering',
          prompt,
          temperature: 0.3,
          responseSchema,
          responseMimeType: 'application/json',
        },
        userId
      )

      // 5. 记录 token 使用
      if (aiResponse.usage) {
        const cost = estimateTokenCost(
          aiResponse.model,
          aiResponse.usage.inputTokens,
          aiResponse.usage.outputTokens
        )
        await recordTokenUsage({
          userId,
          model: aiResponse.model,
          operationType: 'keyword_clustering',
          inputTokens: aiResponse.usage.inputTokens,
          outputTokens: aiResponse.usage.outputTokens,
          totalTokens: aiResponse.usage.totalTokens,
          cost,
          apiType: aiResponse.apiType,
        })
      }

      let buckets: KeywordBuckets | StoreKeywordBuckets
      try {
        buckets = parseKeywordClusteringJson(aiResponse.text)
      } catch (parseError) {
        const likelyTruncated = isLikelyKeywordClusteringTruncated(aiResponse)
        const canSplit =
          likelyTruncated && keywords.length >= KEYWORD_CLUSTERING_MIN_SPLIT_KEYWORDS * 2

        if (canSplit) {
          const [leftKeywords, rightKeywords] = splitKeywordsForRetry(keywords)
          console.warn(
            `⚠️ 直接聚类响应疑似被 token 截断 ` +
              `(${aiResponse.usage?.outputTokens || 0}/${KEYWORD_CLUSTERING_MAX_OUTPUT_TOKENS})，` +
              `拆分为 ${leftKeywords.length}+${rightKeywords.length} 重试`
          )

          const leftResult = await clusterBatchKeywords(
            leftKeywords,
            brandName,
            category,
            userId,
            1,
            2,
            pageType,
            1
          )
          const rightResult = await clusterBatchKeywords(
            rightKeywords,
            brandName,
            category,
            userId,
            2,
            2,
            pageType,
            1
          )

          buckets = mergeBatchResults([leftResult, rightResult]) as
            | KeywordBuckets
            | StoreKeywordBuckets
        } else {
          console.error('❌ JSON解析失败:', parseError)
          console.error('   原始响应:', aiResponse.text.slice(0, 500))
          const errorMessage = parseError instanceof Error ? parseError.message : '未知错误'
          throw new Error(`JSON解析失败: ${errorMessage}`)
        }
      }

      // 添加数据结构验证（支持4个桶）
      // v4.16: 店铺链接支持5个桶
      if (isStore) {
        // 店铺链接：验证5个桶
        const storeBuckets = buckets as StoreKeywordBuckets
        if (
          !storeBuckets.bucketA ||
          !storeBuckets.bucketB ||
          !storeBuckets.bucketC ||
          !storeBuckets.bucketD ||
          !storeBuckets.bucketS
        ) {
          console.error('❌ AI返回数据结构不完整(店铺):', buckets)
          throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D/S')
        }

        if (
          !Array.isArray(storeBuckets.bucketA.keywords) ||
          !Array.isArray(storeBuckets.bucketB.keywords) ||
          !Array.isArray(storeBuckets.bucketC.keywords) ||
          !Array.isArray(storeBuckets.bucketD.keywords) ||
          !Array.isArray(storeBuckets.bucketS.keywords)
        ) {
          console.error('❌ AI返回的keywords不是数组(店铺):', buckets)
          throw new Error('AI返回的keywords不是数组')
        }

        // 兜底修复 - 避免关键词全部落入桶S导致后续桶A-D无词
        // 先尝试从桶S/原始关键词中恢复 A/B/C/D 的基础分布，再应用后处理规则。
        redistributeStoreBucketsFromS(storeBuckets, keywords)

        // v4.18 后处理规则修正错误分配（促销/型号/评价/地理）
        applyStoreBucketPostProcessing(storeBuckets)
        recalculateStoreBucketStatistics(storeBuckets)

        // 验证店铺结果（只告警，不阻断创意生成）
        validateStoreBuckets(storeBuckets, keywords)

        console.log(`✅ AI 聚类完成 (店铺 5桶):`)
        console.log(`   桶A [品牌信任]: ${storeBuckets.bucketA.keywords.length} 个`)
        console.log(`   桶B [场景解决]: ${storeBuckets.bucketB.keywords.length} 个`)
        console.log(`   桶C [精选推荐]: ${storeBuckets.bucketC.keywords.length} 个`)
        console.log(`   桶D [信任信号]: ${storeBuckets.bucketD.keywords.length} 个`)
        console.log(`   桶S [店铺全景]: ${storeBuckets.bucketS.keywords.length} 个`)
        console.log(`   均衡度得分: ${storeBuckets.statistics.balanceScore.toFixed(2)}`)
      } else {
        // 产品链接：验证4个桶
        const productBuckets = buckets as KeywordBuckets
        if (
          !productBuckets.bucketA ||
          !productBuckets.bucketB ||
          !productBuckets.bucketC ||
          !productBuckets.bucketD
        ) {
          console.error('❌ AI返回数据结构不完整(产品):', buckets)
          throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D')
        }

        if (
          !Array.isArray(productBuckets.bucketA.keywords) ||
          !Array.isArray(productBuckets.bucketB.keywords) ||
          !Array.isArray(productBuckets.bucketC.keywords) ||
          !Array.isArray(productBuckets.bucketD.keywords)
        ) {
          console.error('❌ AI返回的keywords不是数组(产品):', buckets)
          throw new Error('AI返回的keywords不是数组')
        }

        // 验证产品结果
        validateBuckets(productBuckets, keywords)

        console.log(`✅ AI 聚类完成 (产品 4桶):`)
        console.log(`   桶A [产品型号]: ${productBuckets.bucketA.keywords.length} 个`)
        console.log(`   桶B [购买意图]: ${productBuckets.bucketB.keywords.length} 个`)
        console.log(`   桶C [功能特性]: ${productBuckets.bucketC.keywords.length} 个`)
        console.log(`   桶D [紧迫促销]: ${productBuckets.bucketD.keywords.length} 个`)
        console.log(`   均衡度得分: ${productBuckets.statistics.balanceScore.toFixed(2)}`)
      }

      return buckets
    } catch (error: any) {
      lastError = error
      const status = extractHttpStatusFromError(error)
      const retryable = isRetryableClusteringError(error)

      if (retryCount < maxRetries && retryable) {
        // 添加随机抖动，避免重试风暴
        const baseDelayMs = baseDelay * Math.pow(2, retryCount)
        const jitter = Math.random() * 2000 // 0-2秒随机抖动
        const delay = Math.min(baseDelayMs + jitter, 60000) // 最多60秒
        const errorInfo = status
          ? `HTTP ${status} ${status === 504 ? '(Gateway Timeout)' : ''}`
          : String(error?.message || '').substring(0, 80)
        console.warn(
          `⚠️ AI 聚类第 ${retryCount + 1} 次失败 (${errorInfo})，${(delay / 1000).toFixed(1)}s 后重试...`
        )
        console.warn(`   错误: ${error.message}`)
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      console.error('❌ AI 语义聚类失败:', error.message)
      throw new Error(`关键词AI语义分类失败: ${error.message}`)
    }
  }

  throw new Error(
    `关键词AI语义分类失败（重试${maxRetries}次均失败）: ${lastError?.message || '未知错误'}`
  )
}
