#!/usr/bin/env tsx
/**
 * 检查autoads用户的AI配置
 */

import Database from 'better-sqlite3'
import path from 'path'

const dbPath = path.join(process.cwd(), 'data', 'autoads.db')
const db = new Database(dbPath, { readonly: true })

console.log('📊 检查autoads用户（userId=1）的AI配置...\n')

const settings = db.prepare(`
  SELECT key,
         CASE
           WHEN key LIKE '%json%' THEN '[JSON_CONTENT]'
           WHEN key LIKE '%key%' THEN '[API_KEY_HIDDEN]'
           ELSE value
         END as display_value,
         LENGTH(value) as value_length
  FROM system_settings
  WHERE category = 'ai' AND user_id = 1
  ORDER BY key
`).all()

if (settings.length === 0) {
  console.log('⚠️  未找到autoads用户的AI配置')
  console.log('\n需要配置以下设置之一：')
  console.log('  1. Vertex AI: use_vertex_ai + gcp_project_id + gcp_service_account_json')
  console.log('  2. Gemini API: gemini_api_key')
} else {
  console.log('✅ 找到以下AI配置：\n')
  settings.forEach((s: any) => {
    console.log(`  ${s.key}: ${s.display_value} (长度: ${s.value_length}字符)`)
  })

  // 检查Vertex AI配置完整性
  const hasVertexAI = settings.some((s: any) => s.key === 'use_vertex_ai')
  const hasProjectId = settings.some((s: any) => s.key === 'gcp_project_id')
  const hasServiceAccount = settings.some((s: any) => s.key === 'gcp_service_account_json')
  const hasGeminiKey = settings.some((s: any) => s.key === 'gemini_api_key')

  console.log('\n配置状态：')
  if (hasVertexAI && hasProjectId && hasServiceAccount) {
    console.log('  ✅ Vertex AI配置完整')
  } else if (hasVertexAI || hasProjectId || hasServiceAccount) {
    console.log('  ⚠️  Vertex AI配置不完整（缺少某些字段）')
  }

  if (hasGeminiKey) {
    console.log('  ✅ Gemini API Key已配置')
  }

  if (!hasVertexAI && !hasGeminiKey) {
    console.log('  ❌ 没有可用的AI配置')
  }
}

db.close()
