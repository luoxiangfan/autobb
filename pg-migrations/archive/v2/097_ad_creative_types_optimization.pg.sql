-- ===================================================
-- Migration: 097_ad_creative_types_optimization.pg.sql
-- Description: 广告创意类型优化 - 添加generated_buckets字段和更新prompt v4.16
-- Created: 2025-12-23
-- Version: v4.15 → v4.16
-- Database: PostgreSQL
-- Author: Claude Code
-- Safety: 防重复执行 - 使用 DO $$, IF EXISTS, ON CONFLICT DO NOTHING
-- ===================================================

-- ========================================
-- Part 1: 添加 generated_buckets 字段
-- ========================================

-- 🔥 优化背景：
-- 用户点击5次生成5个广告创意，需要记录已生成的创意类型
-- 每次点击时自动选择下一个未生成的类型，避免重复

-- Step 1.1: 检查字段是否已存在（防重复执行）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'offers' AND column_name = 'generated_buckets'
    ) THEN
        ALTER TABLE offers ADD COLUMN generated_buckets TEXT;
        RAISE NOTICE 'generated_buckets 字段已添加';
    ELSE
        RAISE NOTICE 'generated_buckets 字段已存在，跳过添加';
    END IF;
END $$;

-- 设置默认值
ALTER TABLE offers ALTER COLUMN generated_buckets SET DEFAULT '[]';

-- 更新现有记录的默认值
UPDATE offers SET generated_buckets = '[]' WHERE generated_buckets IS NULL;

-- 创建索引加速查询（防重复）
CREATE INDEX IF NOT EXISTS idx_offers_generated_buckets ON offers((generated_buckets::jsonb));

-- ========================================
-- Part 2: 更新 Prompt v4.15 → v4.16
-- ========================================

-- Step 2.0: 检查是否已是 v4.16 活跃版本（防重复执行）
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM prompt_versions
        WHERE prompt_id = 'ad_creative_generation'
          AND version = 'v4.16'
          AND is_active = TRUE
    ) THEN
        RAISE NOTICE 'v4.16 已是活跃版本，跳过迁移';
    ELSE
        -- Step 2.1: 将当前活跃版本设为非活跃（只有存在活跃版本时才执行）
        UPDATE prompt_versions
        SET is_active = FALSE
        WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

        -- Step 2.2: 插入新版本 v4.16（使用 ON CONFLICT 防止重复插入）
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
          change_notes
        ) VALUES (
          'ad_creative_generation',
          'v4.16',
          '广告创意生成',
          '广告创意生成v4.16 - 链接类型区分 + 智能创意选择',
          '根据 page_type 区分单品/店铺，使用不同的创意策略和关键词分布；支持智能选择下一个创意类型',
          'src/lib/ad-creative-generator.ts',
          'buildAdCreativePrompt',
          '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}
{{link_type_section}}

## 🆕 v4.10 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale" (关键词: security camera)
- ❌ 错误: "Camera Camera Security" (关键词堆砌)

## 🔥 v4.15 关键优化 (CRITICAL)

### 💰 1. 货币符号本地化 (P0 CRITICAL)

**{{localization_section}}**

**🔴 强制要求**：所有价格必须使用正确的本地货币符号！
- ✅ UK (GBP): "Save £170", "Only £499"
- ✅ US (USD): "Save $170", "Only $499"
- ❌ 禁止: UK市场使用"$"或"€"，必须用"£"

### ⏰ 2. 紧迫感表达 (P1 CRITICAL)

**所有广告创意必须包含紧迫感元素！**
- **至少 2-3 个 headlines 必须包含紧迫感表达**
- 紧迫感类型：
  - 即时行动: "Order Now", "Shop Today", "Get Yours Now"
  - 时间紧迫: "Limited Time", "Ends Soon", "Today Only"
  - 稀缺信号: "Limited Stock", "Almost Gone", "Few Left"
  - FOMO: "Don''t Miss Out", "Last Chance", "Act Fast"

**✅ 正确示例**:
- "Reolink NVR Kit: Save £170 - Order Now"
- "8 Camera 4K System - Limited Time Offer"

### 💵 3. 价格优势量化 (P0 CRITICAL)

**所有促销类 headlines 必须使用具体金额，不能只用百分比！**

**✅ GOOD (具体金额)**:
- "Save £170 Today"
- "Was £669, Now £499 - Save £170"

**❌ BAD (只有百分比)**:
- "20% Off"
- "Save 20%"

## 🔗 v4.16 链接类型策略 (CRITICAL)

**{{link_type_section}}**

### 单品链接 (Product Page) 策略

**当前链接类型**: 产品页面 (Product Page)
**目标**: 最大化转化，让用户购买这个具体产品

**桶类型与关键词分布**:
| 桶 | 类型 | 品牌词 | 产品型号词 | 功能词 | 价格词 |
|----|------|:-----:|:---------:|:-----:|:-----:|
| A | Product-Specific | 30% | **50%** | 20% | 0% |
| B | Purchase-Intent | 20% | 30% | 10% | **40%** |
| C | Feature-Focused | 20% | 20% | **60%** | 0% |
| D | Urgency-Promo | 20% | 20% | 20% | 20% |
| S | Comprehensive | 40% | 30% | 30% | 0% |

**核心要求**:
- 标题必须与具体产品相关联
- 至少 2 个标题包含具体产品型号或参数
- 至少 2 个描述包含具体价格或折扣信息

### 店铺链接 (Store Page) 策略

**当前链接类型**: 店铺页面 (Store Page)
**目标**: 最大化进店，扩大品牌认知

**桶类型与关键词分布**:
| 桶 | 类型 | 品牌词 | 场景词 | 品类词 | 信任词 |
|----|------|:-----:|:-----:|:-----:|:-----:|
| A | Brand-Trust | **80%** | 10% | 10% | 0% |
| B | Scene-Solution | 20% | **60%** | 20% | 0% |
| C | Collection-Highlight | 40% | 20% | **30%** | 10% |
| D | Trust-Signals | 30% | 10% | 20% | **40%** |
| S | Store-Overview | **50%** | 30% | 20% | 0% |

## 🎯 v4.10 主题一致性要求

{{bucket_info_section}}

### 主题约束规则

**桶A（品牌导向）文案风格**:
- Headlines: 突出品牌实力、官方正品、品牌优势
- Descriptions: 强调品牌价值、官方保障、品牌故事

**桶B（场景导向）文案风格**:
- Headlines: 突出应用场景、解决方案、使用环境
- Descriptions: 描述使用场景、用户收益、痛点解决

**桶C（功能导向）文案风格**:
- Headlines: 突出核心功能、技术优势、性能参数
- Descriptions: 强调差异化功能、技术参数、用户评价

## v4.7 RSA Display Path (继承)

**path1 (必填，最多15字符)**: 核心产品类别或品牌关键词
**path2 (可选，最多15字符)**: 产品特性、型号或促销信息

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If exceeds 30 chars, use "{KeyWord:{{brand}}}"

**🚨 v4.10 HEADLINE REQUIREMENTS**:
- 🔥 **Keyword Embedding**: 8/15 (53%+) headlines MUST contain keywords from {{ai_keywords_section}}
- 🔥 **Theme Consistency**: 100% headlines MUST match {{bucket_intent}} theme
- 🔥 **Emotional Triggers**: 3+ headlines with emotional power words
- 🔥 **Question Headlines**: 1-2 question-style headlines
- 🔥 **Number Usage**: 5+ headlines with specific numbers
- 🔥 **Urgency**: 2-3 headlines MUST include urgency elements
- 🔥 **Price Quantification**: Promo headlines MUST use specific amounts

### DESCRIPTIONS (4 required, ≤90 chars each)

**🎯 v4.10 DESCRIPTION REQUIREMENTS**:
- 🔥 **Theme Consistency**: 100% descriptions MUST match {{bucket_intent}} theme
- 🔥 **Keyword Integration**: Include 1-2 keywords from {{ai_keywords_section}} per description
- 🔥 **USP Front-Loading**: Strongest USP in first 30 characters
- 🔥 **Social Proof**: 2/4 descriptions must include proof element
- 🔥 **Urgency**: At least 1 description MUST include urgency element
- 🔥 **Price Clarity**: If discussing deals, use specific currency symbols and amounts

### KEYWORDS (输出{{ai_keywords_section}}中的全部关键词)
**⚠️ 直接输出{{ai_keywords_section}}中的所有关键词，不要生成新关键词**
**⚠️ 所有关键词必须使用目标语言 {{target_language}}**

{{exclude_keywords_section}}

### CALLOUTS (4-6, ≤25 chars)
{{callout_guidance}}

### SITELINKS (6): text≤25, desc≤35, url="/"

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CA abuse
**❌ Prohibited Symbols**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
**❌ Excessive Punctuation**: "!!!", "???", "..."

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency|social_proof|question|emotional", "length":N, "keywords":["keyword1"], "hasNumber":bool, "hasUrgency":bool, "hasEmotionalTrigger":bool, "isQuestion":bool, "themeMatch":true}...],
  "descriptions": [{"text":"...", "type":"feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length":N, "hasCTA":bool, "first30Chars":"...", "hasSocialProof":bool, "keywords":["keyword1"], "themeMatch":true}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "path1": "...",
  "path2": "...",
  "theme": "...",
  "bucket_type": "{{bucket_type}}",
  "bucket_intent": "{{bucket_intent}}",
  "quality_metrics": {"urgency_headline_count":2, "estimated_ad_strength":"EXCELLENT"}
}',
          'English',
          1,
          TRUE,
          'v4.16 更新内容:
1. 新增链接类型策略（单品 vs 店铺）
2. 新增智能创意选择机制
3. 优化关键词来源优先级
4. 强化主题一致性要求
5. 保留v4.15的货币符号、紧迫感、价格量化优化'
        )
        ON CONFLICT (prompt_id, version) DO NOTHING;

        RAISE NOTICE 'v4.16 迁移完成';
    END IF;
END $$;

-- ========================================
-- Part 3: 验证迁移结果
-- ========================================

-- 验证字段添加成功
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'offers' AND column_name = 'generated_buckets';

-- 验证 prompt 版本
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC
LIMIT 3;

-- ✅ Migration complete!
-- 新功能：
-- 1. offers.generated_buckets 字段用于记录已生成的创意类型
-- 2. ad_creative_generation prompt 更新到 v4.16
-- 3. 支持链接类型区分和智能创意选择
-- 4. 防重复执行 - 多次运行安全
