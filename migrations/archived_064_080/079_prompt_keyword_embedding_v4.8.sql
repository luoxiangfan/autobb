-- Migration: 079_prompt_keyword_embedding_v4.8.sql
-- Description: 广告创意生成v4.8 - 强化关键词嵌入率
-- Date: 2024-12-14
--
-- 问题分析：
--   - 当前关键词嵌入率仅27% (4/15)，远低于目标53% (8/15)
--   - Prompt中的关键词嵌入指令不够强制和具体
--   - AI没有明确的关键词嵌入示例和验证机制
--
-- 优化策略：
--   1. 在HEADLINE REQUIREMENTS中增加强制性关键词嵌入规则
--   2. 提供具体的关键词嵌入示例和模板
--   3. 在JSON输出中强制要求标记每个headline嵌入的关键词
--   4. 增加关键词嵌入验证检查点

-- 插入新版本 v4.8
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
  '广告创意生成v4.8 - 关键词嵌入率强化版',
  'v4.8',
  '广告创意生成',
  '强化关键词嵌入率：从27%提升到53%+，增加强制性嵌入规则和验证机制',
  'prompts/ad_creative_generation_v4.8.txt',
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

🎯 **AI增强数据 (v4.8优化 - 2025-12-14)**:
{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

## 🚨 v4.8 关键词嵌入率强化 (CRITICAL - 最高优先级)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**这是Ad Strength评估的核心指标，必须严格遵守！**

**🔑 关键词嵌入规则 (MANDATORY)**:

**规则1: 关键词来源 (从{{ai_keywords_section}}选择)**
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 产品核心词必须出现在至少4个标题中
- 功能特性词必须出现在至少2个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale" (关键词: security camera)
- ✅ 正确: "Solar Powered Cameras" (关键词: solar camera)
- ✅ 正确: "Wireless Home Security" (关键词: wireless, home security)
- ❌ 错误: "Camera Camera Security" (关键词堆砌)
- ❌ 错误: "Best Quality Product" (无关键词)

**规则3: 标题类型与关键词匹配**
| 标题类型 | 必须嵌入的关键词类型 | 示例 |
|---------|---------------------|------|
| brand | 品牌词 | "Eufy Security Official" |
| feature | 产品核心词+功能词 | "4K Solar Camera" |
| promo | 产品词+促销词 | "Security Camera Sale" |
| cta | 产品词+行动词 | "Shop Wireless Cameras" |
| urgency | 产品词+紧迫词 | "Camera Deal Ends Soon" |
| social_proof | 品牌词/产品词 | "Top Rated Security Cam" |
| question | 产品词 | "Need Home Security?" |

**规则4: 嵌入数量分配 (总计≥8个)**
- brand类型: 1-2个标题含关键词
- feature类型: 2-3个标题含关键词
- promo类型: 1-2个标题含关键词
- cta类型: 1个标题含关键词
- urgency类型: 1个标题含关键词
- social_proof/question: 1-2个标题含关键词

### 🎯 关键词嵌入示例 (以安防摄像头为例)

**假设关键词列表**: security camera, wireless camera, solar camera, home security, 4K camera, outdoor camera

**正确的15个标题示例 (8个含关键词 ✅)**:
1. "{KeyWord:Eufy} Official" (brand) ✅ 品牌词
2. "4K Security Camera Sale" (promo) ✅ security camera
3. "Wireless Camera No Fees" (feature) ✅ wireless camera
4. "Solar Powered Cameras" (feature) ✅ solar camera
5. "Home Security Made Easy" (feature) ✅ home security
6. "Shop Outdoor Cameras" (cta) ✅ outdoor camera
7. "4K Camera Deal Today" (urgency) ✅ 4K camera
8. "Top Rated Security Cam" (social_proof) ✅ security
9. "Save 30% This Week" (promo)
10. "Free 2-Day Shipping" (promo)
11. "No Monthly Fees Ever" (feature)
12. "24/7 Live Protection" (feature)
13. "Easy DIY Installation" (feature)
14. "30-Day Money Back" (trust)
15. "Award Winning Design" (social_proof)

**关键词嵌入率: 8/15 = 53% ✅**

## 🆕 v4.7 RSA Display Path (保留)

### 🎯 Display Path介绍 (WHAT IS DISPLAY PATH)

**Display Path** 是RSA广告中显示在URL旁边的文字路径，用于提升广告相关性和CTR。
- 展示效果: `example.com/Path1/Path2`
- 与Final URL无关，仅用于展示
- 帮助用户理解点击后会看到什么内容

### 🎯 Display Path要求 (PATH REQUIREMENTS)

**path1 (必填，最多15字符)**:
- 应包含核心产品类别或品牌关键词
- 使用目标语言 {{target_language}}
- ✅ 好例子: "Cameras", "Security", "Solar", "智能摄像", "Telecamere"
- ❌ 避免: 过长词汇、特殊字符、空格

**path2 (可选，最多15字符)**:
- 应包含产品特性、型号或促销信息
- 与path1形成逻辑层级
- ✅ 好例子: "Wireless", "4K-HD", "Sale", "无线", "Offerta"
- ❌ 避免: 与path1重复、无关信息

## 🔥 v4.6 CTR优化增强 (保留)

### 🎯 情感触发词策略 (EMOTIONAL TRIGGERS - CTR +10-15%)

**必须在标题中使用以下情感触发词（至少3个标题）**:

**信任类 (Trust)**:
- "Trusted", "Verified", "#1 Rated", "Official", "Certified"

**独家类 (Exclusivity)**:
- "Exclusive", "Members Only", "VIP", "Limited Edition"

**社会证明类 (Social Proof)**:
- "10000+ Sold", "Best Seller", "Top Rated", "Award Winning"

**价值类 (Value)**:
- "Best Value", "Premium Quality", "Unbeatable", "Superior"

### 🎯 问句式标题 (QUESTION HEADLINES - CTR +5-12%)

**必须**:
- 针对用户痛点或需求提问
- 使用目标语言的疑问词
- ✅ 英语: "Need Home Security?", "Want 4K Quality?", "Looking for Value?"

## 🔥 v4.5 店铺数据增强 (保留)

### 🏪 店铺品牌分析数据利用 (CRITICAL FOR STORE LINKS)

**当检测到店铺分析数据时**:
- **HOT PRODUCT HIGHLIGHTS**: 提取关键词创建标题
- **CUSTOMER PRAISES**: 转化为社会证明标题
- **REAL USE CASES**: 创建场景化标题
- **CUSTOMER CONCERNS**: 主动回应顾虑
- **TRUST INDICATORS**: 在标题中使用信任指标

## 🔥 v4.4 产品特性增强 (保留)

**当检测到 "PRODUCT FEATURES" 数据时**:
- 从PRODUCT FEATURES中提取核心卖点关键词
- 转化为简洁有力的标题（≤30字符）

## 🔥 v4.2 竞争定位增强 (保留)

**1️⃣ 价格优势量化**: "Save €170", "20% Off"
**2️⃣ 独特定位声明**: "The Only", "#1", "Exclusive"
**3️⃣ 隐性竞品对比**: "Unlike others", "Better performance"
**4️⃣ 性价比强调**: "Best Value", "More for Less"

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If exceeds 30 chars, use "{KeyWord:{{brand}}}"
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format.

**🚨 v4.8 HEADLINE REQUIREMENTS (强制执行)**:
- 🔥 **Keyword Embedding**: 8/15 (53%+) headlines MUST contain keywords from {{ai_keywords_section}}
- 🔥 **Keyword Verification**: Each headline MUST specify which keyword it contains in "keywords" field
- 🔥 **Emotional Triggers**: 3+ headlines with emotional power words
- 🔥 **Question Headlines**: 1-2 question-style headlines
- 🔥 **Number Usage**: 5+ headlines with specific numbers
- 🔥 **Diversity**: <20% text similarity, no 2+ shared words

**Headline Types (must cover all)**:
{{headline_brand_guidance}}
{{headline_feature_guidance}}
{{headline_promo_guidance}}
{{headline_cta_guidance}}
{{headline_urgency_guidance}}

Length distribution: 5 short(10-20), 5 medium(20-25), 5 long(25-30)

### DESCRIPTIONS (4 required, ≤90 chars each)

**🎯 v4.6 DESCRIPTION REQUIREMENTS**:
- 🔥 **Structured Templates**: Each description MUST follow a DIFFERENT template
- 🔥 **USP Front-Loading**: Strongest USP in first 30 characters
- 🔥 **Social Proof**: 2/4 descriptions must include proof element
- 🔥 **Differentiation**: 1+ description with implicit competitor comparison

**Template Assignment**:
- Description 1: FEATURE-BENEFIT-CTA (value focus)
- Description 2: PROBLEM-SOLUTION-PROOF (trust focus)
- Description 3: OFFER-URGENCY-TRUST (action focus)
- Description 4: USP-DIFFERENTIATION (competitive focus)

{{description_1_guidance}}
{{description_2_guidance}}
{{description_3_guidance}}
{{description_4_guidance}}

### 🆕 DISPLAY PATH (v4.7)

**path1 (必填，≤15字符)**: 核心产品类别或品牌关键词
**path2 (可选，≤15字符)**: 产品特性、型号或促销信息

### KEYWORDS (20-30 required)
**⚠️ 强制约束：所有关键词必须使用目标语言 {{target_language}}**

**第一优先级 - 品牌短尾词 (8-10个)**
**第二优先级 - 产品核心词 (6-8个)**
**第三优先级 - 购买意图词 (3-5个)**
**第四优先级 - 长尾精准词 (3-7个)**

{{exclude_keywords_section}}

### CALLOUTS (4-6, ≤25 chars)
{{callout_guidance}}

### SITELINKS (6): text≤25, desc≤35, url="/"
- Each sitelink must have UNIQUE description
- Cover: product, promo, shipping, contact, reviews, new arrivals

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CA abuse
**❌ Prohibited Symbols**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
**❌ Excessive Punctuation**: "!!!", "???", "..."

## 🚨 OUTPUT VALIDATION CHECKLIST (v4.8)

Before generating output, verify:
- [ ] At least 8/15 headlines contain keywords from {{ai_keywords_section}}
- [ ] Each headline with keyword has non-empty "keywords" array
- [ ] keyword_embedding_rate >= 0.53 in quality_metrics
- [ ] keywordEmbeddingRate >= 0.53 in ctr_optimization

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency|social_proof|question|emotional", "length":N, "keywords":["keyword1", "keyword2"], "hasNumber":bool, "hasUrgency":bool, "hasEmotionalTrigger":bool, "isQuestion":bool}...],
  "descriptions": [{"text":"...", "type":"feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length":N, "hasCTA":bool, "first30Chars":"...", "hasSocialProof":bool}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "path1": "...",
  "path2": "...",
  "theme": "...",
  "quality_metrics": {"headline_diversity_score":N, "keyword_embedding_rate":0.53, "emotional_trigger_count":N, "question_headline_count":N, "usp_front_loaded_count":N, "estimated_ad_strength":"EXCELLENT"},
  "ctr_optimization": {"keywordEmbeddingRate":0.53, "emotionalTriggerCount":3, "questionHeadlineCount":2, "uspFrontLoadedDescriptions":4, "displayPathOptimized":true}
}',
  'v4.8 关键词嵌入率强化: 1)增加强制性嵌入规则 2)提供具体嵌入示例 3)标题类型与关键词匹配表 4)输出验证检查点 5)目标从27%提升到53%+',
  0  -- 先不激活，等测试通过后再激活
);

-- 查看插入结果
SELECT id, prompt_id, name, version, is_active FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC LIMIT 3;
