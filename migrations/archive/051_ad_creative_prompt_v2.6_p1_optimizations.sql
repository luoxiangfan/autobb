-- Migration: 051_ad_creative_prompt_v2.6_p1_optimizations
-- Description: 广告创意生成Prompt v2.5 → v2.6 - P1优化（availability紧迫感 + primeEligible展示）
-- Created: 2025-12-04
-- File: src/lib/ad-creative-generator.ts::buildAdCreativePrompt
-- Version: v2.5 → v2.6


-- ========================================
-- 变更概述
-- ========================================
-- 基于 DATA_UTILIZATION_AUDIT.md 的P1优先级优化，提升2个underutilized字段的利用率：
-- 1. availability（0% → 100%）: 紧迫感营销（"Only X left in stock"）
-- 2. primeEligible（已实现，验证完成）: Prime徽章展示


-- ========================================
-- ⚠️ 注意：此Prompt为代码内Prompt
-- ========================================
-- buildAdCreativePrompt 函数直接在TypeScript代码中构建Prompt，
-- 不存储在prompt_versions表中。此migration仅用于版本记录。
--
-- 实际变更位置：
-- - src/lib/ad-creative-generator.ts:234-930
-- - 数据提取: Lines 326-335
-- - Urgency Headlines: Lines 758-784
-- - Callouts: Lines 921 (已实现)


-- ========================================
-- P1优化详情
-- ========================================

-- 【优化1】availability字段利用（紧迫感营销）
-- --------------------------------------------------------
-- 数据提取 (Lines 326-335):
--   let availability: string | null = null
--   if (offer.scraped_data) {
--     try {
--       const scrapedData = JSON.parse(offer.scraped_data)
--       availability = scrapedData.availability || null
--     } catch {}
--   }
--   if (availability) {
--     extras.push(`AVAILABILITY (Use for urgency): ${availability}`)
--   }
--
-- Prompt增强 (Lines 758-784):
--   - Urgency (3): 🎯 **P1 OPTIMIZATION**: MUST use AVAILABILITY for urgency: "${availability}"
--     * 🎯 **P1 CRITICAL**: If AVAILABILITY contains stock info (e.g., "Only 5 left"),
--       at least ONE headline MUST highlight scarcity
--     * Example: "Only 5 Left - Order Now!" or "Limited Stock - Get Yours Today!"
--     * Trigger: AVAILABILITY contains keywords: "only", "left", "limited", "stock"
--
--   动态逻辑：
--   ${(() => {
--     if (availability) {
--       const hasStockInfo = /only|left|limited|stock|hurry|last/i.test(availability);
--       if (hasStockInfo) {
--         return `\n- 🎯 **P1 CRITICAL - MUST include**: Urgency headline with stock scarcity from AVAILABILITY\n  * Example format: "Only X Left - Order Now!" or "Limited Stock - Buy Today!"`;
--       }
--     }
--     return '';
--   })()}
--
-- 预期效果: +10-15% CTR（紧迫感驱动）


-- 【优化2】primeEligible字段利用（Prime徽章展示）
-- --------------------------------------------------------
-- 验证结果 (Line 921):
--   Callouts Prompt已包含Prime逻辑：
--   ${primeEligible ? '- 🎯 **P1 CRITICAL**: MUST include "Prime Eligible" or "Fast Delivery" callout' : ''}
--
-- 状态: ✅ 已实现，无需额外变更
-- 预期效果: +5-10% CTR（Prime用户吸引）


-- ========================================
-- TypeScript错误修复（Pre-existing Issues）
-- ========================================

-- 修复1: ad-elements-extractor.ts:1765
-- 问题: price字段类型不匹配（undefined vs null）
-- 解决: 添加.map()转换，使用?? null处理undefined
-- 位置: Lines 1763-1773
-- 代码: .map(p => ({ ...p, price: p.price ?? null })) as StoreProduct[]

-- 修复2: offer-scraping-core.ts:116
-- 问题: RawReview接口缺失body和helpful字段
-- 解决: 将text改为body，添加helpful: null
-- 位置: Lines 148-156
-- 代码: { body: text, helpful: null, ... }


-- ========================================
-- 数据库操作（仅用于版本记录）
-- ========================================

-- ad_creative_generation prompt实际上是在代码中动态构建的，
-- 不从数据库加载。但为了保持版本追踪的一致性，
-- 我们在prompt_versions表中记录此次变更。

-- 1. 将当前v2.5版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 2. 插入v2.6版本记录
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
  'v2.6',
  '广告创意生成',
  '广告创意生成（P1优化版）v2.6',
  '基于产品信息、增强关键词、深度评论分析、本地化数据、品牌分析、促销信息等多维数据，生成Google Ads创意文案。v2.6增强availability紧迫感营销和primeEligible展示验证',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  '🎯 P1优化 - availability紧迫感 + primeEligible验证

本版本增强2个P1优先级字段的利用率：

1. **availability字段**（0% → 100%）
   - 数据提取：从scraped_data.availability提取库存信息
   - Prompt增强：Urgency Headlines必须突出库存紧张（"Only X left"）
   - 动态逻辑：检测关键词（only, left, limited, stock）自动生成紧迫感标题
   - 预期效果：+10-15% CTR

2. **primeEligible字段**（验证已实现）
   - 验证结果：Callouts Prompt在line 921已包含Prime逻辑
   - 状态：✅ 已实现，无需额外变更
   - 预期效果：+5-10% CTR

3. **TypeScript错误修复**（Pre-existing Issues）
   - 修复ad-elements-extractor.ts:1765 - price类型不匹配
   - 修复offer-scraping-core.ts:116 - RawReview缺失字段

详细实施报告：claudedocs/P1_OPTIMIZATIONS_IMPLEMENTATION_v2.md
审计报告：DATA_UTILIZATION_AUDIT.md (P1优先级: availability, primeEligible)

代码变更位置：
- 数据提取: Lines 326-335
- Urgency Headlines: Lines 758-784
- Callouts验证: Line 921（已实现）

总预期业务价值：
- CTR提升：+15-25% 潜在提升（紧迫感+Prime吸引）
- 转化率提升：+5-10%（紧迫感驱动行动）
- 广告质量评分：预计维持EXCELLENT',
  'Chinese',
  1,
  '
v2.6 更新内容 (2025-12-04):

【P1优化】availability紧迫感营销

1. **availability紧迫感Headlines**
   - 新增字段提取（Lines 326-335）
   - Urgency Headlines动态逻辑（Lines 758-784）
   - 关键词触发：only, left, limited, stock, hurry, last
   - 从0%利用率 → 100%利用率
   - 预期：+10-15% CTR（紧迫感驱动）

2. **primeEligible验证完成**
   - 验证Callouts Prompt（Line 921）
   - 已实现：Prime Eligible逻辑存在
   - 状态：✅ 无需额外变更
   - 预期：+5-10% CTR（Prime用户吸引）

【TypeScript错误修复】（Pre-existing）

1. **ad-elements-extractor.ts:1765**
   - 问题：price字段类型不匹配（undefined vs null）
   - 解决：.map(p => ({ ...p, price: p.price ?? null }))
   - 位置：Lines 1763-1773

2. **offer-scraping-core.ts:116**
   - 问题：RawReview缺失body和helpful字段
   - 解决：text → body，添加helpful: null
   - 位置：Lines 148-156

【技术细节】
- 0个TypeScript错误（已验证通过）
- 向后兼容（所有逻辑都有null检查）
- 符合Google Ads字符限制规范

【业务价值】
- 总CTR潜在提升：+15-25%
- 转化率提升：+5-10%
- 数据利用率：availability从0% → 100%
- 广告质量：预计维持EXCELLENT

基于审计报告：DATA_UTILIZATION_AUDIT.md (P1: availability, primeEligible)
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
