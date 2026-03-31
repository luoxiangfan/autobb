#!/usr/bin/env tsx
/**
 * 修复Prompt模板变量格式不一致问题
 *
 * 问题: init-prompts.ts中使用{variable}单花括号，
 *       但代码中使用{{variable}}双花括号进行替换
 *
 * 解决: 将数据库中所有prompt的{variable}改为{{variable}}
 */

import { getDatabase } from '../src/lib/db'

// 需要修复的prompt ID列表
const PROMPTS_TO_FIX = [
  'ad_elements_headlines',
  'ad_elements_descriptions',
  'keywords_generation',
  'competitor_analysis',
  'review_analysis',
  'brand_analysis_store',
  'product_analysis_single',
  'brand_name_extraction'
]

async function fixPromptTemplates() {
  console.log('🔧 开始修复Prompt模板变量格式...\n')

  const db = getDatabase()
  let fixedCount = 0

  for (const promptId of PROMPTS_TO_FIX) {
    try {
      // 获取当前active版本的prompt
      const prompt = await db.queryOne<{
        id: number
        prompt_content: string | Buffer
        version: string
      }>(
        'SELECT id, prompt_content, version FROM prompt_versions WHERE prompt_id = ? AND is_active = 1',
        [promptId]
      )

      if (!prompt) {
        console.log(`⚠️  跳过 ${promptId} - 未找到激活版本`)
        continue
      }

      // 处理Buffer类型
      const content = typeof prompt.prompt_content === 'string'
        ? prompt.prompt_content
        : prompt.prompt_content.toString('utf-8')

      // 检查是否已经是双花括号格式
      if (content.includes('{{') && content.includes('}}')) {
        console.log(`✅ ${promptId} (${prompt.version}) - 已是正确格式，跳过`)
        continue
      }

      // 将单花括号模板变量改为双花括号
      // 匹配 {variable} 但不匹配 JSON 花括号（后面跟换行或逗号的）
      const fixedContent = content.replace(
        /\{([a-zA-Z_][a-zA-Z0-9_\.]*)\}/g,
        '{{$1}}'
      )

      // 检查是否有变化
      if (fixedContent === content) {
        console.log(`⏭️  ${promptId} (${prompt.version}) - 无需修复`)
        continue
      }

      // 更新数据库
      await db.exec(
        'UPDATE prompt_versions SET prompt_content = ? WHERE id = ?',
        [fixedContent, prompt.id]
      )

      // 统计变更
      const originalMatches = content.match(/\{([a-zA-Z_][a-zA-Z0-9_\.]*)\}/g) || []
      const fixedMatches = fixedContent.match(/\{\{([a-zA-Z_][a-zA-Z0-9_\.]*)\}\}/g) || []

      console.log(`✅ ${promptId} (${prompt.version})`)
      console.log(`   修复了 ${originalMatches.length} 个模板变量`)
      console.log(`   示例: ${originalMatches.slice(0, 3).join(', ')}`)
      fixedCount++

    } catch (error: any) {
      console.error(`❌ 修复 ${promptId} 失败:`, error.message)
    }
  }

  console.log(`\n✨ 修复完成！共修复 ${fixedCount} 个 prompt`)

  // 验证修复结果
  console.log('\n📋 验证修复结果:\n')
  const allPrompts = await db.query<{
    prompt_id: string
    version: string
    has_single_brace: number
    has_double_brace: number
  }>(
    `SELECT
       prompt_id,
       version,
       CASE WHEN prompt_content LIKE '%{%' AND prompt_content NOT LIKE '%{{%' THEN 1 ELSE 0 END as has_single_brace,
       CASE WHEN prompt_content LIKE '%{{%}}%' THEN 1 ELSE 0 END as has_double_brace
     FROM prompt_versions
     WHERE is_active = 1
     ORDER BY prompt_id`
  )

  for (const p of allPrompts) {
    const status = p.has_double_brace ? '✅ 双花括号' : p.has_single_brace ? '❌ 单花括号' : '⚪ 无模板变量'
    console.log(`  ${status}  ${p.prompt_id} (${p.version})`)
  }
}

fixPromptTemplates()
  .then(() => {
    console.log('\n✅ 脚本执行成功')
    process.exit(0)
  })
  .catch(error => {
    console.error('\n❌ 脚本执行失败:', error)
    process.exit(1)
  })
