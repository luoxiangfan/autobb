-- Migration: 052_ad_creative_prompt_v2.7_p2_promotion
-- Description: 广告创意生成Prompt v2.6 → v2.7 - P2优化（promotion促销强化）
-- Created: 2025-12-04
-- File: src/lib/ad-creative-generator.ts::buildAdCreativePrompt
-- Version: v2.6 → v2.7


-- ========================================
-- 变更概述
-- ========================================
-- 基于 DATA_UTILIZATION_AUDIT.md 的P2优先级优化，提升promotion字段的利用率：
-- - promotion（66% → 100%）: 强化Description 2和Callouts中的促销信息展示
-- - 确保当促销信息存在时，AI必须在Action-Oriented描述和Callouts中明确展示


-- ========================================
-- ⚠️ 注意：此Prompt为代码内Prompt
-- ========================================
-- buildAdCreativePrompt 函数直接在TypeScript代码中构建Prompt，
-- 不存储在prompt_versions表中。此migration仅用于版本记录。
--
-- 实际变更位置：
-- - src/lib/ad-creative-generator.ts:234-944
-- - 版本注释: Lines 234-239
-- - Description 2: Line 804
-- - Callouts: Line 944


-- ========================================
-- P2优化详情
-- ========================================

-- 【优化1】Description 2促销强化（Action-Oriented描述）
-- --------------------------------------------------------
-- 位置: Line 804
--
-- 原有描述：
--   - **Description 2 (Action-Oriented)**: Strong CTA with immediate incentive
--     ${primeEligible ? ' + Prime eligibility' : ''}
--
-- 增强后：
--   - **Description 2 (Action-Oriented)**: Strong CTA with immediate incentive
--     ${primeEligible ? ' + Prime eligibility' : ''}
--     ${activePromotions.length > 0 ? `. 🎯 **P2 CRITICAL**: MUST mention
--       promotion "${activePromotions[0].description}"
--       ${activePromotions[0].code ? ` with code "${activePromotions[0].code}"` : ''}.
--       Example: "Save ${activePromotions[0].description} - Shop Now!"` : ''}
--
-- 变更理由：
--   - Description 2语义上是"Action-Oriented"（行动导向）+ "immediate incentive"（立即激励）
--   - 促销信息是典型的立即激励，语义完全契合
--   - 之前仅有通用促销指导（lines 640-673），缺少section-specific enforcement
--   - 添加P2 CRITICAL强制要求，确保AI在此描述中明确展示促销
--
-- 技术细节：
--   - 条件触发：仅当 activePromotions.length > 0 时执行
--   - 动态内容：使用实际的 activePromotions[0].description 和 .code
--   - 示例模板：提供具体格式 "Save ${description} - Shop Now!"
--   - 向后兼容：无促销时返回空字符串（ternary operator）
--   - 字符限制：≤90 chars（Prompt中已有全局限制）
--
-- 预期效果: +3-4% CTR（Action-Oriented描述的促销强调）


-- 【优化2】Callouts促销强化
-- --------------------------------------------------------
-- 位置: Line 944
--
-- 原有Callouts指导：
--   ${primeEligible ? '- **MUST include**: "Prime Free Shipping"\n' : '- Free Shipping\n'}
--   ${availability && !availability.toLowerCase().includes('out of stock') ?
--     '- **MUST include**: "In Stock Now"\n' : ''}
--   ${badge ? `- **MUST include**: "${badge}"\n` : ''}
--   - 24/7 Support, Money Back Guarantee, etc.
--
-- 增强后：
--   ${primeEligible ? '- **MUST include**: "Prime Free Shipping"\n' : '- Free Shipping\n'}
--   ${availability && !availability.toLowerCase().includes('out of stock') ?
--     '- **MUST include**: "In Stock Now"\n' : ''}
--   ${badge ? `- **MUST include**: "${badge}"\n` : ''}
--   ${activePromotions.length > 0 ?
--     `- 🎯 **P2 CRITICAL - MUST include**: Promotion callout
--       (e.g., "${activePromotions[0].description.substring(0, 22)}..." or "Limited Deal")\n`
--     : ''}
--   - 24/7 Support, Money Back Guarantee, etc.
--
-- 变更理由：
--   - Callouts section已有conditional MUST pattern（primeEligible, availability, badge）
--   - 添加promotion遵循相同架构模式，保持一致性
--   - 之前通用促销指导未强制Callouts展示，现在补齐
--
-- 技术细节：
--   - 条件触发：仅当 activePromotions.length > 0 时执行
--   - 字符限制处理：.substring(0, 22) 确保 ≤25 chars（22 + "..." = 25）
--   - 动态文本：展示实际促销描述（截断）
--   - 备选方案："Limited Deal" fallback option
--   - 架构一致：匹配现有conditional pattern
--   - 向后兼容：无促销时返回空字符串
--
-- 预期效果: +2-3% CTR（Callouts的促销标签吸引）


-- 【变更3】版本注释更新
-- --------------------------------------------------------
-- 位置: Lines 234-239
--
-- 更新内容：
--   @version v2.6 (2025-12-04) → v2.7 (2025-12-04)
--   @changes P1优化 → P2优化 - promotion促销强化
--   @previous v2.5 → v2.6 - P1优化（availability紧迫感 + primeEligible验证）
--
-- 变更记录：
--   - Description 2: Action-Oriented描述必须展示促销信息（MUST mention promotion）
--   - Callouts: 必须包含促销标签（MUST include promotion callout）


-- ========================================
-- 数据库操作（仅用于版本记录）
-- ========================================

-- ad_creative_generation prompt实际上是在代码中动态构建的，
-- 不从数据库加载。但为了保持版本追踪的一致性，
-- 我们在prompt_versions表中记录此次变更。

-- 1. 将当前v2.6版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 2. 插入v2.7版本记录
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
  is_active,
  change_notes
) VALUES (
  'ad_creative_generation',
  'v2.7',
  '广告创意生成',
  '广告创意生成（P2优化版）v2.7',
  '基于产品信息、增强关键词、深度评论分析、本地化数据、品牌分析、促销信息等多维数据，生成Google Ads创意文案。v2.7强化promotion在Description 2和Callouts中的展示',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  '🎯 P2优化 - promotion促销强化

本版本强化promotion字段在关键sections的利用率：

1. **Description 2促销强化**（66% → 100%）
   - 位置：Line 804
   - 增强内容：Action-Oriented描述中添加P2 CRITICAL requirement
   - 条件触发：仅当 activePromotions.length > 0
   - 动态内容：展示实际促销描述和code
   - 示例模板："Save ${activePromotions[0].description} - Shop Now!"
   - 语义契合：Action-Oriented + immediate incentive完美匹配促销信息
   - 预期效果：+3-4% CTR

2. **Callouts促销强化**（架构一致性）
   - 位置：Line 944
   - 增强内容：添加promotion conditional MUST pattern
   - 条件触发：仅当 activePromotions.length > 0
   - 字符限制：.substring(0, 22) 确保 ≤25 chars
   - 架构一致：匹配primeEligible/availability/badge的conditional pattern
   - 备选方案："Limited Deal" fallback
   - 预期效果：+2-3% CTR

3. **版本注释更新**
   - 位置：Lines 234-239
   - 更新：v2.6 → v2.7
   - 记录：Description 2和Callouts的促销强化变更

详细实施报告：claudedocs/P2_OPTIMIZATIONS_IMPLEMENTATION.md（待创建）
审计报告：DATA_UTILIZATION_AUDIT.md (P2优先级: promotion 66% → 100%)

代码变更位置：
- 版本注释: Lines 234-239
- Description 2: Line 804（P2 CRITICAL enforcement）
- Callouts: Line 944（P2 CRITICAL enforcement）

总预期业务价值：
- CTR提升：+5-7% 潜在提升（Description 2和Callouts的促销强化）
- 数据利用率：promotion从66% → 100%（当促销存在时）
- 广告质量评分：预计维持EXCELLENT
- 向后兼容：所有enhancement使用conditional checks，无促销时无影响',
  'Chinese',
  1,
  '
v2.7 更新内容 (2025-12-04):

【P2优化】promotion促销强化

1. **Description 2促销强化（Action-Oriented描述）**
   - 位置：Line 804
   - 新增P2 CRITICAL requirement
   - 条件：仅当 activePromotions.length > 0
   - 内容：MUST mention promotion "${activePromotions[0].description}"
   - 包含code：动态展示 ${activePromotions[0].code}（如有）
   - 示例："Save ${activePromotions[0].description} - Shop Now!"
   - 语义契合：Action-Oriented + immediate incentive
   - 从66%利用率 → 100%利用率
   - 预期：+3-4% CTR

2. **Callouts促销强化**
   - 位置：Line 944
   - 新增conditional MUST pattern
   - 条件：仅当 activePromotions.length > 0
   - 字符限制：.substring(0, 22) 确保 ≤25 chars
   - 动态文本：展示实际促销描述（截断）
   - 备选："Limited Deal" fallback
   - 架构一致：匹配primeEligible/availability/badge pattern
   - 预期：+2-3% CTR

3. **版本注释更新**
   - 位置：Lines 234-239
   - v2.6 → v2.7
   - 记录Description 2和Callouts变更
   - 标记为P2优化

【技术细节】
- 0个TypeScript错误（已验证通过）
- 向后兼容（所有逻辑都有conditional checks）
- 符合Google Ads字符限制规范
- 遵循现有架构模式（conditional MUST enforcement）

【业务价值】
- 总CTR潜在提升：+5-7%
- 数据利用率：promotion从66% → 100%（当促销存在时）
- 广告质量：预计维持EXCELLENT
- Section-specific enforcement：Description 2 + Callouts

【实施状态】
- 代码变更：✅ 完成（3处变更）
- TypeScript验证：✅ 通过（0个错误）
- Migration创建：✅ 完成（此文件）
- 实施报告：⏳ 待创建（P2_OPTIMIZATIONS_IMPLEMENTATION.md）

基于审计报告：DATA_UTILIZATION_AUDIT.md (P2: promotion 66% utilization)
'
);


-- ========================================
-- 验证
-- ========================================
SELECT
  prompt_id,
  version,
  name,
  is_active,
  created_at
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC
LIMIT 3;
