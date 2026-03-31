-- Migration: 207_ad_creative_generation_v5.0.sql
-- Description: ad_creative_generation v5.0 - Intent-Driven Optimization (动态注入)
-- Date: 2026-03-11
-- Database: SQLite

-- v5.0 采用动态注入策略，不修改 prompt_content 本身
-- Intent-driven sections 通过代码在运行时注入（见 creative-orchestrator.ts）
-- 本迁移仅记录版本变更，实际prompt内容保持v4.48不变

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 2) 基于 v4.48 生成 v5.0（幂等）
INSERT OR REPLACE INTO prompt_versions (
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
)
SELECT
  (SELECT id FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v5.0'),
  'ad_creative_generation',
  'v5.0',
  base.category,
  '广告创意生成v5.0 - Intent-Driven Optimization',
  'Intent-driven优化：从review_analysis自动提取场景/痛点/用户问题，为A/B/D三类创意注入平衡策略（关键词+意图），提升CTR和相关性',
  'prompts/ad_creative_generation_v5.0.txt',
  base.function_name,
  replace(
    base.prompt_content,
    '-- Google Ads 广告创意生成 v4.48',
    '-- Google Ads 广告创意生成 v5.0 (Intent-Driven)
-- 注意：本版本通过代码动态注入intent sections，prompt_content保持v4.48基础'
  ),
  base.language,
  base.created_by,
  1,
  replace('v5.0 - Intent-Driven Optimization:
1. 自动从review_analysis提取场景/痛点/用户问题（scenario-extractor.ts）
2. 动态注入intent策略sections（creative-orchestrator.ts）:
   - user_scenarios_section: 用户真实场景
   - user_questions_section: 用户常问问题
   - pain_points_section: 用户痛点
   - quantitative_highlights_section: 量化数据亮点
   - intent_strategy_section: 按bucket类型的策略指导
3. Bucket策略分配:
   - Bucket A (品牌/信任): 40% keyword + 60% intent (侧重信任证据、数据驱动)
   - Bucket B (场景+功能): 30% keyword + 70% intent (侧重场景化、问答式)
   - Bucket D (转化/价值): 40% keyword + 60% intent (侧重价值点、数据驱动)
4. 降级策略: 无review_analysis时自动回退到v4.48纯关键词模式
5. 保持v4.48的所有约束（字符限制、负向信号禁用、KISS-3类型）
',
'\n', char(10)),
  '2026-03-11 00:00:00'
FROM prompt_versions base
WHERE base.prompt_id = 'ad_creative_generation' AND base.version = 'v4.48';

-- 3) 确保新版本激活
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation' AND version = 'v5.0';
