/**
 * 测试 Gemini API axios 代理调用（不做自动降级）
 * GET /api/test-gemini-axios
 * GET /api/test-gemini-axios?model=gemini-3-flash-preview (测试指定模型)
 *
 * 注意：需要登录后才能使用，会使用当前用户的AI配置
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateContent } from '@/lib/gemini-axios'
import { GEMINI_ACTIVE_MODEL, normalizeGeminiModel } from '@/lib/gemini-models'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 获取当前登录用户ID（必需）
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '请先登录后再测试' }, { status: 401 })
    }

    // 从 URL 参数获取模型名称（可选）
    const { searchParams } = new URL(request.url)
    const model = normalizeGeminiModel(searchParams.get('model') || GEMINI_ACTIVE_MODEL)

    console.log(`🧪 用户(ID=${userId})开始测试 Gemini API (axios方案, 模型: ${model})...`)

    const startTime = Date.now()

    const content = await generateContent({
      model,
      prompt: 'Hello, please respond with "Success"',
      temperature: 0.1,
      maxOutputTokens: 50,
    }, parseInt(userId, 10))

    const duration = Date.now() - startTime

    console.log(`✅ Gemini API (axios) 调用成功! 耗时: ${duration}ms`)

    return NextResponse.json({
      success: true,
      content: content,
      requestedModel: model,
      method: 'axios + HttpsProxyAgent',
      duration: `${duration}ms`,
      fallbackSupported: false,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('❌ Gemini API (axios) 调用失败:', error.message)

    let errorType = 'unknown'
    if (error.message.includes('User location is not supported')) {
      errorType = 'geo_restricted'
    } else if (error.message.includes('代理')) {
      errorType = 'proxy_config'
    } else if (error.message.includes('overload')) {
      errorType = 'model_overload'
    } else if (error.response) {
      errorType = 'api_error'
    } else {
      errorType = 'network'
    }

    return NextResponse.json(
      {
        success: false,
        error: error.message,
        errorType,
        errorDetails: error.response?.data || null,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
