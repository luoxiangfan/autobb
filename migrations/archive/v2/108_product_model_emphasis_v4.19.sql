-- =====================================================
-- Migration: 108_product_model_emphasis_v4.19
-- Description: 产品型号强化 v4.19 - 提升产品型号在创意中的出现率
-- Date: 2025-12-25
-- Database: SQLite
-- =====================================================

-- SQLite版本说明：
-- 1. 使用 CASE WHEN EXISTS 替代 DO $$ 块
-- 2. 使用 datetime('now') 替代 NOW()
-- 3. 使用 || 进行字符串拼接

-- 步骤1：检查v4.19是否已存在，如果存在则激活
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation'
  AND version != 'v4.19'
  AND EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.19'
  );

UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation'
  AND version = 'v4.19'
  AND EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.19'
  );

-- 步骤2：如果v4.19不存在，则创建
INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  created_by, is_active, change_notes, created_at
)
SELECT
  'ad_creative_generation',
  'v4.19',
  '广告创意生成',
  '广告创意生成v4.19 - 产品型号强化版',
  '在v4.18单品聚焦基础上，强化产品型号识别度',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  '
{{language_instruction}}

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
- ✅ **🆕 v4.19: 至少80% (12/15)标题必须包含完整产品型号**
  * 如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），则12个标题必须包含该型号
  * 示例：RingConn Gen 2 → 12个标题必须包含"Gen 2"
  * 示例：Eufy Argus 3 Pro → 12个标题必须包含"3 Pro"或"Argus 3 Pro"
- ❌ **禁止**提到其他品类名称
- ❌ **禁止**使用过于通用的品牌描述

**正确示例**（RingConn Gen 2 Smart Ring）：
```
✅ "RingConn Gen 2 - 12 Days Battery" (包含Gen 2)
✅ "Gen 2 Smart Ring - No Subscription" (包含Gen 2)
✅ "Sleep Apnoe Monitor - Gen 2" (包含Gen 2)
✅ "RingConn Gen 2 Health Tracker" (包含Gen 2)
```

**错误示例**：
```
❌ "Smart Ring Health Tracking" (缺少Gen 2型号)
❌ "RingConn Health Monitor" (缺少Gen 2型号)
❌ "Your Health Tracker" (太通用，缺少产品型号)
```

**🎯 型号识别度检查**：
- 生成15个标题后，统计包含产品型号的数量
- 如果少于12个，重新生成直到满足要求

---

#### 规则2: Descriptions聚焦

**要求**：
- ✅ **必须**描述单品的具体功能/特性/优势
- ✅ **🆕 v4.19: 建议至少2个描述包含产品型号**
- ✅ 可以使用产品应用场景（如"保护你的家庭"）
- ❌ **禁止**提到"browse our collection"（暗示多商品）
- ❌ **禁止**提到"explore our lineup"（暗示产品系列）
- ❌ **禁止**提到其他品类名称

**正确示例**（RingConn Gen 2）：
```
✅ "RingConn Gen 2 with AI sleep apnoe monitoring. No subscription. Order now!"
✅ "The Gen 2 smart ring tracks stress, HRV & SpO2. 12-day battery life."
✅ "Accurate health data with RingConn. Compatible with iOS & Android."
```

---

#### 规则3: Sitelinks聚焦

**要求**：
- ✅ **必须**每个Sitelink都与单品相关
- ✅ **🆕 v4.19: 建议至少2个Sitelink的text包含产品型号**
  * 示例："Gen 2 Details", "Gen 2 Tech Specs", "Gen 2 vs Gen 1"
- ✅ 可以是：产品详情、技术规格、用户评价、安装指南、保修信息、型号对比（仅对比该品类下的型号）
- ❌ **禁止**指向产品列表页（如"Shop All Cameras"）
- ❌ **禁止**指向其他品类页（如"View Our Doorbells"）
- ❌ **禁止**通用店铺页面（如"Browse Collection"）

**数量要求**：恰好6个Sitelinks

**正确示例**（RingConn Gen 2）：
```json
"sitelinks": [
  {"text": "Gen 2 Details", "url": "/", "description": "Full specs & features"},
  {"text": "Gen 2 Tech Specs", "url": "/", "description": "Battery, sensors, materials"},
  {"text": "Customer Reviews", "url": "/", "description": "4.8★ from 5K+ users"},
  {"text": "Size Guide", "url": "/", "description": "Find your perfect fit"},
  {"text": "Gen 2 vs Gen 1", "url": "/", "description": "New AI features & 2x battery"},
  {"text": "No Subscription", "url": "/", "description": "Lifetime free app access"}
]
```

**🆕 v4.19 产品对比建议**：
- 如果产品有前代版本（如Gen 1 vs Gen 2），建议添加1个对比Sitelink
- 对比内容应突出新版本的升级点

---

#### 规则4: Callouts聚焦

**要求**：
- ✅ **必须**突出单品的独特卖点/功能/优势
- ✅ 可以是：技术规格、功能特性、性能指标、保障信息
- ❌ **禁止**通用品牌卖点（如"Wide Product Range"）
- ❌ **禁止**暗示多商品（如"Full Product Line"）

**正确示例**（RingConn Gen 2）：
```
✅ "AI Sleep Apnoe Monitor"
✅ "12-Day Battery Life"
✅ "No Monthly Subscription"
✅ "Stress & HRV Tracking"
✅ "Waterproof IP68"
✅ "Compatible iOS & Android"
```

---

#### 规则5: 关键词嵌入验证

**要求**：
- ✅ 从 {{ai_keywords_section}} 选择关键词嵌入
- ✅ 选中的关键词必须与单品相关
- ❌ 如果关键词提到其他品类，**跳过该词**

---

### ❗强制检查清单

生成内容前，确认以下所有项：

- [ ] 至少12/15标题包含完整产品型号（如"Gen 2"）
- [ ] 至少2/4描述包含产品型号
- [ ] 至少2/6 Sitelinks的text包含产品型号
- [ ] 所有Headlines提到产品名称或主品类
- [ ] 没有任何内容提到其他品类（doorbell, vacuum, lock等）
- [ ] Sitelinks全部指向单品相关页面（无"Shop All", "Browse Collection"）
- [ ] Callouts突出单品卖点（无"Wide Product Range", "Full Line"）
- [ ] 嵌入的关键词都与单品相关（跳过了其他品类词）
- [ ] Descriptions描述单品功能，未提"explore our lineup"

---

### 🔍 自查问题

生成完成后，自问以下问题：

1. **产品型号识别度测试**：标题中产品型号出现率是否≥80%？
   - ✅ ≥12个标题包含型号 → 识别度高
   - ❌ <12个标题包含型号 → 需要重新生成

2. **产品聚焦测试**：删除品牌名后，用户能否识别出这是在推广哪个具体产品？
   - ✅ 能识别 → 聚焦度高
   - ❌ 不能识别 → 需要增加产品细节

3. **品类单一测试**：内容是否只提到一个品类？
   - ✅ 只提智能戒指 → 聚焦度高
   - ❌ 提到戒指+手环 → 违反单品聚焦原则

4. **着陆页一致测试**：用户点击广告后，着陆页是否与广告描述完全一致？
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
6. Return exactly 6 sitelinks
7. **🆕 v4.19: At least 12/15 headlines MUST include the product model (e.g., "Gen 2")**
8. **🆕 v4.19: At least 2/4 descriptions SHOULD include the product model**
9. **🆕 v4.19: At least 2/6 sitelinks text SHOULD include the product model**
10. If you cannot generate valid JSON, return an error message starting with "ERROR:".
11. Ensure ALL creative elements focus on the single product - no multi-product references!
  ',
  'English',
  1,
  1,
  'v4.19 产品型号强化:
1. Headlines: 强制80% (12/15)标题包含完整产品型号
2. Descriptions: 建议至少2个描述包含产品型号
3. Sitelinks: 建议至少2个Sitelink text包含产品型号
4. 新增产品对比建议（如Gen 2 vs Gen 1）
5. 新增型号识别度检查清单
6. 提升产品差异化识别度，避免通用描述',
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_versions
  WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.19'
);

-- 验证
SELECT id, prompt_id, version, is_active, created_at
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY id DESC
LIMIT 3;
