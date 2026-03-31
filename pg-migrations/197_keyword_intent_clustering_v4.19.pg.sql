-- Migration: 197_keyword_intent_clustering_v4.19.pg.sql
-- Description: keyword_intent_clustering v4.19 - 输出稳定性优化
-- Date: 2026-03-02
-- Database: PostgreSQL

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'keyword_intent_clustering' AND is_active = TRUE;

-- 2) 基于 v4.18 生成 v4.19（幂等）
INSERT INTO prompt_versions (
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
  'keyword_intent_clustering',
  'v4.19',
  base.category,
  '关键词意图聚类v4.19 - 输出稳定性优化',
  '在v4.18基础上强化JSON输出硬约束，降低relay链路附加文本与截断导致的解析失败风险',
  'prompts/keyword_intent_clustering_v4.19.txt',
  base.function_name,
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            base.prompt_content,
            $$店铺链接分桶策略 (Store Page) - v4.18 增强版$$,
            $$店铺链接分桶策略 (Store Page) - v4.19 输出稳定版$$
          ),
          $$## 🔥 v4.18 核心原则：精准分配 + 明确排除$$,
          $$## 🔥 v4.19 核心原则：精准分配 + 明确排除 + 输出稳定$$
        ),
        $$## 🎯 分桶决策流程（v4.18）$$,
        $$## 🎯 分桶决策流程（v4.19）$$
      ),
      $$3. **🔥 精准性（v4.18核心）**：$$,
      $$3. **🔥 精准性（v4.19核心）**：$$
    ),
    $$注意事项：
1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中
3. balanceScore = 1 - (max差异 / 总数)
4. 🔥 严格遵循排除规则和优先级！不要将促销词分到桶A，不要将型号词分到桶B$$,
    $$注意事项：
1. 仅返回一个完整JSON对象；禁止markdown、解释、分析、额外文本
2. 所有原始关键词必须出现且仅出现一次（跨桶不得重复）
3. 禁止输出输入列表之外的新关键词
4. description字段使用短语（中文不超过12字，英文不超过8词）
5. 若无法判断归类，放入桶S，不要输出解释
6. balanceScore = 1 - (max差异 / 总数)
7. 🔥 严格遵循排除规则和优先级！不要将促销词分到桶A，不要将型号词分到桶B
8. 输出必须以最外层 } 结束$$
  ),
  base.language,
  base.created_by,
  TRUE,
  $$v4.19:
1. 在v4.18基础上新增输出硬约束：仅允许单一JSON对象，禁止附加解释文本
2. 新增关键词一致性约束：所有输入词必须且仅出现一次，禁止生成输入外关键词
3. 新增description长度约束与不确定场景兜底规则（归入桶S）
4. 目标：提升relay链路下JSON可解析性与稳定性
$$,
  '2026-03-02 11:00:00'
FROM prompt_versions base
WHERE base.prompt_id = 'keyword_intent_clustering' AND base.version = 'v4.18'
ON CONFLICT (prompt_id, version)
DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  file_path = EXCLUDED.file_path,
  function_name = EXCLUDED.function_name,
  prompt_content = EXCLUDED.prompt_content,
  language = EXCLUDED.language,
  created_by = EXCLUDED.created_by,
  is_active = EXCLUDED.is_active,
  change_notes = EXCLUDED.change_notes,
  created_at = EXCLUDED.created_at;

-- 3) 确保新版本激活
UPDATE prompt_versions
SET is_active = TRUE
WHERE prompt_id = 'keyword_intent_clustering' AND version = 'v4.19';
