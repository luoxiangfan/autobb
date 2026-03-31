-- =====================================================
-- Migration: 070_keyword_pools_and_prompts.sql
-- Description: Offer级关键词池、差异化创意支持和Prompt版本 (SQLite)
-- Date: 2025-12-15
--
-- 功能:
--   1. 创建 offer_keyword_pools 表：Offer级关键词池
--   2. 修改 ad_creatives 表：添加关键词桶关联字段
--   3. keyword_intent_clustering v1.0：关键词意图聚类Prompt
--   4. ad_creative_generation v4.9：主题一致性增强Prompt
-- =====================================================

-- ============================================================
-- PART 1: CREATE offer_keyword_pools 表
-- ============================================================
-- Offer级关键词池：实现关键词分层策略
-- - 共享层：纯品牌词（所有创意共用）
-- - 独占层：语义分桶（产品导向/场景导向/需求导向）

CREATE TABLE IF NOT EXISTS offer_keyword_pools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,

  -- 共享层：纯品牌词
  brand_keywords TEXT NOT NULL DEFAULT '[]',  -- JSON数组

  -- 独占层：语义分桶
  bucket_a_keywords TEXT NOT NULL DEFAULT '[]',  -- JSON数组，产品导向
  bucket_b_keywords TEXT NOT NULL DEFAULT '[]',  -- JSON数组，场景导向
  bucket_c_keywords TEXT NOT NULL DEFAULT '[]',  -- JSON数组，需求导向

  -- 桶意图描述
  bucket_a_intent TEXT DEFAULT '产品导向',
  bucket_b_intent TEXT DEFAULT '场景导向',
  bucket_c_intent TEXT DEFAULT '需求导向',

  -- 元数据
  total_keywords INTEGER NOT NULL DEFAULT 0,
  clustering_model TEXT,  -- 使用的AI模型
  clustering_prompt_version TEXT,  -- 聚类prompt版本
  balance_score REAL,  -- 分桶均衡度评分 0-1

  -- 时间戳
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_keyword_pools_offer ON offer_keyword_pools(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_keyword_pools_user ON offer_keyword_pools(user_id);

-- ============================================================
-- PART 2: ALTER ad_creatives 表
-- ============================================================
-- 添加关键词桶关联字段

-- 添加 keyword_bucket 字段：关键词桶标识 (A/B/C)
ALTER TABLE ad_creatives ADD COLUMN keyword_bucket TEXT CHECK(keyword_bucket IN ('A', 'B', 'C'));

-- 添加 keyword_pool_id 字段：关联到 offer_keyword_pools
ALTER TABLE ad_creatives ADD COLUMN keyword_pool_id INTEGER REFERENCES offer_keyword_pools(id);

-- 添加 bucket_intent 字段：桶意图描述
ALTER TABLE ad_creatives ADD COLUMN bucket_intent TEXT;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_ad_creatives_keyword_bucket ON ad_creatives(keyword_bucket);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_keyword_pool ON ad_creatives(keyword_pool_id);

-- ============================================================
-- PART 3: keyword_intent_clustering v1.0 (新增Prompt)
-- ============================================================
-- 将非品牌关键词按用户搜索意图分成3个语义桶

INSERT INTO prompt_versions (
  prompt_id,
  name,
  version,
  category,
  description,
  file_path,
  function_name,
  prompt_content,
  change_notes,
  is_active
) VALUES (
  'keyword_intent_clustering',
  '关键词意图聚类v1.0',
  'v1.0',
  '关键词管理',
  '将非品牌关键词按用户搜索意图分成3个语义桶：产品导向、场景导向、需求导向',
  'src/lib/offer-keyword-pool.ts',
  'clusterKeywordsByIntent',
  '你是一个专业的Google Ads关键词分析专家。请将以下关键词按用户搜索意图分成3个语义桶。

# 品牌信息
品牌名称：{{brandName}}
产品类别：{{productCategory}}

# 待分类关键词（已排除纯品牌词）
{{keywords}}

# 分桶规则

## 桶A - 产品导向 (Product-Oriented)
**用户画像**：知道要买什么产品，搜索具体产品类型
**关键词特征**：
- 产品类型词：camera, vacuum, headphones
- 型号相关词：eufy camera, eufycam 2, model xxx
- 品类词：security camera, robot vacuum, wireless earbuds
- 产品线词：indoor camera, outdoor camera, doorbell cam

**示例**：
- eufy security camera
- indoor cam
- outdoor camera
- doorbell camera
- eufycam 2 pro

## 桶B - 场景导向 (Scenario-Oriented)
**用户画像**：知道要解决什么问题，搜索使用场景
**关键词特征**：
- 使用场景词：home security, baby monitor, pet watching
- 应用环境词：garage camera, driveway security, backyard monitoring
- 解决方案词：protect home, monitor baby, watch pets

**示例**：
- home security system
- baby monitor camera
- pet watching camera
- driveway security
- garage monitoring

## 桶C - 需求导向 (Demand-Oriented)
**用户画像**：关注具体功能需求，搜索技术规格或购买评价
**关键词特征**：
- 功能特性词：wireless, night vision, 2k resolution, solar powered
- 技术规格词：4k camera, 180 degree view, long battery
- 购买意图词：best, top rated, cheap, affordable
- 比较词：vs, alternative, better than

**示例**：
- wireless security camera
- night vision camera
- 2k resolution camera
- best doorbell camera
- affordable home camera

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶，不能重复
2. **完整性**：所有关键词都必须分配，不能遗漏
3. **均衡性**：尽量保持3个桶的关键词数量相对均衡（理想比例 30%-40%每桶）
4. **语义一致**：同一个桶内的关键词应该有相似的搜索意图

# 特殊情况处理

- **混合关键词**（如"best home security camera"）：
  - 优先按最强意图分类
  - "best"表示需求导向 → 分到桶C

- **品牌+功能词**（如"eufy wireless camera"）：
  - 按功能词分类
  - "wireless"是功能特性 → 分到桶C

# 输出格式（JSON）

{
  "bucketA": {
    "intent": "产品导向",
    "intentEn": "Product-Oriented",
    "description": "用户知道要买什么产品",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketB": {
    "intent": "场景导向",
    "intentEn": "Scenario-Oriented",
    "description": "用户知道要解决什么问题",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketC": {
    "intent": "需求导向",
    "intentEn": "Demand-Oriented",
    "description": "用户关注具体功能需求",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "statistics": {
    "totalKeywords": 90,
    "bucketACount": 30,
    "bucketBCount": 30,
    "bucketCCount": 30,
    "balanceScore": 0.95
  }
}

# 注意事项

1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中，不能遗漏
3. balanceScore计算方式：1 - (max差异 / 总数)，越接近1越均衡',
  'v1.0 初始版本：基于搜索意图的关键词三桶分类',
  1
);

-- ============================================================
-- PART 4: ad_creative_generation v4.10 (关键词分层嵌入)
-- ============================================================
-- 停用旧版本，激活v4.10
-- v4.10核心改进：解决关键词嵌入与主题一致性的冲突
-- 方案：先分桶再嵌入，关键词来源 = 品牌词(共享) + 桶匹配词(独占)

UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

INSERT INTO prompt_versions (
  prompt_id,
  name,
  version,
  category,
  description,
  file_path,
  function_name,
  prompt_content,
  change_notes,
  is_active
) VALUES (
  'ad_creative_generation',
  '广告创意生成v4.10 - 关键词分层嵌入版',
  'v4.10',
  '广告创意生成',
  '解决v4.9关键词嵌入与主题一致性冲突：采用分层关键词策略，品牌词(共享层)+桶匹配词(独占层)，确保嵌入率和主题一致性同时满足',
  'prompts/ad_creative_generation_v4.10.txt',
  'generateAdCreative',
  '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

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
**✅ 关键词嵌入和主题一致性不会冲突**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 这些关键词已经是"品牌词 + 桶匹配词"的组合
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale" (关键词: security camera)
- ✅ 正确: "Solar Powered Cameras" (关键词: solar camera)
- ❌ 错误: "Camera Camera Security" (关键词堆砌)
- ❌ 错误: "Best Quality Product" (无关键词)

**规则3: 嵌入与主题双重验证**
- 每个嵌入的关键词必须同时满足：
  - ✅ 来自{{ai_keywords_section}}
  - ✅ 符合{{bucket_intent}}主题
- 由于关键词已预筛选，两个条件天然兼容

## 🎯 v4.10 主题一致性要求

{{bucket_info_section}}

### 主题约束规则

**桶A（产品导向）文案风格**:
- Headlines: 突出产品线丰富、型号多样、品类齐全
- Descriptions: 介绍产品系列、规格参数、产品优势
- ✅ 示例: "Eufy Indoor & Outdoor Cams | Full Product Line"

**桶B（场景导向）文案风格**:
- Headlines: 突出应用场景、解决方案、使用环境
- Descriptions: 描述使用场景、用户收益、痛点解决
- ✅ 示例: "Protect Your Home 24/7 | Eufy Smart Security"

**桶C（需求导向）文案风格**:
- Headlines: 突出核心功能、技术优势、性能参数
- Descriptions: 强调差异化功能、技术参数、用户评价
- ✅ 示例: "4K Ultra HD Night Vision | Eufy Camera"

### 主题一致性检查清单

- [ ] 100% Headlines体现{{bucket_intent}}主题
- [ ] 100% Descriptions体现{{bucket_intent}}主题
- [ ] 100% 嵌入的关键词来自{{ai_keywords_section}}（已预筛选）
- [ ] 53%+ Headlines包含关键词

## v4.7 RSA Display Path (继承)

**path1 (必填，最多15字符)**: 核心产品类别或品牌关键词
**path2 (可选，最多15字符)**: 产品特性、型号或促销信息

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If exceeds 30 chars, use "{KeyWord:{{brand}}}"
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format.

**🚨 v4.10 HEADLINE REQUIREMENTS**:
- 🔥 **Keyword Embedding**: 8/15 (53%+) headlines MUST contain keywords from {{ai_keywords_section}}
- 🔥 **Theme Consistency**: 100% headlines MUST match {{bucket_intent}} theme
- 🔥 **Emotional Triggers**: 3+ headlines with emotional power words
- 🔥 **Question Headlines**: 1-2 question-style headlines
- 🔥 **Number Usage**: 5+ headlines with specific numbers
- 🔥 **Diversity**: <20% text similarity, no 2+ shared words (excluding embedded keywords from {{ai_keywords_section}})

### DESCRIPTIONS (4 required, ≤90 chars each)

**🎯 v4.10 DESCRIPTION REQUIREMENTS**:
- 🔥 **Theme Consistency**: 100% descriptions MUST match {{bucket_intent}} theme
- 🔥 **Keyword Integration**: Include 1-2 keywords from {{ai_keywords_section}} per description
- 🔥 **USP Front-Loading**: Strongest USP in first 30 characters
- 🔥 **Social Proof**: 2/4 descriptions must include proof element

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
  "keyword_layer_validation": {
    "brand_keywords_used": ["brand1", "brand2"],
    "bucket_keywords_used": ["kw1", "kw2", "kw3"],
    "total_keywords_embedded": 8,
    "embedding_rate": 0.53
  },
  "theme_consistency": {
    "headline_match_rate": 1.0,
    "description_match_rate": 1.0,
    "overall_score": 1.0
  },
  "quality_metrics": {"headline_diversity_score":N, "keyword_embedding_rate":0.53, "emotional_trigger_count":N, "question_headline_count":N, "usp_front_loaded_count":N, "estimated_ad_strength":"EXCELLENT"}
}',
  'v4.10 关键词分层嵌入：解决v4.9关键词嵌入与主题一致性冲突，采用品牌词(共享)+桶匹配词(独占)分层策略，确保两者天然兼容',
  1
);

-- ============================================================
-- VERIFICATION
-- ============================================================
-- 运行以下查询验证迁移成功:
-- SELECT name FROM sqlite_master WHERE type='table' AND name='offer_keyword_pools';
-- PRAGMA table_info(ad_creatives);
-- SELECT prompt_id, version, is_active FROM prompt_versions WHERE prompt_id IN ('ad_creative_generation', 'keyword_intent_clustering') ORDER BY prompt_id, version DESC;
