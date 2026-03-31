-- =====================================================
-- Migration: 107_single_product_focus_prompt_v4.18
-- Description: 单品聚焦Prompt增强 v4.18 - 强制所有广告创意元素100%聚焦单品商品
-- Date: 2025-12-25
-- Database: SQLite
-- =====================================================

-- ========================================
-- ad_creative_generation: v4.17_p2 → v4.18
-- ========================================

-- 问题背景：
-- 当用户创建单品链接Offer时（如Eufy Argus 3 Pro安防摄像头），期望所有广告元素聚焦该单品。
-- 但当前创意生成可能包含同品牌其他品类的内容（如doorbell、vacuum等）。
--
-- 解决方案：
-- 在Prompt中添加强制单品聚焦规则，要求AI生成的所有元素（Headlines、Descriptions、Sitelinks、Callouts）
-- 必须100%聚焦于单品，排除其他品类。

-- 步骤1：将当前活跃版本（v4.17_p2）设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 幂等性：避免重复执行时 v4.18 已存在导致唯一约束失败
DELETE FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.18';

-- 步骤2：插入新版本 v4.18（包含单品聚焦规则）
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
  'v4.18',
  '广告创意生成',
  '广告创意生成v4.18 - 单品聚焦增强版',
  '广告创意生成v4.18 - 单品聚焦增强版',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

{{keywords_section}}

## 🆕 v4.16 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

{{link_type_instructions}}

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
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale"
- ❌ 错误: "Camera Camera Security" (堆砌)

**规则3: 标题变体**
- 15个标题必须各不相同（避免重复）
- 每组5个标题使用不同的核心卖点和表达方式

## 🔥 v4.11 描述嵌入规则 (MANDATORY)

### ⚠️ 强制要求：5/5 (100%) 描述必须包含关键词

**规则1: 品牌词出现**
- **必须**在至少3个描述中包含品牌词 {{brand}}

**规则2: 行动号召 (Call-to-Action)**
- 每个描述**必须**包含明确的CTA
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours, Explore Collection, Discover More

**规则3: 描述结构**
- 长度：90-150字符
- 必须包含：核心卖点 + 品牌词/关键词 + 明确CTA

## 🔥 v4.15 本地化规则 (CRITICAL)

**🔑 本地化规则**:

**规则1: 货币符号**
- 🇺🇸 US: USD ($)
- 🇬🇧 UK: GBP (£)
- 🇪🇺 EU: EUR (€)

**规则2: 紧急感本地化**
- 🇺🇸/🇬🇧: "Limited Time", "Today Only"
- 🇩🇪: "Nur heute", "Oferta limitada"
- 🇯🇵: "今だけ", "期間限定"

## 🆕 v4.16 店铺链接特殊规则

{{store_creative_instructions}}

## 🔧 v4.17_p2 Sitelinks要求 (2025-12-24)

### ⚠️ 强制要求：生成6个Sitelinks

**规则1: 数量固定**
- 必须生成**恰好6个**Sitelinks（不多不少）
- 每个Sitelink必须有text、url、description三个字段

**规则2: 长度限制**
- text: 最多25个字符
- description: 最多35个字符
- url: 统一使用 "/" (系统会自动替换为真实URL)

**规则3: 多样性要求**
- 6个Sitelinks必须覆盖不同的用户意图
- 避免重复或相似的链接文本
- 建议类型分布：
  * 产品页/分类页 (2个)
  * 促销/优惠页 (1-2个)
  * 关于品牌/服务页 (1个)
  * 保障/退换货页 (1个)

---

## 🎯 v4.18 单品聚焦要求 (CRITICAL - 2025-12-25)

### ⚠️ 强制规则：所有创意元素必须100%聚焦单品

**单品信息**：
- 产品标题：{{product_title}}
- 主品类：{{category}}
- 核心卖点：{{unique_selling_points}}

---

### 📏 聚焦规则详解

#### 规则1: Headlines聚焦

**要求**：
- ✅ **必须**提到具体产品名称或主品类
- ✅ **必须**突出产品型号/规格/独特功能
- ❌ **禁止**提到其他品类名称
- ❌ **禁止**使用过于通用的品牌描述

**正确示例**（Eufy Argus 3 Pro Outdoor Security Camera）：
```
✅ "Eufy Argus 3 Pro - 2K Night Vision"
✅ "Outdoor Security Camera with Solar"
✅ "Wireless 2K Camera - Eufy"
✅ "Eufy Security Camera - AI Detection"
```

**错误示例**：
```
❌ "Eufy Smart Home Solutions" (太通用，未聚焦单品)
❌ "Cameras, Doorbells & More" (提到其他品类)
❌ "Complete Home Security Line" (暗示多产品)
❌ "Explore Eufy''s Full Lineup" (暗示产品系列)
```

---

#### 规则2: Descriptions聚焦

**要求**：
- ✅ **必须**描述单品的具体功能/特性/优势
- ✅ 可以使用产品应用场景（如"保护你的家庭"）
- ❌ **禁止**提到"browse our collection"（暗示多商品）
- ❌ **禁止**提到"explore our lineup"（暗示产品系列）
- ❌ **禁止**提到其他品类名称

**正确示例**：
```
✅ "2K resolution camera with AI person detection. Wireless setup in minutes."
✅ "Solar-powered outdoor camera. No monthly fees. Weatherproof IP67."
✅ "Color night vision security camera. See details even in darkness."
```

**错误示例**：
```
❌ "Browse our full smart home collection" (暗示多商品)
❌ "From doorbells to cameras, we have it all" (提到其他品类)
❌ "Complete security lineup for your home" (暗示多产品)
```

---

#### 规则3: Sitelinks聚焦

**要求**：
- ✅ **必须**每个Sitelink都与单品相关
- ✅ 可以是：产品详情、技术规格、用户评价、安装指南、保修信息、型号对比（仅对比该品类下的型号）
- ❌ **禁止**指向产品列表页（如"Shop All Cameras"）
- ❌ **禁止**指向其他品类页（如"View Our Doorbells"）
- ❌ **禁止**通用店铺页面（如"Browse Collection"）

**数量要求**：恰好6个Sitelinks

**正确示例**（安防摄像头）：
```json
"sitelinks": [
  {"text": "Product Details", "url": "/", "description": "Full specs & features"},
  {"text": "Tech Specs", "url": "/", "description": "Resolution, battery, storage"},
  {"text": "Customer Reviews", "url": "/", "description": "4.8★ from 10K+ reviews"},
  {"text": "Installation Guide", "url": "/", "description": "Easy setup in 10 minutes"},
  {"text": "Warranty Info", "url": "/", "description": "2-year warranty included"},
  {"text": "Compare Models", "url": "/", "description": "Argus 2 vs Argus 3 Pro"}
]
```

**错误示例**：
```json
❌ {"text": "Shop All Cameras", "description": "..."} (暗示多商品)
❌ {"text": "View Our Doorbells", "description": "..."} (其他品类)
❌ {"text": "Browse Collection", "description": "..."} (通用店铺)
❌ {"text": "Smart Home Deals", "description": "..."} (多品类)
```

---

#### 规则4: Callouts聚焦

**要求**：
- ✅ **必须**突出单品的独特卖点/功能/优势
- ✅ 可以是：技术规格、功能特性、性能指标、保障信息
- ❌ **禁止**通用品牌卖点（如"Wide Product Range"）
- ❌ **禁止**暗示多商品（如"Full Product Line"）

**正确示例**（安防摄像头）：
```
✅ "2K Resolution"
✅ "Solar Powered"
✅ "AI Person Detection"
✅ "No Monthly Fees"
✅ "Weatherproof IP67"
✅ "Color Night Vision"
```

**错误示例**：
```
❌ "Wide Product Range" (暗示多商品)
❌ "Full Smart Home Line" (多品类)
❌ "Cameras & Doorbells" (其他品类)
```

---

#### 规则5: 关键词嵌入验证

**要求**：
- ✅ 从 {{ai_keywords_section}} 选择关键词嵌入
- ✅ 选中的关键词必须与单品相关
- ❌ 如果关键词提到其他品类，**跳过该词**

**检查逻辑**：
```
在嵌入关键词前，先检查关键词是否包含其他品类词：
- 如果包含 "doorbell", "vacuum", "lock", "bulb" 等非主品类词 → 跳过
- 如果包含主品类词 "camera", "security" → 可以嵌入
```

---

### ❗强制检查清单

生成内容前，确认以下所有项：

- [ ] 所有Headlines提到产品名称或主品类
- [ ] 没有任何内容提到其他品类（doorbell, vacuum, lock等）
- [ ] Sitelinks全部指向单品相关页面（无"Shop All", "Browse Collection"）
- [ ] Callouts突出单品卖点（无"Wide Product Range", "Full Line"）
- [ ] 嵌入的关键词都与单品相关（跳过了其他品类词）
- [ ] Descriptions描述单品功能，未提"explore our lineup"

---

### 🔍 自查问题

生成完成后，自问以下问题：

1. **产品聚焦测试**：删除品牌名后，用户能否识别出这是在推广哪个具体产品？
   - ✅ 能识别 → 聚焦度高
   - ❌ 不能识别 → 需要增加产品细节

2. **品类单一测试**：内容是否只提到一个品类？
   - ✅ 只提摄像头 → 聚焦度高
   - ❌ 提到摄像头+门铃 → 违反单品聚焦原则

3. **着陆页一致测试**：用户点击广告后，着陆页是否与广告描述完全一致？
   - ✅ 着陆页是单品页面 → 一致性高
   - ❌ 着陆页是产品列表或店铺 → 不一致

---

## 📋 OUTPUT (JSON only, no markdown):

{
  "headlines": [
    {"text": "...", "type": "brand|feature|promo|cta|urgency|social_proof|question|emotional", "length": N}
  ],
  "descriptions": [
    {"text": "...", "type": "feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length": N}
  ],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

**CRITICAL REQUIREMENTS**:
1. You MUST return ONLY valid JSON - no markdown formatting, no explanations, no German/other language text
2. All headlines and descriptions must be in the target language ({{target_language}})
3. All headlines must be ≤30 characters
4. All descriptions must be ≤90 characters
5. Return exactly 15 headlines and 4-5 descriptions
6. Return exactly 6 sitelinks (CRITICAL - 从之前的隐式改为明确要求)
7. If you cannot generate valid JSON, return an error message starting with "ERROR:".
8. **IMPORTANT**: Ensure ALL creative elements focus on the single product - no multi-product references!
',
  'English',
  1,  -- is_active = 1 (立即激活)
  'v4.18 单品聚焦增强:
1. 新增"🎯 v4.18 单品聚焦要求"章节（强制规则）
2. 详细规则1-5：Headlines/Descriptions/Sitelinks/Callouts/关键词嵌入
3. 强制检查清单（6项）
4. 自查问题（3个测试）
5. 确保所有创意元素100%聚焦单品商品
6. 代码层面：每个产品桶(A/B/C/D/S)添加单品聚焦约束
   - 桶A: 必须提到具体产品名称/型号
   - 桶B: 围绕单一产品描述购买优势
   - 桶C: 聚焦单品功能细节
   - 桶D: 单一产品的专属促销
   - 桶S: 综合创意添加Single Product Focus约束'
);

-- ========================================
-- keyword_intent_clustering: 激活 v4.18
-- ========================================

-- v4.18 已存在于数据库（ID: 172），只需激活
-- 更新内容：增强店铺链接分桶精准度

-- 步骤1：将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'keyword_intent_clustering' AND is_active = 1;

-- 步骤2：激活v4.18
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'keyword_intent_clustering' AND version = 'v4.18';

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY id DESC
LIMIT 3;

SELECT id, prompt_id, version, is_active
FROM prompt_versions
WHERE prompt_id = 'keyword_intent_clustering' AND version = 'v4.18';

-- ✅ Migration complete!
-- 1. ad_creative_generation v4.18 已激活 - 包含单品聚焦规则
-- 2. keyword_intent_clustering v4.18 已激活 - 增强店铺链接分桶精准度
-- 两个Prompt现在都已就绪，系统将使用最新的优化版本生成广告创意
