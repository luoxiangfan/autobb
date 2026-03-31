-- Migration: 066_prompt_updates_v3.2_v4.2.sql
-- Description: Prompt版本更新 - Launch Score v3.2 + Ad Creative v4.2 + 激活状态修复
-- Date: 2025-12-10
--
-- 变更内容:
-- 1. Launch Score v3.2: 修复JSON输出格式，匹配ScoreAnalysis接口字段名
-- 2. Ad Creative v4.2: 增强竞争定位维度（价格优势、独特定位、竞品对比、性价比）
-- 3. 修复ad_elements_descriptions/headlines激活状态
-- 4. 统一所有Prompt名称为中文
-- 5. 统一ad_creative_generation的category为"广告创意生成"

-- ============================================================
-- 1. 统一数据一致性修复
-- ============================================================

-- 统一ad_creative_generation的category（修复历史不一致：有些是"ad_creative"，有些是"广告创意生成"）
UPDATE prompt_versions
SET category = '广告创意生成'
WHERE prompt_id = 'ad_creative_generation' AND category != '广告创意生成';

-- 激活缺失的Prompt版本（ad_elements_descriptions和ad_elements_headlines所有版本都是is_active=0）
UPDATE prompt_versions SET is_active = 1 WHERE prompt_id = 'ad_elements_descriptions' AND version = 'v3.2';
UPDATE prompt_versions SET is_active = 1 WHERE prompt_id = 'ad_elements_headlines' AND version = 'v3.2';

-- ============================================================
-- 2. Launch Score Prompt v3.2
-- 问题: AI返回JSON字段名(dimensions.keywordQuality)与代码期望(keywordAnalysis)不匹配
-- ============================================================

-- 禁用旧版本
UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = 'launch_score_evaluation' AND version != 'v3.2';

-- 插入新版本 v3.2
INSERT OR IGNORE INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, created_at, change_notes
)
VALUES (
  'launch_score_evaluation',
  'v3.2',
  '投放评分',
  '投放评分v3.2',
  '修复JSON输出格式，匹配ScoreAnalysis接口字段名',
  'src/lib/scoring.ts',
  'createLaunchScore',
  'You are a professional Google Ads campaign launch evaluator.

=== CAMPAIGN OVERVIEW ===
Brand: {{brand}}
Product: {{productName}}
Target Country: {{targetCountry}}
Campaign Budget: {{budget}}

=== KEYWORDS DATA ===
Total Keywords: {{keywordCount}}
Match Type Distribution: {{matchTypeDistribution}}
Keywords List:
{{keywordsList}}

Negative Keywords: {{negativeKeywords}}

=== LANDING PAGE ===
URL: {{landingPageUrl}}
Page Type: {{pageType}}

=== AD CREATIVES ===
Headlines Count: {{headlineCount}}
Descriptions Count: {{descriptionCount}}
Sample Headlines: {{sampleHeadlines}}
Sample Descriptions: {{sampleDescriptions}}

=== EVALUATION TASK ===

Score this campaign launch readiness across 5 dimensions (total 100 points):

**1. Keyword Quality (30 points)**
- Relevance to product (0-10)
- Match type strategy (0-8)
- Negative keywords coverage (0-7)
- Search intent alignment (0-5)

IMPORTANT RULES:
- Negative keywords MUST be checked
- Missing negative keywords = deduct 5-10 points
- Competition level is reference only, do NOT deduct points

**2. Market Fit (25 points)**
- Target country alignment (0-10)
- Language/localization (0-8)
- Audience targeting potential (0-7)

IMPORTANT RULES:
- Cross-border domains (amazon.ca, amazon.co.uk) are NORMAL
- Do NOT deduct points for cross-border e-commerce URLs

**3. Landing Page Quality (20 points)**
- URL trustworthiness (0-8)
- Expected load speed (0-6)
- Mobile optimization likelihood (0-6)

**4. Budget Reasonability (15 points)**
- CPC alignment with industry (0-6)
- Competition vs budget match (0-5)
- ROI potential (0-4)

**5. Creative Quality (10 points)**
- Headline attractiveness (0-4)
- Description persuasiveness (0-3)
- Uniqueness and differentiation (0-3)

=== OUTPUT FORMAT ===
Return JSON with EXACT field names:
{
  "keywordAnalysis": {
    "score": 25,
    "issues": ["issue1", "issue2"],
    "suggestions": ["suggestion1", "suggestion2"]
  },
  "marketFitAnalysis": {
    "score": 22,
    "issues": [],
    "suggestions": ["suggestion1"]
  },
  "landingPageAnalysis": {
    "score": 18,
    "issues": [],
    "suggestions": []
  },
  "budgetAnalysis": {
    "score": 12,
    "issues": [],
    "suggestions": ["suggestion1"]
  },
  "contentAnalysis": {
    "score": 8,
    "issues": [],
    "suggestions": ["suggestion1"]
  },
  "overallRecommendations": [
    "Top priority action item 1",
    "Top priority action item 2"
  ]
}

CRITICAL: Use EXACT field names above. Do NOT use "dimensions", "keywordQuality", "marketFit", etc.',
  'Chinese',
  1,
  datetime('now'),
  'v3.2: 修复字段名 dimensions.keywordQuality → keywordAnalysis，匹配ScoreAnalysis接口'
);

-- 确保v3.2激活
UPDATE prompt_versions SET is_active = 1 WHERE prompt_id = 'launch_score_evaluation' AND version = 'v3.2';

-- ============================================================
-- 3. Ad Creative Prompt v4.2
-- 问题: 竞争定位维度经常只得1.5/10分，缺少量化价格优势、独特定位声明等
-- ============================================================

-- 禁用旧版本
UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = 'ad_creative_generation' AND version != 'v4.2';

-- 插入新版本 v4.2
INSERT OR IGNORE INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, created_at, change_notes
)
VALUES (
  'ad_creative_generation',
  'v4.2',
  '广告创意生成',
  '广告创意生成v4.2 - 竞争定位增强版',
  '增强竞争定位维度：价格优势量化、独特定位声明、竞品对比暗示、性价比强调',
  'src/lib/ad-creative-generator.ts',
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

🎯 **AI增强数据 (v4.2优化 - 2025-12-10)**:
{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

## 🔥 v4.2 竞争定位增强 (提升Ad Strength评分)

### ⚡ 竞争定位必备元素 (CRITICAL FOR AD STRENGTH)

**1️⃣ 价格优势量化 (Price Advantage - 3分)**
- 必须在至少2条标题或描述中包含具体数字的价格优势
- ✅ 正确格式: "Save €170", "Save $50", "Risparmia 170€", "节省170元"
- ✅ 正确格式: "20% Off", "30% Discount", "Sconto 20%"
- ✅ 正确格式: "From €99", "Starting at $49", "A partire da 99€"
- ❌ 错误格式: "Great Price", "Affordable" (非量化)
- 如果没有促销信息，使用: "Premium Quality", "Direct Price", "Factory Direct"

**2️⃣ 独特定位声明 (Unique Market Position - 3分)**
- 必须在至少1条标题中使用独特性声明词汇
- ✅ 英语: "The Only", "First", "#1", "Exclusive", "Original"
- ✅ 意大利语: "L''unica", "Il primo", "N°1", "Esclusivo", "Originale"
- ✅ 西班牙语: "El único", "El primero", "N°1", "Exclusivo", "Original"
- ✅ 德语: "Der einzige", "Der erste", "Nr.1", "Exklusiv", "Original"
- ✅ 法语: "Le seul", "Le premier", "N°1", "Exclusif", "Original"
- 示例: "The Only {{brand}} with...", "L''unica soluzione per..."

**3️⃣ 竞品对比暗示 (Competitive Comparison - 2分)**
- 必须在至少1条描述中暗示竞争优势（不直接提及竞品名称）
- ✅ 英语: "Replace", "Switch to", "Upgrade from", "Better than ever"
- ✅ 意大利语: "Sostituisci", "Passa a", "Aggiorna da", "Meglio di sempre"
- ✅ 西班牙语: "Reemplaza", "Cambia a", "Actualiza desde", "Mejor que nunca"
- ✅ 德语: "Ersetzen", "Wechseln zu", "Upgrade von", "Besser als je zuvor"
- ✅ 法语: "Remplacer", "Passer à", "Mettre à niveau", "Mieux que jamais"
- 示例: "Replace your old...", "Sostituisci il tuo vecchio..."

**4️⃣ 性价比强调 (Value Emphasis - 2分)**
- 必须在至少1条标题或描述中强调性价比
- ✅ 英语: "Best Value", "Worth Every Penny", "Unbeatable Value"
- ✅ 意大利语: "Miglior Rapporto Qualità-Prezzo", "Vale ogni centesimo"
- ✅ 西班牙语: "Mejor Valor", "Vale cada centavo", "Valor inigualable"
- ✅ 德语: "Bestes Preis-Leistungs-Verhältnis", "Jeden Cent wert"
- ✅ 法语: "Meilleur Rapport Qualité-Prix", "Vaut chaque centime"
- 示例: "Best Value in {{category}}", "Miglior Rapporto Qualità-Prezzo"

### 竞争定位检查清单 (MANDATORY)
在生成创意前，确保包含:
- [ ] 至少2处价格优势量化（数字+货币符号）
- [ ] 至少1处独特定位声明（The Only, L''unica, #1等）
- [ ] 至少1处竞品对比暗示（Replace, Switch, Upgrade等）
- [ ] 至少1处性价比强调（Best Value, Rapporto Qualità-Prezzo等）

## 🔥 v4.1 深度数据增强 (保留)

### 店铺深度数据（当有STORE HOT FEATURES/USER VOICES/TRUST BADGES时）
- **热销商品特性**: 从店铺热销商品详情页聚合的产品特性，代表该品牌最受欢迎的功能点
- **用户真实反馈**: 热销商品的用户评论聚合，反映真实用户关注点
- **信任徽章**: 热销商品获得的Amazon认证（Best Seller、Amazon''s Choice等）
- **类目关键词**: 店铺主营类目，用于长尾关键词拓展

**使用指导**:
1. 标题优先使用热销商品特性（STORE HOT FEATURES）中的卖点
2. 描述融入用户真实反馈（STORE USER VOICES）的表达方式
3. 强调信任徽章（STORE TRUST BADGES）建立可信度
4. 关键词包含类目词（STORE CATEGORIES）的变体

### 竞品差异化数据（当有COMPETITOR FEATURES时）
- **竞品特性列表**: 主要竞品的产品特性，用于找出差异化角度
- **差异化策略**: 避免使用与竞品相同的表达，突出我们独特的优势

**使用指导**:
1. 关键词避免与竞品特性完全重叠，寻找差异化词汇
2. 标题突出"我们有而竞品没有"的功能
3. 描述强调竞争优势而非通用功能

### 用户语言模式（当有USER LANGUAGE PATTERNS时）
- **自然表达**: 从用户评论中提取的常用表达方式
- **使用场景**: 用于生成更自然、更有亲和力的广告文案

**使用指导**:
1. 标题可以使用用户常用的形容词组合（如"easy to use", "really quiet"）
2. 描述模仿用户的表达风格，而非营销语言
3. 关键词包含用户实际搜索的词汇形式

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If this exceeds 30 characters, use "{KeyWord:{{brand}}}" without "Official"
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format. All other 14 headlines MUST NOT contain {KeyWord:...} or any DKI syntax.

**🎯 DIVERSITY REQUIREMENT (CRITICAL)**:
- Maximum 20% text similarity between ANY two headlines
- Each headline must have a UNIQUE angle, focus, or emotional trigger
- NO headline should repeat more than 2 words from another headline
- Each headline should use DIFFERENT primary keywords or features
- Vary sentence structure: statements, questions, commands, exclamations
- Use DIFFERENT emotional triggers: trust, urgency, value, curiosity, exclusivity, social proof

**🔥 v4.2 标题角度增强** (必须覆盖以下至少5种):
- **用户证言型**: 使用USER LANGUAGE PATTERNS中的自然表达
- **数据证明型**: 使用评分、评论数、销量排名等具体数字
- **特性聚焦型**: 使用STORE HOT FEATURES中的核心卖点
- **差异优势型**: 强调UNIQUE ADVANTAGES中的竞争优势
- **信任背书型**: 使用STORE TRUST BADGES中的认证标识
- **🆕 价格优势型**: 包含具体数字的价格优势（Save €X, X% Off）
- **🆕 独特定位型**: 使用独特性声明（The Only, #1, L''unica）
- **🆕 性价比型**: 强调性价比（Best Value, Rapporto Qualità-Prezzo）

Remaining 14 headlines - Types (must cover all 5):
{{headline_brand_guidance}}
{{headline_feature_guidance}}
{{headline_promo_guidance}}
{{headline_cta_guidance}}
{{headline_urgency_guidance}}

Length distribution: 5 short(10-20), 5 medium(20-25), 5 long(25-30)
Quality: 8+ with keywords, 5+ with numbers, 3+ with urgency, <20% text similarity between ANY two headlines

### DESCRIPTIONS (4 required, ≤90 chars each)
**UNIQUENESS REQUIREMENT**: Each description MUST be DISTINCT in focus and wording
**🎯 DIVERSITY REQUIREMENT (CRITICAL)**:
- Maximum 20% text similarity between ANY two descriptions
- Each description must have a COMPLETELY DIFFERENT focus and angle
- NO description should repeat more than 2 words from another description
- Use DIFFERENT emotional triggers and value propositions
- Vary the structure: benefit-focused, action-focused, feature-focused, proof-focused

{{description_1_guidance}}
{{description_2_guidance}}
{{description_3_guidance}}
{{description_4_guidance}}

**🔥 v4.2 描述角度增强**:
- ✓ Description 1: VALUE - 使用STORE HOT FEATURES的核心卖点 + 🆕价格优势量化
- ✓ Description 2: ACTION - 结合促销信息的行动号召 + 🆕竞品对比暗示
- ✓ Description 3: PROOF - 使用TOP REVIEWS/SOCIAL PROOF的真实数据 + 🆕独特定位声明
- ✓ Description 4: VOICE - 模仿USER LANGUAGE PATTERNS的自然表达 + 🆕性价比强调

**CRITICAL DIVERSITY CHECKLIST**:
- ✓ Each uses DIFFERENT keywords and phrases
- ✓ Each has a DIFFERENT emotional trigger
- ✓ Maximum 20% similarity between any two descriptions
**LEVERAGE DATA**: {{review_data_summary}}
{{competitive_guidance_section}}

### KEYWORDS (20-30 required)
**🎯 关键词生成策略（v4.2增强 - 确保多样性和搜索量）**:
**⚠️ 强制约束：所有关键词必须使用目标语言 {{target_language}}，不能使用英文！**

**第一优先级 - 品牌短尾词 (必须生成8-10个)**:
- 格式: [品牌名] + [产品核心词]（2-3个单词）
- ✅ 必须包含的品牌短尾词（基于 {{brand}}）:
  - "{{brand}} {{category}}"（品牌+品类）
  - "{{brand}} official"（品牌+官方）
  - "{{brand}} store"（品牌+商店）
  - "{{brand}} [型号/系列]"（如有型号信息）
  - "{{brand}} buy"（品牌+购买）
  - "{{brand}} price"（品牌+价格）
  - "{{brand}} review"（品牌+评测）
  - "{{brand}} [主要特性]"（品牌+特性）

**第二优先级 - 产品核心词 (必须生成6-8个)**:
- 格式: [产品功能] + [类别]（2-3个单词）

**第三优先级 - 购买意图词 (必须生成3-5个)**:
- 格式: [购买动词] + [品牌/产品]

**第四优先级 - 长尾精准词 (必须生成3-7个)**:
- 格式: [具体场景] + [产品]（3-5个单词）

**🔥 v4.1新增 - 第五优先级 - 用户搜索词 (2-4个)**:
- 来源: USER LANGUAGE PATTERNS 和 POSITIVE KEYWORDS
- 格式: 用户在评论中高频提及的产品表达
- 示例: "easy to use [product]", "quiet [product]", "best [product] for pets"

**🔥 v4.1新增 - 第六优先级 - 类目长尾词 (2-4个，店铺场景)**:
- 来源: STORE CATEGORIES
- 格式: [类目名] + [品牌/产品特性]
- 示例: "home appliances {{brand}}", "[category] with [feature]"

**🔴 强制语言要求**:
- 关键词必须使用目标语言 {{target_language}}
- 如果目标语言是意大利语，所有关键词必须是意大利语
- 如果目标语言是西班牙语，所有关键词必须是西班牙语
- 不能混合使用英文和目标语言
- 不能使用英文关键词
{{exclude_keywords_section}}

### CALLOUTS (4-6, ≤25 chars)
{{callout_guidance}}
**🔥 v4.2增强**:
- 优先使用STORE TRUST BADGES和SOCIAL PROOF数据
- 🆕 必须包含至少1个竞争定位callout（如"Best Value", "#1 Choice", "Save €X"）

### SITELINKS (6): text≤25, desc≤35, url="/" (auto-replaced)
- **REQUIREMENT**: Each sitelink must have a UNIQUE, compelling description
- Focus on different product features, benefits, or use cases
- Avoid repeating similar phrases across sitelinks

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CAPS abuse
**❌ Prohibited Symbols (Google Ads Policy)**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
  * Use text alternatives instead: "stars" or "star rating" instead of ★
  * Use "Rated 4.8 stars" NOT "4.8★"
**❌ Excessive Punctuation**: "!!!", "???", "...", repeated exclamation marks

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency|user_voice|data_proof|trust|price_advantage|unique_position|value_emphasis", "length":N, "keywords":[], "hasNumber":bool, "hasUrgency":bool, "competitiveElement":"price|unique|compare|value|none"}...],
  "descriptions": [{"text":"...", "type":"value|cta|proof|voice", "length":N, "hasCTA":bool, "keywords":[], "competitiveElement":"price|unique|compare|value|none"}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "theme": "...",
  "quality_metrics": {"headline_diversity_score":N, "keyword_relevance_score":N, "data_utilization_score":N, "competitive_positioning_score":N, "estimated_ad_strength":"EXCELLENT"}
}',
  'Chinese',
  1,
  datetime('now'),
  'v4.2: 增强竞争定位维度 - 价格优势量化、独特定位声明、竞品对比暗示、性价比强调'
);

-- 确保v4.2激活
UPDATE prompt_versions SET is_active = 1 WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.2';
