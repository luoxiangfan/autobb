/**
 * 测试新的 Gemini API 中转端点可用性
 *
 * 测试目标：
 * - API_URL: 从 TEST_GEMINI_API_URL 读取（默认 https://aicode.cat）
 * - API_KEY: 从 TEST_GEMINI_API_KEY（或 GEMINI_RELAY_API_KEY）读取
 *
 * 测试模型：
 * 1. gemini-3-flash-preview
 * 2. gemini-2.5-pro
 * 3. gemini-2.5-flash
 */

import axios, { AxiosInstance } from 'axios'

const TEST_API_URL = process.env.TEST_GEMINI_API_URL || 'https://aicode.cat'
const TEST_API_KEY = process.env.TEST_GEMINI_API_KEY || process.env.GEMINI_RELAY_API_KEY || ''

if (!TEST_API_KEY) {
  console.error('❌ 缺少 TEST_GEMINI_API_KEY（或 GEMINI_RELAY_API_KEY）环境变量')
  process.exit(1)
}

// 测试配置
const TEST_CONFIG = {
  apiUrl: TEST_API_URL,
  apiKey: TEST_API_KEY,
  models: [
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash'
  ],
  testPrompt: 'Hello! Please respond with "API is working" if you can read this message.',
  timeout: 60000, // 60秒超时
}

interface GeminiRequest {
  contents: Array<{
    parts: Array<{
      text: string
    }>
    role?: string
  }>
  generationConfig?: {
    temperature?: number
    maxOutputTokens?: number
  }
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string
      }>
      role: string
    }
    finishReason: string
  }>
  usageMetadata?: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
  }
}

interface TestResult {
  model: string
  success: boolean
  responseText?: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  error?: string
  latency?: number
}

/**
 * 创建 axios 客户端
 */
function createClient(): AxiosInstance {
  return axios.create({
    baseURL: TEST_CONFIG.apiUrl,
    timeout: TEST_CONFIG.timeout,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'x-api-key': TEST_CONFIG.apiKey,
    },
  })
}

/**
 * 测试单个模型
 */
async function testModel(model: string): Promise<TestResult> {
  const client = createClient()
  const startTime = Date.now()

  console.log(`\n🧪 测试模型: ${model}`)
  console.log(`   - API URL: ${TEST_CONFIG.apiUrl}`)
  console.log(`   - Prompt: "${TEST_CONFIG.testPrompt}"`)

  const request: GeminiRequest = {
    contents: [
      {
        parts: [{ text: TEST_CONFIG.testPrompt }],
        role: 'user',
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 100,
    },
  }

  try {
    const response = await client.post<GeminiResponse>(
      `/v1beta/models/${model}:generateContent`,
      request
    )

    const latency = Date.now() - startTime

    // 检查响应结构
    if (!response.data.candidates || response.data.candidates.length === 0) {
      return {
        model,
        success: false,
        error: '响应中没有 candidates',
        latency,
      }
    }

    const candidate = response.data.candidates[0]

    // 检查 finishReason
    if (candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
      return {
        model,
        success: false,
        error: `异常的 finishReason: ${candidate.finishReason}`,
        latency,
      }
    }

    // 提取响应文本
    if (
      !candidate.content ||
      !candidate.content.parts ||
      candidate.content.parts.length === 0 ||
      !candidate.content.parts[0].text
    ) {
      // 打印详细的调试信息
      console.log(`   🔍 详细调试信息:`)
      console.log(`   - finishReason: ${candidate.finishReason}`)
      console.log(`   - content 存在: ${!!candidate.content}`)
      console.log(`   - parts 存在: ${!!candidate.content?.parts}`)
      console.log(`   - parts 长度: ${candidate.content?.parts?.length || 0}`)
      console.log(`   - 完整响应:`, JSON.stringify(response.data, null, 2).substring(0, 1000))

      return {
        model,
        success: false,
        error: `content.parts 为空 (finishReason: ${candidate.finishReason})`,
        latency,
      }
    }

    const text = candidate.content.parts[0].text

    // 提取 token 使用信息
    let usage
    if (response.data.usageMetadata) {
      usage = {
        inputTokens: response.data.usageMetadata.promptTokenCount || 0,
        outputTokens: response.data.usageMetadata.candidatesTokenCount || 0,
        totalTokens: response.data.usageMetadata.totalTokenCount || 0,
      }
    }

    console.log(`   ✅ 成功`)
    console.log(`   - 响应长度: ${text.length} 字符`)
    console.log(`   - 延迟: ${latency}ms`)
    if (usage) {
      console.log(`   - Token 使用: input=${usage.inputTokens}, output=${usage.outputTokens}, total=${usage.totalTokens}`)
    }

    return {
      model,
      success: true,
      responseText: text,
      usage,
      latency,
    }
  } catch (error: any) {
    const latency = Date.now() - startTime

    console.log(`   ❌ 失败`)
    console.log(`   - HTTP 状态: ${error.response?.status || 'N/A'}`)
    console.log(`   - 错误消息: ${error.message}`)
    console.log(`   - 延迟: ${latency}ms`)

    // 提取详细错误信息
    let errorMessage = error.message
    if (error.response?.data) {
      try {
        let dataStr = error.response.data
        if (Buffer.isBuffer(dataStr)) {
          dataStr = dataStr.toString('utf-8')
        }
        if (typeof dataStr === 'object') {
          dataStr = JSON.stringify(dataStr, null, 2)
        }
        console.log(`   - 响应数据: ${dataStr.substring(0, 500)}`)

        // 尝试解析错误详情
        if (error.response.data.error) {
          const errorDetails = error.response.data.error
          errorMessage = `${errorDetails.code || error.response.status}: ${errorDetails.message || error.message}`
        }
      } catch (parseError) {
        console.log(`   - 响应数据解析失败`)
      }
    }

    return {
      model,
      success: false,
      error: errorMessage,
      latency,
    }
  }
}

/**
 * 运行所有测试
 */
async function runTests() {
  console.log('=' .repeat(80))
  console.log('🚀 开始测试新的 Gemini API 中转端点')
  console.log('=' .repeat(80))
  console.log(`\n📋 测试配置:`)
  console.log(`   - API URL: ${TEST_CONFIG.apiUrl}`)
  console.log(`   - API Key: ${TEST_CONFIG.apiKey.substring(0, 20)}...`)
  console.log(`   - 测试模型数量: ${TEST_CONFIG.models.length}`)
  console.log(`   - 超时时间: ${TEST_CONFIG.timeout}ms`)

  const results: TestResult[] = []

  // 依次测试每个模型
  for (const model of TEST_CONFIG.models) {
    const result = await testModel(model)
    results.push(result)

    // 每个测试之间等待1秒，避免请求过快
    if (model !== TEST_CONFIG.models[TEST_CONFIG.models.length - 1]) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  // 生成测试报告
  console.log('\n' + '=' .repeat(80))
  console.log('📊 测试报告')
  console.log('=' .repeat(80))

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length

  console.log(`\n总体结果: ${successCount}/${results.length} 成功`)
  console.log(`   ✅ 成功: ${successCount}`)
  console.log(`   ❌ 失败: ${failCount}`)

  console.log('\n详细结果:')
  results.forEach((result, index) => {
    console.log(`\n${index + 1}. ${result.model}`)
    console.log(`   状态: ${result.success ? '✅ 成功' : '❌ 失败'}`)
    if (result.success) {
      console.log(`   延迟: ${result.latency}ms`)
      if (result.usage) {
        console.log(`   Token 使用: ${result.usage.totalTokens} (input: ${result.usage.inputTokens}, output: ${result.usage.outputTokens})`)
      }
      if (result.responseText) {
        const preview = result.responseText.length > 100
          ? result.responseText.substring(0, 100) + '...'
          : result.responseText
        console.log(`   响应预览: "${preview}"`)
      }
    } else {
      console.log(`   错误: ${result.error}`)
      console.log(`   延迟: ${result.latency}ms`)
    }
  })

  // 结论和建议
  console.log('\n' + '=' .repeat(80))
  console.log('💡 结论和建议')
  console.log('=' .repeat(80))

  if (successCount === results.length) {
    console.log('\n✅ 所有模型测试通过！')
    console.log('   建议: 可以安全地将 API_URL 从 https://cc.thunderrelay.com/gemini 迁移到 https://aicode.cat')
  } else if (successCount > 0) {
    console.log('\n⚠️ 部分模型测试通过')
    console.log('   成功的模型:')
    results.filter(r => r.success).forEach(r => {
      console.log(`      - ${r.model}`)
    })
    console.log('   失败的模型:')
    results.filter(r => !r.success).forEach(r => {
      console.log(`      - ${r.model}: ${r.error}`)
    })
    console.log('   建议: 检查失败的模型是否在新端点中可用，或考虑只迁移成功的模型')
  } else {
    console.log('\n❌ 所有模型测试失败')
    console.log('   建议: 不要迁移到新端点，检查以下问题:')
    console.log('      1. API Key 是否正确')
    console.log('      2. API URL 是否可访问')
    console.log('      3. 网络连接是否正常')
    console.log('      4. 新端点是否需要特殊的请求头或认证方式')
  }

  console.log('\n' + '=' .repeat(80))

  // 返回退出码
  process.exit(successCount === results.length ? 0 : 1)
}

// 运行测试
runTests().catch(error => {
  console.error('\n❌ 测试脚本执行失败:', error)
  process.exit(1)
})
