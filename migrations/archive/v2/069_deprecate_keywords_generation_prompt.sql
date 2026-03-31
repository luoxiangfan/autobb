-- =====================================================
-- Migration: 069_deprecate_keywords_generation_prompt.sql
-- Description: 标记 keywords_generation prompt 为废弃
-- Date: 2025-12-14
--
-- 变更原因:
--   - 正向关键词生成已从AI生成迁移到Keyword Planner API
--   - 新架构使用白名单过滤 + 搜索量排序替代AI关键词生成
--   - 相关代码已迁移到 unified-keyword-service.ts
--
-- 影响范围:
--   - prompt_versions 表中的 keywords_generation 记录
--   - 原调用者: /api/ad-groups/[id]/generate-keywords (已更新)
--   - 原调用者: keyword-generator.ts generateKeywords() (已废弃)
--
-- 新替代方案:
--   - 使用 unified-keyword-service.ts 的 getUnifiedKeywordData()
--   - 基于 Google Ads Keyword Planner API
--   - 品牌白名单过滤确保相关性
-- =====================================================

-- 步骤1: 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'keywords_generation' AND is_active = 1;

-- 步骤2: 创建废弃版本记录（保留历史）
INSERT OR REPLACE INTO prompt_versions (
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
  change_notes
) VALUES (
  'keywords_generation',
  'v3.3-deprecated',
  '关键词生成',
  '关键词生成v3.3（已废弃）',
  '⚠️ 已废弃 (2025-12-14): 正向关键词生成已迁移到Keyword Planner API。请使用 unified-keyword-service.ts 的 getUnifiedKeywordData()',
  'src/lib/keyword-generator.ts',
  'generateKeywords',
  '⚠️ DEPRECATED (2025-12-14)

This prompt is no longer in use.

MIGRATION PATH:
- Positive keyword generation → unified-keyword-service.ts getUnifiedKeywordData()
- Uses Google Ads Keyword Planner API
- Brand whitelist filtering for relevance
- Search volume sorting (DESC) for high-value keywords

For negative keywords, use keyword-generator.ts generateNegativeKeywords() which is still active.

旧prompt内容已归档，不再使用。',
  'en',
  NULL,  -- created_by: NULL表示系统创建
  0,
  '⚠️ 废弃原因: AI关键词生成被Keyword Planner API + 白名单过滤替代。新方案提供真实搜索量数据，100%避免竞品关键词冲突。'
);

-- 步骤3: 添加废弃标记到prompt_versions元数据（如果存在metadata字段）
-- 注意: 某些数据库可能没有metadata字段，此操作可选
-- UPDATE prompt_versions
-- SET metadata = json_set(COALESCE(metadata, '{}'), '$.deprecated', true, '$.deprecatedAt', datetime('now'), '$.replacement', 'unified-keyword-service.ts getUnifiedKeywordData()')
-- WHERE prompt_id = 'keywords_generation';
