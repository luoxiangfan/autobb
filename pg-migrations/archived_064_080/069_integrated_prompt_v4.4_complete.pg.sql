-- Migration: 069_integrated_prompt_v4.4_complete.pg.sql
-- Description: 数据库字段扩展 + Prompt v4.4完整集成版 (PostgreSQL)
-- Date: 2025-12-10
--
-- 整合内容:
-- 1. 添加scraped_products表的新字段(sales_volume, discount, delivery_info)
-- 2. Prompt v4.3: 销售热度数据增强版
-- 3. Prompt v4.4: 产品特性数据增强版
-- 4. 统一分类名称: "ad_creative" -> "广告创意生成"

-- ============================================================
-- 0. 分类名称统一修复
-- ============================================================

-- 统一所有ad_creative_generation相关的category为"广告创意生成"
UPDATE prompt_versions SET category = '广告创意生成' WHERE prompt_id = 'ad_creative_generation';
UPDATE prompt_versions SET category = '广告创意生成' WHERE prompt_id = 'ad_elements_descriptions';
UPDATE prompt_versions SET category = '广告创意生成' WHERE prompt_id = 'ad_elements_headlines';

-- ============================================================
-- 1. 数据库字段扩展 (069)
-- ============================================================

-- 添加销售热度字段（"1K+ bought in past month"）
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS sales_volume TEXT;

-- 添加折扣百分比字段（"-20%"）
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS discount TEXT;

-- 添加配送信息字段（"Get it by Tuesday, December 16"）
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS delivery_info TEXT;

-- 创建索引以支持基于销售热度的查询
CREATE INDEX IF NOT EXISTS idx_scraped_products_sales_volume
  ON scraped_products(offer_id, sales_volume);

-- ============================================================
-- 2. Prompt版本升级到v4.4 (070 + 071整合)
-- ============================================================

-- 禁用旧版本（v4.2及以下）
UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_creative_generation' AND version != 'v4.4';

-- 插入v4.4版本（PostgreSQL语法）
INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, created_at, change_notes
)
VALUES (
  'ad_creative_generation',
  'v4.4',
  '广告创意生成',
  '广告创意生成v4.4 - 完整增强版',
  '整合v4.3(销售热度)和v4.4(产品特性)的所有优化，提升Ad Strength和转化率',
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

🎯 **AI增强数据 (v4.4完整版 - 2025-12-10)**:
{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

## 🆕 v4.4 产品特性增强 (PRODUCT FEATURES OPTIMIZATION)

### 📦 产品特性数据利用 (CRITICAL FOR RELEVANCE)

**当检测到 "PRODUCT FEATURES" 数据时**:
这是从Amazon产品页面"About this item"直接抓取的真实产品卖点，是最准确的产品描述！

**必须使用的创意策略**:

**1️⃣ 产品特性标题 (Feature Headlines - 高相关性)**
- 从PRODUCT FEATURES中提取核心卖点关键词
- 转化为简洁有力的标题（≤30字符）
- ✅ 示例转化:
  - "5-IN-1 CLEANING POWER" → "5-in-1 Robot Vacuum"
  - "ULTRA-SLIM DESIGN" → "Ultra-Slim Design"
  - "8000Pa Strong Suction" → "8000Pa Suction Power"
  - "Smart App Control" → "Smart App Control"

**2️⃣ 技术规格标题 (SPECS Headlines)**
- 从SPECS数据中提取关键技术参数
- 使用数字增强说服力
- ✅ 示例:
  - "Surface Recommendation: Multi-surface" → "Multi-Surface Cleaning"
  - "Item Weight: 19.8 Pounds" → "Lightweight 19.8 lbs"
  - "Controller Type: Voice Control" → "Voice Controlled"

**3️⃣ 描述中的特性引用 (Description Feature Integration)**
- 在描述中自然融入产品特性
- 确保描述具体且有说服力
- ✅ 示例:
  - "5-in-1 cleaning power with 8000Pa suction. Ultra-slim design fits under furniture."
  - "Smart app control with voice command support. Clean anywhere, anytime."

**4️⃣ 关键词增强 (Keyword Enhancement)**
- 从PRODUCT FEATURES中提取高相关性关键词
- 确保关键词覆盖产品核心功能
- ✅ 从特性中提取的关键词示例:
  - "robot vacuum 5 in 1"
  - "ultra slim robot vacuum"
  - "8000pa suction vacuum"
  - "smart app robot vacuum"

## 🔥 v4.3 销售热度增强 (SALES MOMENTUM OPTIMIZATION)

### 📈 销售热度数据利用 (CRITICAL FOR CONVERSION)

**当检测到 "🔥 SALES MOMENTUM" 数据时**:
这是Amazon直接提供的真实销量数据，是最强的社会证明信号！

**必须使用的创意策略**:

**1️⃣ 热销证明标题 (Social Proof Headlines - 高CTR)**
- 将销量数据转化为信任信号标题
- ✅ "1K+ Sold This Month" (如果数据是 "1K+ bought in past month")
- ✅ "4K+ Happy Customers" (如果数据是 "4K+ bought in past month")
- ✅ "10K+ Units Sold" (如果数据是 "10K+ bought in past month")
- ✅ "Best Seller - 5K+ Sold"
- ✅ 意大利语: "1K+ Venduti", "4K+ Clienti Soddisfatti"
- ✅ 西班牙语: "1K+ Vendidos", "4K+ Clientes Felices"

**2️⃣ 描述中的销量引用 (Description Social Proof)**
- 在至少1条描述中引用销量数据
- ✅ "Join 4,000+ customers who bought this month"
- ✅ "Thousands sold - see why customers love it"
- ✅ "1,000+ buyers can''t be wrong"

**3️⃣ 紧迫感+销量组合 (Urgency + Volume)**
- 结合折扣和销量创造紧迫感
- ✅ "Trending: 1K+ Sold | Save 20%"
- ✅ "Hot Item: Limited Stock"

### 💰 折扣数据利用 (ACTIVE DISCOUNTS)

**当检测到 "💰 ACTIVE DISCOUNTS" 数据时**:

**必须在创意中包含折扣信息**:
- ✅ 直接使用折扣百分比: "-20%", "Save 20%", "20% Off"
- ✅ 结合品牌: "{{brand}} - 20% Off"
- ✅ 创造紧迫感: "Limited Time: 20% Off"

### 🏪 店铺页面特殊策略 (STORE PAGE STRATEGY)

**当检测到多个热销产品数据时**:
- 强调产品多样性: "Full Collection Available"
- 强调品牌实力: "Trusted by 10K+ Customers"
- 使用汇总数据: "Avg 4.5★ | 5,000+ Reviews"

## 🔥 v4.2 竞争定位增强 (保留)

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

**3️⃣ 隐性竞品对比 (Implicit Comparison - 2分)**
- 使用暗示性对比词汇，但不直接提及竞争对手
- ✅ 正确: "Unlike others", "Not like the rest", "A differenza di altri"
- ✅ 正确: "Better performance", "Superior quality", "Qualità superiore"
- ✅ 正确: "More features", "Longer lasting", "Più funzioni"
- ❌ 错误: "Better than [competitor]" (直接提及)

**4️⃣ 性价比强调 (Value for Money - 2分)**
- 强调产品物超所值
- ✅ "Best Value", "Premium at Budget Price", "Il miglior rapporto qualità-prezzo"
- ✅ "More for Less", "Maximum Value", "Massimo valore"
- ✅ "Worth Every Penny", "Investment in Quality", "Vale ogni centesimo"

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

**🆕 v4.4 PRODUCT FEATURES HEADLINES (NEW)**:
- If PRODUCT FEATURES data available, create 3-4 headlines directly from product features
- Extract key selling points and convert to concise headlines
- Examples: "5-in-1 Cleaning Power", "Ultra-Slim Design", "8000Pa Suction"

**🔥 v4.3 SALES MOMENTUM HEADLINES**:
- If SALES MOMENTUM data available, create 2-3 headlines using sales volume
- Examples: "1K+ Sold This Month", "Join 4K+ Buyers", "Best Seller"

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

**🆕 v4.4 PRODUCT FEATURES DESCRIPTIONS (NEW)**:
- At least 1 description MUST incorporate specific product features from PRODUCT FEATURES data
- Use authentic product selling points for higher relevance and quality score
- Example: "5-in-1 cleaning with 8000Pa suction. Ultra-slim fits under furniture."

**🔥 v4.3 SALES MOMENTUM DESCRIPTIONS**:
- If SALES MOMENTUM data available, include in at least 1 description
- Example: "Join 4,000+ customers who bought this month. Shop now!"

{{description_1_guidance}}
{{description_2_guidance}}
{{description_3_guidance}}
{{description_4_guidance}}

**CRITICAL DIVERSITY CHECKLIST**:
- ✓ Description 1 focuses on VALUE (what makes it special)
- ✓ Description 2 focuses on ACTION (what to do now)
- ✓ Description 3 focuses on FEATURES (USE PRODUCT FEATURES HERE)
- ✓ Description 4 focuses on PROOF (social proof + sales momentum)
- ✓ Each uses DIFFERENT keywords and phrases
- ✓ Each has a DIFFERENT emotional trigger
- ✓ Maximum 20% similarity between any two descriptions
**LEVERAGE DATA**: {{review_data_summary}}
{{competitive_guidance_section}}

### KEYWORDS (20-30 required)
**🎯 关键词生成策略（重要！确保高搜索量关键词优先）**:
**⚠️ 强制约束：所有关键词必须使用目标语言 {{target_language}}，不能使用英文！**

**🆕 v4.4 产品特性关键词 (NEW)**:
- 从PRODUCT FEATURES中提取核心功能词作为关键词
- 确保覆盖产品的主要卖点和功能
- 示例: "5 in 1 robot vacuum", "ultra slim vacuum", "8000pa suction"

**第一优先级 - 品牌短尾词 (必须生成8-10个)**:
- 格式: [品牌名] + [产品核心词]（2-3个单词）

**第二优先级 - 产品核心词 (必须生成6-8个)**:
- 格式: [产品功能] + [类别]（2-3个单词）

**第三优先级 - 购买意图词 (必须生成3-5个)**:
- 格式: [购买动词] + [品牌/产品]

**第四优先级 - 长尾精准词 (必须生成3-7个)**:
- 格式: [具体场景] + [产品]（3-5个单词）

{{exclude_keywords_section}}

### CALLOUTS (4-6, ≤25 chars)
{{callout_guidance}}

### SITELINKS (6): text≤25, desc≤35, url="/" (auto-replaced)
- **REQUIREMENT**: Each sitelink must have a UNIQUE, compelling description

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CAPS abuse
**❌ Prohibited Symbols (Google Ads Policy)**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency|social_proof", "length":N, "keywords":[], "hasNumber":bool, "hasUrgency":bool, "usesSalesMomentum":bool, "usesProductFeatures":bool}...],
  "descriptions": [{"text":"...", "type":"value|cta|feature|proof", "length":N, "hasCTA":bool, "keywords":[], "usesSalesMomentum":bool, "usesProductFeatures":bool}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "theme": "...",
  "quality_metrics": {"headline_diversity_score":N, "keyword_relevance_score":N, "sales_momentum_usage":bool, "product_features_usage":bool, "estimated_ad_strength":"EXCELLENT"}
}',
  'Chinese',
  true,
  NOW(),
  'v4.4 完整版更新内容:
1. 【数据库】新增scraped_products字段: sales_volume, discount, delivery_info
2. 【v4.4新增】PRODUCT FEATURES数据利用（来自Amazon "About this item"）
3. 【v4.4新增】产品特性转化为广告标题和描述的完整策略
4. 【v4.4新增】从产品特性中提取高相关性关键词
5. 【v4.3保留】销售热度数据利用(salesVolume): "1K+ bought in past month"等
6. 【v4.3保留】社会证明强化（真实销量数据转化为信任信号）
7. 【v4.3保留】折扣紧迫感优化
8. 【v4.2保留】竞争定位增强功能（价格优势、独特定位、隐性对比、性价比）
9. 【输出增强】headlines/descriptions增加usesSalesMomentum和usesProductFeatures标记
10. 【分类统一】所有ad_creative相关分类统一为"广告创意生成"'
)
ON CONFLICT (prompt_id, version) DO UPDATE SET
  prompt_content = EXCLUDED.prompt_content,
  description = EXCLUDED.description,
  is_active = true,
  change_notes = EXCLUDED.change_notes;

-- 确保v4.4为活跃版本
UPDATE prompt_versions SET is_active = true WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.4';
