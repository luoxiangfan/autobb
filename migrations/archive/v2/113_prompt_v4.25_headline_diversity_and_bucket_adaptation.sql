-- Migration: 113_prompt_v4.25_headline_diversity_and_bucket_adaptation.sql
-- Description: 整合v4.23-v4.25：强制5+5+5结构 + 店铺链接例外 + 桶主题适配
-- Date: 2025-12-26
-- Changes:
--   v4.23: 强制3类headline结构(5+5+5)，提升单个创意内部多样性
--   v4.24: 修复店铺链接冲突，5+5+5仅适用单品链接
--   v4.25: 调整5+5+5结构适配桶主题（桶A全品牌/桶B场景/桶C功能/桶D价格/桶S平衡）

-- SQLite & PostgreSQL通用版本

-- Step 1: 更新主规则（v4.23 → v4.25，整合店铺链接例外和桶适配）
-- 1) 如果 v4.25 已存在：仅更新其内容（避免 UNIQUE(prompt_id, version) 冲突）
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    prompt_content,
    '## 🎯 v4.21 单品聚焦要求 (CRITICAL - 2025-12-25)

### ⚠️ 强制规则：所有创意元素必须100%聚焦单品',
    '## 🎯 v4.25 单个创意内部多样性 (CRITICAL - 2025-12-26)

### ⚠️ 适用范围：仅适用于单品链接（product link）

**如果是店铺链接（store link）**：
- 遵循 v4.16 店铺链接特殊规则（桶A/B/C/D/S）
- 不适用5+5+5结构
- 参考 {{store_creative_instructions}} 中的创意类型要求

**如果是单品链接（product link）**：
- 强制执行以下5+5+5结构，并根据当前桶主题调整

### ⚠️ 强制规则：15个Headlines必须分为3类，每类5个（适配桶主题）

**桶A（品牌认知 - {{bucket_intent}}）**：
- 类别1 (5个): 品牌+型号（如"Roborock Qrevo Curv 2 Pro: Official"）
- 类别2 (5个): 品牌+品类（如"Roborock Robot Vacuum Sale"）
- 类别3 (5个): 品牌+场景（如"Roborock for Pet Owners"）
→ 确保15个标题都包含品牌词

**桶B（使用场景 - {{bucket_intent}}）**：
- 类别1 (5个): 场景+型号（如"Pet Hair: Qrevo Curv 2 Pro"）
- 类别2 (5个): 场景+品牌（如"Home Cleaning: Roborock"）
- 类别3 (5个): 纯场景描述（如"Pet Hair Solution"）
→ 确保至少10个标题包含场景词

**桶C（功能特性 - {{bucket_intent}}）**：
- 类别1 (5个): 型号+功能（如"Qrevo Curv 2 Pro: 25000Pa"）
- 类别2 (5个): 品牌+功能（如"Roborock: Auto-Empty"）
- 类别3 (5个): 纯功能描述（如"25000Pa Suction Power"）
→ 确保至少10个标题包含功能词

**桶D（价格促销 - {{bucket_intent}}）**：
- 类别1 (5个): 型号+价格（如"Qrevo Curv 2 Pro: -23% Off"）
- 类别2 (5个): 品牌+促销（如"Roborock Sale: Save Now"）
- 类别3 (5个): 纯价格优惠（如"Limited Time Discount"）
→ 确保至少10个标题包含价格/促销词

**桶S（综合 - {{bucket_intent}}）**：
- 类别1 (5个): 产品型号聚焦（如"Qrevo Curv 2 Pro: 25000 Pa"）
- 类别2 (5个): 品牌+品类聚焦（如"Roborock Robot Vacuum"）
- 类别3 (5个): 场景+功能聚焦（如"Pet Hair Cleaning Solution"）
→ 平衡品牌、功能、场景

**✅ 验证检查**：
- 生成后统计每类数量，必须恰好5+5+5=15
- 检查桶主题关键词覆盖率是否达标

## 🎯 v4.21 单品聚焦要求 (已废弃 - 被v4.25替代)'
  ),
  change_notes = '整合v4.23-v4.25：5+5+5结构 + 店铺链接例外 + 桶主题适配（桶A全品牌/桶B场景/桶C功能/桶D价格/桶S平衡）'
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.25';

-- 2) 如果 v4.25 不存在：才把当前 active 版本升级为 v4.25
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    prompt_content,
    '## 🎯 v4.21 单品聚焦要求 (CRITICAL - 2025-12-25)\n\n### ⚠️ 强制规则：所有创意元素必须100%聚焦单品',
    '## 🎯 v4.25 单个创意内部多样性 (CRITICAL - 2025-12-26)\n\n### ⚠️ 适用范围：仅适用于单品链接（product link）\n\n**如果是店铺链接（store link）**：\n- 遵循 v4.16 店铺链接特殊规则（桶A/B/C/D/S）\n- 不适用5+5+5结构\n- 参考 {{store_creative_instructions}} 中的创意类型要求\n\n**如果是单品链接（product link）**：\n- 强制执行以下5+5+5结构，并根据当前桶主题调整\n\n### ⚠️ 强制规则：15个Headlines必须分为3类，每类5个（适配桶主题）\n\n**桶A（品牌认知 - {{bucket_intent}}）**：\n- 类别1 (5个): 品牌+型号（如\"Roborock Qrevo Curv 2 Pro: Official\"）\n- 类别2 (5个): 品牌+品类（如\"Roborock Robot Vacuum Sale\"）\n- 类别3 (5个): 品牌+场景（如\"Roborock for Pet Owners\"）\n→ 确保15个标题都包含品牌词\n\n**桶B（使用场景 - {{bucket_intent}}）**：\n- 类别1 (5个): 场景+型号（如\"Pet Hair: Qrevo Curv 2 Pro\"）\n- 类别2 (5个): 场景+品牌（如\"Home Cleaning: Roborock\"）\n- 类别3 (5个): 纯场景描述（如\"Pet Hair Solution\"）\n→ 确保至少10个标题包含场景词\n\n**桶C（功能特性 - {{bucket_intent}}）**：\n- 类别1 (5个): 型号+功能（如\"Qrevo Curv 2 Pro: 25000Pa\"）\n- 类别2 (5个): 品牌+功能（如\"Roborock: Auto-Empty\"）\n- 类别3 (5个): 纯功能描述（如\"25000Pa Suction Power\"）\n→ 确保至少10个标题包含功能词\n\n**桶D（价格促销 - {{bucket_intent}}）**：\n- 类别1 (5个): 型号+价格（如\"Qrevo Curv 2 Pro: -23% Off\"）\n- 类别2 (5个): 品牌+促销（如\"Roborock Sale: Save Now\"）\n- 类别3 (5个): 纯价格优惠（如\"Limited Time Discount\"）\n→ 确保至少10个标题包含价格/促销词\n\n**桶S（综合 - {{bucket_intent}}）**：\n- 类别1 (5个): 产品型号聚焦（如\"Qrevo Curv 2 Pro: 25000 Pa\"）\n- 类别2 (5个): 品牌+品类聚焦（如\"Roborock Robot Vacuum\"）\n- 类别3 (5个): 场景+功能聚焦（如\"Pet Hair Cleaning Solution\"）\n→ 平衡品牌、功能、场景\n\n**✅ 验证检查**：\n- 生成后统计每类数量，必须恰好5+5+5=15\n- 检查桶主题关键词覆盖率是否达标\n\n## 🎯 v4.21 单品聚焦要求 (已废弃 - 被v4.25替代)'
  ),
  version = 'v4.25',
  change_notes = '整合v4.23-v4.25：5+5+5结构 + 店铺链接例外 + 桶主题适配（桶A全品牌/桶B场景/桶C功能/桶D价格/桶S平衡）'
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1 AND version = 'v4.22'
  AND NOT EXISTS (
    SELECT 1 FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.25'
  );

-- Step 2: 更新所有v4.22版本标记为v4.25
UPDATE prompt_versions
SET
  prompt_content = REPLACE(prompt_content, '🆕 v4.22:', '🆕 v4.25:'),
  name = '广告创意生成v4.25 - 5+5+5结构+桶主题适配版'
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.25';
