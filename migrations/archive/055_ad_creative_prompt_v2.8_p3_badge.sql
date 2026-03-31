-- Migration: 053_ad_creative_prompt_v2.8_p3_badge.sql
-- Date: 2025-12-04
-- Description: P3优化 - badge徽章突出展示强化
-- Changes:
--   1. Headlines Brand section: badge从"Use BADGE if available"提升为"P3 CRITICAL - MUST use complete BADGE text"
--   2. Callouts section: badge从普通"MUST include"提升为"P3 CRITICAL - MUST include"（与P2促销同级）
-- Impact: 提升badge信任信号的AI遵循率，确保Amazon's Choice/Best Seller等徽章被充分利用
-- Previous: v2.7 (P2 promotion促销强化)
-- Current: v2.8 (P3 badge徽章突出展示)

-- ============================================================================
-- SECTION 1: Prompt Version History Management
-- ============================================================================

-- Record this prompt version in history
INSERT INTO prompt_version_history (
  version,
  component,
  change_type,
  description,
  optimization_priority,
  created_at
) VALUES (
  'v2.8',
  'ad_creative_generator',
  'P3_optimization',
  'Badge徽章突出展示强化: Headlines Brand和Callouts都提升为CRITICAL级别，确保Amazon''s Choice/Best Seller等trust signals被充分利用',
  'P3',
  datetime('now')
);

-- ============================================================================
-- SECTION 2: Change Details Documentation
-- ============================================================================

-- Document specific changes for this version
INSERT INTO prompt_change_log (
  version,
  change_number,
  section,
  change_description,
  before_text,
  after_text,
  rationale,
  expected_impact,
  created_at
) VALUES
-- Change 1: Headlines Brand section
(
  'v2.8',
  1,
  'Headlines - Brand (Line 731)',
  'Badge从建议使用提升为P3 CRITICAL强制使用',
  'Use BADGE if available (e.g., "${badge} Brand")',
  '🎯 **P3 CRITICAL - MUST use complete BADGE text**: "${badge}" (e.g., "${badge} | ${offer.brand}", "${badge} - Trusted Quality")',
  'Badge是Amazon平台最强的trust signal之一（Amazon''s Choice, Best Seller等），应与促销同级别强制要求AI使用完整badge文本，避免被简化或省略',
  '预期AI在badge存在时100%使用，且使用完整文本（不截断或改写），提升广告可信度和CTR 10-15%',
  datetime('now')
),
-- Change 2: Callouts section
(
  'v2.8',
  2,
  'Callouts (Line 945)',
  'Badge从普通MUST include提升为P3 CRITICAL级别',
  '- **MUST include**: "${badge}"',
  '- 🎯 **P3 CRITICAL - MUST include**: "${badge}"',
  'Badge与promotion同为高价值转化要素，应使用相同的CRITICAL级别指令，确保AI在Callouts section中优先展示badge',
  '预期badge在Callouts中的展示优先级提升，与Prime、库存、促销信息并列为最高优先级callout',
  datetime('now')
);

-- ============================================================================
-- SECTION 3: Optimization Metrics Tracking
-- ============================================================================

-- Track P3 optimization metrics baseline
INSERT INTO prompt_optimization_metrics (
  version,
  optimization_type,
  target_field,
  baseline_utilization_rate,
  target_utilization_rate,
  measurement_method,
  created_at
) VALUES
(
  'v2.8',
  'P3_badge_prominence',
  'badge',
  0.00,  -- Current: badge extraction not implemented, 0% utilization
  1.00,  -- Target: 100% utilization when badge exists
  'SELECT COUNT(CASE WHEN scraped_data LIKE ''%"badge"%'' AND scraped_data NOT LIKE ''%"badge":null%'' THEN 1 END) * 1.0 / COUNT(*) FROM offers WHERE scraped_data IS NOT NULL',
  datetime('now')
);

-- ============================================================================
-- SECTION 4: P3 Badge Data Availability Analysis
-- ============================================================================

-- Document badge data source and availability
INSERT INTO data_utilization_analysis (
  version,
  data_field,
  source_table,
  source_column,
  extraction_status,
  current_availability_rate,
  utilization_blockers,
  recommended_action,
  created_at
) VALUES
(
  'v2.8',
  'badge',
  'offers',
  'scraped_data.badge',
  'not_extracted',
  0.00,  -- 0% because badge is not being extracted from Amazon product pages
  'Badge字段在AmazonProductData接口中缺失，scraper未提取badge信息（Amazon''s Choice, Best Seller等）',
  '需要在scraper-stealth.ts中添加badge提取逻辑：1) 检测页面中的badge元素（通常在产品标题附近），2) 提取badge文本（如"Amazon''s Choice for [category]"或"#1 Best Seller in [category]"），3) 存储到scraped_data.badge字段',
  datetime('now')
);

-- ============================================================================
-- SECTION 5: Cross-Optimization Dependencies
-- ============================================================================

-- Document relationship with other optimization levels
INSERT INTO optimization_dependencies (
  current_version,
  depends_on_version,
  dependency_type,
  dependency_description,
  created_at
) VALUES
-- P3 badge依赖P2 promotion的CRITICAL指令模式
(
  'v2.8',
  'v2.7',
  'pattern_dependency',
  'P3 badge使用P2 promotion建立的CRITICAL指令模式（🎯 **P2/P3 CRITICAL - MUST include**），保持架构一致性',
  datetime('now')
),
-- P3 badge与P1 availability使用相同的conditional MUST pattern
(
  'v2.8',
  'v2.6',
  'pattern_dependency',
  'P3 badge沿用P1建立的conditional MUST pattern（${field ? "MUST include" : ""}），确保数据存在时强制使用',
  datetime('now')
);

-- ============================================================================
-- SECTION 6: Implementation Validation Checklist
-- ============================================================================

-- Create validation checklist for this optimization
INSERT INTO implementation_validation (
  version,
  validation_item,
  validation_type,
  validation_query,
  expected_result,
  created_at
) VALUES
-- Validation 1: TypeScript compilation
(
  'v2.8',
  'TypeScript编译通过',
  'code_quality',
  'npx tsc --noEmit',
  '0 errors',
  datetime('now')
),
-- Validation 2: Code changes applied
(
  'v2.8',
  '3处代码修改正确应用',
  'code_integrity',
  'grep -n "P3 CRITICAL" /Users/jason/Documents/Kiro/autobb/src/lib/ad-creative-generator.ts',
  '2 matches found (line 731 Headlines + line 945 Callouts)',
  datetime('now')
),
-- Validation 3: Version annotation updated
(
  'v2.8',
  'Version annotation更新',
  'documentation',
  'grep -A 3 "@version v2.8" /Users/jason/Documents/Kiro/autobb/src/lib/ad-creative-generator.ts',
  'Contains P3优化 - badge徽章突出展示',
  datetime('now')
),
-- Validation 4: Badge extraction implementation (future)
(
  'v2.8',
  'Badge提取功能实现',
  'feature_implementation',
  'grep -n "badge" /Users/jason/Documents/Kiro/autobb/src/lib/scraper-stealth.ts',
  'Badge extraction logic present (FUTURE - not yet implemented)',
  datetime('now')
);

-- ============================================================================
-- SECTION 7: P3 Badge Examples and Best Practices
-- ============================================================================

-- Document badge examples for reference
INSERT INTO optimization_examples (
  version,
  example_type,
  example_category,
  example_data,
  usage_context,
  created_at
) VALUES
-- Example 1: Amazon's Choice badge
(
  'v2.8',
  'badge_example',
  'amazons_choice',
  '{"badge": "Amazon''s Choice for security cameras", "headline_example": "Amazon''s Choice | BRAND - 4K Security Cam", "callout_example": "Amazon''s Choice"}',
  'When product has Amazon''s Choice designation, use complete text in headlines and callouts',
  datetime('now')
),
-- Example 2: Best Seller badge
(
  'v2.8',
  'badge_example',
  'best_seller',
  '{"badge": "#1 Best Seller in Home Security", "headline_example": "#1 Best Seller | Top Rated Cam", "callout_example": "#1 Best Seller"}',
  'When product is #1 Best Seller, prominently feature ranking in headlines',
  datetime('now')
),
-- Example 3: Category leader badge
(
  'v2.8',
  'badge_example',
  'category_leader',
  '{"badge": "Best Seller", "headline_example": "Best Seller - BRAND Quality You Trust", "callout_example": "Best Seller"}',
  'Generic Best Seller badge (without ranking) still provides trust signal',
  datetime('now')
);

-- ============================================================================
-- SECTION 8: Rollback Information
-- ============================================================================

-- Document rollback procedure if needed
INSERT INTO rollback_procedures (
  version,
  rollback_to_version,
  rollback_reason,
  rollback_steps,
  data_impact,
  created_at
) VALUES
(
  'v2.8',
  'v2.7',
  'If P3 badge optimization causes issues or badge data quality is poor',
  '1. Revert line 234-238: @version v2.8 → v2.7
2. Revert line 731: Remove "P3 CRITICAL" from badge directive
3. Revert line 945: Remove "P3 CRITICAL" from badge callout
4. Run: npx tsc --noEmit (verify 0 errors)
5. Deploy updated code',
  'No database changes - rollback only affects prompt generation logic',
  datetime('now')
);

-- ============================================================================
-- SECTION 9: Success Metrics Definition
-- ============================================================================

-- Define success metrics for P3 optimization
INSERT INTO success_metrics (
  version,
  metric_name,
  metric_type,
  baseline_value,
  target_value,
  measurement_frequency,
  success_threshold,
  created_at
) VALUES
-- Metric 1: Badge utilization rate
(
  'v2.8',
  'Badge Utilization Rate',
  'utilization',
  0.00,  -- Current: 0% (badge not extracted)
  1.00,  -- Target: 100% when badge exists
  'daily',
  0.95,  -- Success: ≥95% utilization
  datetime('now')
),
-- Metric 2: Badge text completeness
(
  'v2.8',
  'Badge Text Completeness',
  'quality',
  NULL,  -- Baseline: TBD after extraction implemented
  1.00,  -- Target: 100% complete text (no truncation)
  'weekly',
  0.90,  -- Success: ≥90% use complete badge text
  datetime('now')
),
-- Metric 3: CTR improvement (estimated)
(
  'v2.8',
  'CTR Improvement with Badge',
  'performance',
  NULL,  -- Baseline: TBD from A/B testing
  0.12,  -- Target: +12% CTR for ads with badge vs without
  'monthly',
  0.10,  -- Success: ≥10% CTR improvement
  datetime('now')
);

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
