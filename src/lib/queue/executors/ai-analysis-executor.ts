/**
 * AI Analysis 任务执行器
 *
 * 负责执行AI分析任务，包括：
 * - AI产品分析
 * - 评论分析
 * - 竞品分析
 * - 广告元素提取
 *
 * 🔄 独立任务管理
 * 优势：支持独立重试、优先级调度、任务恢复
 */

import type { Task, TaskExecutor } from '../types'
import { executeAIAnalysis } from '@/lib/ai-analysis-service'
import type { AIAnalysisInput, AIAnalysisResult } from '@/lib/ai-analysis-service'

/**
 * AI Analysis 任务数据接口
 */
export interface AIAnalysisTaskData {
  offerId: number
  userId: number
  extractResult: {
    finalUrl: string
    finalUrlSuffix?: string
    brand?: string | null
    productDescription?: string | null
    targetLanguage?: string
    redirectCount?: number
    redirectChain?: string[]
    pageTitle?: string | null
    resolveMethod?: string
    productCount?: number
    storeData?: any
    amazonProductData?: any
    independentStoreData?: any
    debug?: any
  }
  targetCountry: string
  targetLanguage: string
  options?: {
    enableReviewAnalysis?: boolean
    enableCompetitorAnalysis?: boolean
    enableAdExtraction?: boolean
  }
}

/**
 * 创建 AI Analysis 任务执行器
 */
export function createAIAnalysisExecutor(): TaskExecutor<AIAnalysisTaskData> {
  return async (task: Task<AIAnalysisTaskData>) => {
    const {
      offerId,
      userId,
      extractResult,
      targetCountry,
      targetLanguage,
      options
    } = task.data

    console.log(`🤖 [AIAnalysisExecutor] 开始分析任务: Offer #${offerId}, 用户 #${userId}`)
    console.log(`   URL: ${extractResult.finalUrl}`)
    console.log(`   国家: ${targetCountry}, 语言: ${targetLanguage}`)

    try {
      // 构建AI分析输入
      const analysisInput: AIAnalysisInput = {
        extractResult,
        targetCountry,
        targetLanguage,
        userId,
        enableReviewAnalysis: options?.enableReviewAnalysis ?? true,
        enableCompetitorAnalysis: options?.enableCompetitorAnalysis ?? true,
        enableAdExtraction: options?.enableAdExtraction ?? true
      }

      // 执行AI分析
      const analysisResult: AIAnalysisResult = await executeAIAnalysis(analysisInput)

      console.log(`✅ [AIAnalysisExecutor] AI分析完成: Offer #${offerId}`)
      console.log(`   AI产品分析: ${analysisResult.aiAnalysisSuccess ? '成功' : '失败'}`)
      console.log(`   评论分析: ${analysisResult.reviewAnalysisSuccess ? '成功' : '失败'}`)
      console.log(`   竞品分析: ${analysisResult.competitorAnalysisSuccess ? '成功' : '失败'}`)
      console.log(`   广告提取: ${analysisResult.adExtractionSuccess ? '成功' : '失败'}`)

      return analysisResult
    } catch (error: any) {
      console.error(`❌ [AIAnalysisExecutor] AI分析失败: Offer #${offerId}`, error.message)
      throw error
    }
  }
}
