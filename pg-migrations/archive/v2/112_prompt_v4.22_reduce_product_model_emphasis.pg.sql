-- Migration: 112_prompt_v4.22_reduce_product_model_emphasis.pg.sql
-- Description: 减少单品型号强制比例，提升创意多样性
-- Date: 2025-12-26
-- Changes:
--   1. Headlines: 80% (12/15) → 40-60% (6-9个) 包含产品型号
--   2. Descriptions: 至少2个 → 建议1-2个 包含产品型号
--   3. Sitelinks: 强制至少2个 → 建议1-2个 包含产品型号
--   4. 新增型号平衡策略：6-9个型号标题 + 6-9个品牌/功能/场景标题

-- PostgreSQL版本：更新prompt版本
-- 1) 如果 v4.22 已存在：仅更新其内容（避免 UNIQUE(prompt_id, version) 冲突）
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            prompt_content,
            '✅ **🆕 v4.21: 至少80% (12/15)标题必须包含完整产品型号**',
            '✅ **🆕 v4.22: 建议40-60% (6-9个)标题包含完整产品型号**'
          ),
          '如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），则12个标题必须包含该型号',
          '如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），建议6-9个标题包含该型号，其余标题可聚焦品牌、功能、场景'
        ),
        '🎯 型号识别度检查**：
 - 生成15个标题后，统计包含产品型号的数量
 - 如果少于12个，重新生成直到满足要求',
        '🎯 型号平衡策略**：
 - 6-9个标题：包含完整产品型号（强调具体产品）
 - 6-9个标题：聚焦品牌、功能、场景（扩大受众覆盖）
 - 保持整体多样性，避免过度重复型号'
      ),
      '✅ **🆕 v4.21: 建议至少2个描述包含产品型号**',
      '✅ **🆕 v4.22: 建议1-2个描述包含产品型号**'
    ),
    '✅ **🆕 v4.21: 强制至少2个Sitelink的text包含产品型号**',
    '✅ **🆕 v4.22: 建议1-2个Sitelink的text包含产品型号**'
  ),
  change_notes = '减少单品型号强制比例：Headlines 80%→40-60%，Descriptions/Sitelinks 2个→1-2个（建议）'
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.22';

-- 2) 如果 v4.22 不存在：才把当前 active 的 v4.21 升级为 v4.22
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            prompt_content,
            '✅ **🆕 v4.21: 至少80% (12/15)标题必须包含完整产品型号**',
            '✅ **🆕 v4.22: 建议40-60% (6-9个)标题包含完整产品型号**'
          ),
          '如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），则12个标题必须包含该型号',
          '如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），建议6-9个标题包含该型号，其余标题可聚焦品牌、功能、场景'
        ),
        '🎯 型号识别度检查**：
 - 生成15个标题后，统计包含产品型号的数量
 - 如果少于12个，重新生成直到满足要求',
        '🎯 型号平衡策略**：
 - 6-9个标题：包含完整产品型号（强调具体产品）
 - 6-9个标题：聚焦品牌、功能、场景（扩大受众覆盖）
 - 保持整体多样性，避免过度重复型号'
      ),
      '✅ **🆕 v4.21: 建议至少2个描述包含产品型号**',
      '✅ **🆕 v4.22: 建议1-2个描述包含产品型号**'
    ),
    '✅ **🆕 v4.21: 强制至少2个Sitelink的text包含产品型号**',
    '✅ **🆕 v4.22: 建议1-2个Sitelink的text包含产品型号**'
  ),
  version = 'v4.22',
  change_notes = '减少单品型号强制比例：Headlines 80%→40-60%，Descriptions/Sitelinks 2个→1-2个（建议）'
WHERE prompt_id = 'ad_creative_generation' AND is_active = true AND version = 'v4.21'
  AND NOT EXISTS (
    SELECT 1 FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.22'
  );
