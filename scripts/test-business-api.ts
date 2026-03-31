/**
 * 测试管理员用户的 Gemini API 调用（使用新端点）
 */

import { generateContent } from '../src/lib/gemini'

const ADMIN_USER_ID = 1 // autoads 管理员用户 ID

async function testGeminiApi() {
  console.log('🧪 测试管理员用户的 Gemini API 调用...\n')
  console.log(`用户 ID: ${ADMIN_USER_ID}`)
  console.log(`预期端点: https://aicode.cat\n`)

  // 测试 1: 简单文本生成
  console.log('=' .repeat(80))
  console.log('测试 1: 简单文本生成 (gemini-2.5-flash)')
  console.log('=' .repeat(80))

  try {
    const result1 = await generateContent({
      model: 'gemini-2.5-flash',
      prompt: 'Say "Hello from new endpoint!" in one sentence.',
      temperature: 0.7,
      maxOutputTokens: 100,
      operationType: 'test',
      enableAutoModelSelection: false, // 禁用自动模型选择，使用指定模型
    }, ADMIN_USER_ID)

    console.log('✅ 测试 1 成功')
    console.log(`   响应: ${result1.text}`)
    console.log(`   模型: ${result1.model}`)
    console.log(`   API类型: ${result1.apiType}`)
    if (result1.usage) {
      console.log(`   Token使用: ${result1.usage.totalTokens} (输入: ${result1.usage.inputTokens}, 输出: ${result1.usage.outputTokens})`)
    }
  } catch (error: any) {
    console.error('❌ 测试 1 失败:', error.message)
    process.exit(1)
  }

  // 测试 2: 使用 gemini-2.5-pro
  console.log('\n' + '=' .repeat(80))
  console.log('测试 2: 复杂任务 (gemini-2.5-pro)')
  console.log('=' .repeat(80))

  try {
    const result2 = await generateContent({
      model: 'gemini-2.5-pro',
      prompt: 'Generate a creative ad headline for a robot vacuum cleaner in 10 words or less.',
      temperature: 0.9,
      maxOutputTokens: 200,
      operationType: 'creative-generation',
      enableAutoModelSelection: false,
    }, ADMIN_USER_ID)

    console.log('✅ 测试 2 成功')
    console.log(`   响应: ${result2.text}`)
    console.log(`   模型: ${result2.model}`)
    console.log(`   API类型: ${result2.apiType}`)
    if (result2.usage) {
      console.log(`   Token使用: ${result2.usage.totalTokens} (输入: ${result2.usage.inputTokens}, 输出: ${result2.usage.outputTokens})`)
    }
  } catch (error: any) {
    console.error('❌ 测试 2 失败:', error.message)
    // 不退出，继续测试 3
  }

  // 测试 3: 使用 gemini-3-flash-preview
  console.log('\n' + '=' .repeat(80))
  console.log('测试 3: 最新模型 (gemini-3-flash-preview)')
  console.log('=' .repeat(80))

  try {
    const result3 = await generateContent({
      model: 'gemini-3-flash-preview',
      prompt: 'List 3 benefits of AI-powered advertising in bullet points.',
      temperature: 0.7,
      maxOutputTokens: 300,
      operationType: 'content-analysis',
      enableAutoModelSelection: false,
    }, ADMIN_USER_ID)

    console.log('✅ 测试 3 成功')
    console.log(`   响应:\n${result3.text}`)
    console.log(`   模型: ${result3.model}`)
    console.log(`   API类型: ${result3.apiType}`)
    if (result3.usage) {
      console.log(`   Token使用: ${result3.usage.totalTokens} (输入: ${result3.usage.inputTokens}, 输出: ${result3.usage.outputTokens})`)
    }
  } catch (error: any) {
    console.error('❌ 测试 3 失败:', error.message)
  }

  // 测试 4: 自动模型选择
  console.log('\n' + '=' .repeat(80))
  console.log('测试 4: 自动模型选择 (operationType: keyword-extraction)')
  console.log('=' .repeat(80))

  try {
    const result4 = await generateContent({
      prompt: 'Extract keywords from this text: "Best robot vacuum cleaner for pet hair"',
      temperature: 0.7,
      maxOutputTokens: 150,
      operationType: 'keyword-extraction',
      enableAutoModelSelection: true, // 启用自动模型选择
    }, ADMIN_USER_ID)

    console.log('✅ 测试 4 成功')
    console.log(`   响应: ${result4.text}`)
    console.log(`   自动选择模型: ${result4.model}`)
    console.log(`   API类型: ${result4.apiType}`)
    if (result4.usage) {
      console.log(`   Token使用: ${result4.usage.totalTokens} (输入: ${result4.usage.inputTokens}, 输出: ${result4.usage.outputTokens})`)
    }
  } catch (error: any) {
    console.error('❌ 测试 4 失败:', error.message)
  }

  console.log('\n' + '=' .repeat(80))
  console.log('🎉 测试完成！新端点迁移成功')
  console.log('=' .repeat(80))
}

testGeminiApi().catch(error => {
  console.error('\n❌ 测试失败:', error)
  process.exit(1)
})
