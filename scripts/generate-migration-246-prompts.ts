/**
 * Generates migration 246 (SQLite + PostgreSQL) for LLM prompt externalization.
 * Run: npx tsx scripts/generate-migration-246-prompts.ts
 */

import fs from 'fs'
import path from 'path'

type PromptSpec = {
  promptId: string
  version: string
  category: string
  name: string
  description: string
  filePath: string
  functionName: string
  changeNotes: string
  language: string
  contentFile: string
  prependInputGuardrail?: boolean
  deactivateOnActivate?: boolean
}

const ROOT = path.join(__dirname, '..')

const PROMPTS: PromptSpec[] = [
  {
    promptId: 'competitive_positioning_analysis',
    version: 'v1.1',
    category: '广告质量',
    name: '竞争定位分析v1.1',
    description: '广告竞争定位 AI 语义分析，含不可信输入防护',
    filePath: 'prompts/competitive_positioning_analysis_v1.1.txt',
    functionName: 'enhanceCompetitivePositioningWithAI',
    changeNotes: 'v1.1: 外置 Prompt + inputGuardrail + 不可信输入清洗',
    language: 'English',
    contentFile: 'prompts/competitive_positioning_analysis_v1.1.txt',
    deactivateOnActivate: true,
  },
  {
    promptId: 'enhanced_headline_generation',
    version: 'v1.1',
    category: '广告创意生成',
    name: '增强标题生成v1.1',
    description: '增强模块广告标题生成，含合规与输入防护',
    filePath: 'prompts/enhanced_headline_generation_v1.1.txt',
    functionName: 'generateHeadlinesWithAI',
    changeNotes: 'v1.1: 外置 Prompt + inputGuardrail',
    language: 'English',
    contentFile: 'prompts/enhanced_headline_generation_v1.1.txt',
    deactivateOnActivate: true,
  },
  {
    promptId: 'enhanced_description_generation',
    version: 'v1.1',
    category: '广告创意生成',
    name: '增强描述生成v1.1',
    description: '增强模块广告描述生成，含合规与输入防护',
    filePath: 'prompts/enhanced_description_generation_v1.1.txt',
    functionName: 'generateDescriptionsWithAI',
    changeNotes: 'v1.1: 外置 Prompt + inputGuardrail',
    language: 'English',
    contentFile: 'prompts/enhanced_description_generation_v1.1.txt',
    deactivateOnActivate: true,
  },
  {
    promptId: 'keyword_gap_analysis',
    version: 'v1.1',
    category: '关键词生成',
    name: '关键词缺口分析v1.1',
    description: '投放前关键词缺口分析，含不可信输入防护',
    filePath: 'prompts/keyword_gap_analysis_v1.1.txt',
    functionName: 'analyzeKeywordGapsPreGeneration',
    changeNotes: 'v1.1: 外置 Prompt + inputGuardrail',
    language: 'Chinese',
    contentFile: 'prompts/keyword_gap_analysis_v1.1.txt',
    deactivateOnActivate: true,
  },
  {
    promptId: 'keyword_translation_normalization',
    version: 'v1.1',
    category: '关键词生成',
    name: '关键词翻译规范化v1.1',
    description: '关键词批量翻译规范化，含不可信输入防护',
    filePath: 'prompts/keyword_translation_normalization_v1.1.txt',
    functionName: 'buildTranslationPrompt',
    changeNotes: 'v1.1: 外置 Prompt + inputGuardrail',
    language: 'English',
    contentFile: 'prompts/keyword_translation_normalization_v1.1.txt',
    deactivateOnActivate: true,
  },
  {
    promptId: 'product_score_combined_analysis',
    version: 'v1.0',
    category: '产品推荐',
    name: '产品综合评分分析v1.0',
    description: '产品推荐指数合并季节性与产品分析',
    filePath: 'prompts/product_score_combined_analysis_v1.0.txt',
    functionName: 'buildCombinedProductScorePrompt',
    changeNotes: 'v1.0: 外置合并分析 Prompt',
    language: 'English',
    contentFile: 'prompts/product_score_combined_analysis_v1.0.txt',
    deactivateOnActivate: true,
  },
  {
    promptId: 'product_score_combined_analysis_retry',
    version: 'v1.0',
    category: '产品推荐',
    name: '产品综合评分分析重试v1.0',
    description: '产品综合评分 JSON 无效时的重试 Prompt',
    filePath: 'prompts/product_score_combined_analysis_retry_v1.0.txt',
    functionName: 'buildCombinedProductScoreRetryPrompt',
    changeNotes: 'v1.0: 外置重试 Prompt',
    language: 'English',
    contentFile: 'prompts/product_score_combined_analysis_retry_v1.0.txt',
    deactivateOnActivate: true,
  },
  {
    promptId: 'launch_score',
    version: 'v4.17',
    category: '投放评分',
    name: 'Launch Score评估v4.17',
    description: 'Launch Score 4维度评分 - 货币感知与不可信输入防护',
    filePath: 'prompts/launch_score_v4.17.txt',
    functionName: 'calculateLaunchScore',
    changeNotes: 'v4.17: 外置 Prompt + inputGuardrail + 预算/CPC 货币标注',
    language: 'Chinese',
    contentFile: 'prompts/launch_score_v4.17.txt',
    prependInputGuardrail: true,
    deactivateOnActivate: true,
  },
]

function readPromptContent(spec: PromptSpec): string {
  const absolute = path.join(ROOT, spec.contentFile)
  let content = fs.readFileSync(absolute, 'utf8').trimEnd()
  if (spec.prependInputGuardrail && !content.includes('{{inputGuardrail}}')) {
    const lines = content.split('\n')
    const insertAt = Math.min(2, lines.length)
    lines.splice(insertAt, 0, '', '{{inputGuardrail}}', '')
    content = lines.join('\n')
  }
  return content
}

function sqlEscapeContent(content: string): string {
  return content.replace(/'/g, "''")
}

function buildInsertSqlite(spec: PromptSpec, content: string): string {
  const escaped = sqlEscapeContent(content)
  const changeNotesEscaped = sqlEscapeContent(spec.changeNotes)
  const deactivate = spec.deactivateOnActivate
    ? `-- deactivate ${spec.promptId}
UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = '${spec.promptId}' AND is_active = 1;
`
    : ''

  return `${deactivate}INSERT OR REPLACE INTO prompt_versions (
  id,
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes,
  created_at
) VALUES (
  (SELECT id FROM prompt_versions WHERE prompt_id = '${spec.promptId}' AND version = '${spec.version}'),
  '${spec.promptId}',
  '${spec.version}',
  '${spec.category}',
  '${spec.name}',
  '${spec.description}',
  '${spec.filePath}',
  '${spec.functionName}',
  '${escaped}',
  '${spec.language}',
  NULL,
  1,
  replace('${changeNotesEscaped}', char(10), char(10)),
  datetime('now')
);
`
}

function buildInsertPg(spec: PromptSpec, content: string): string {
  const escaped = sqlEscapeContent(content)
  const changeNotesEscaped = sqlEscapeContent(spec.changeNotes)
  const deactivate = spec.deactivateOnActivate
    ? `-- deactivate ${spec.promptId}
UPDATE prompt_versions SET is_active = false WHERE prompt_id = '${spec.promptId}' AND is_active = true;
`
    : ''

  return `${deactivate}INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes,
  created_at
)
VALUES (
  '${spec.promptId}',
  '${spec.version}',
  '${spec.category}',
  '${spec.name}',
  '${spec.description}',
  '${spec.filePath}',
  '${spec.functionName}',
  E'${escaped.replace(/\n/g, '\\n')}',
  '${spec.language}',
  NULL,
  true,
  E'${changeNotesEscaped.replace(/\n/g, '\\n')}',
  NOW()
)
ON CONFLICT (prompt_id, version) DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  file_path = EXCLUDED.file_path,
  function_name = EXCLUDED.function_name,
  prompt_content = EXCLUDED.prompt_content,
  language = EXCLUDED.language,
  is_active = EXCLUDED.is_active,
  change_notes = EXCLUDED.change_notes;
`
}

function main() {
  const sqliteParts = [
    '-- Migration: 246_llm_prompt_externalization_v1.sql',
    '-- Description: Register externalized LLM prompts with input guardrails',
    '-- Date: 2026-05-20',
    '-- Database: SQLite',
    '',
  ]
  const pgParts = [
    '-- Migration: 246_llm_prompt_externalization_v1.pg.sql',
    '-- Description: Register externalized LLM prompts with input guardrails',
    '-- Date: 2026-05-20',
    '-- Database: PostgreSQL',
    '',
  ]

  for (const spec of PROMPTS) {
    const content = readPromptContent(spec)
    sqliteParts.push(buildInsertSqlite(spec, content))
    pgParts.push(buildInsertPg(spec, content))
  }

  sqliteParts.push('')
  pgParts.push('')

  const sqlitePath = path.join(ROOT, 'migrations', '246_llm_prompt_externalization_v1.sql')
  const pgPath = path.join(ROOT, 'pg-migrations', '246_llm_prompt_externalization_v1.pg.sql')
  fs.writeFileSync(sqlitePath, sqliteParts.join('\n'), 'utf8')
  fs.writeFileSync(pgPath, pgParts.join('\n'), 'utf8')
  console.log(`Wrote ${sqlitePath}`)
  console.log(`Wrote ${pgPath}`)
}

main()
