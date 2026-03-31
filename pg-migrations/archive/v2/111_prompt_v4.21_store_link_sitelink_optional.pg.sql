-- =====================================================
-- Migration: 111_prompt_v4.21_store_link_sitelink_optional
-- Description: v4.21 - 店铺链接Sitelink型号可选版，修复前后冲突
-- Date: 2025-12-26
-- Database: PostgreSQL
-- =====================================================

-- ========================================
-- ad_creative_generation: v4.20 → v4.21
-- ========================================

-- 修复内容：
-- 1. 明确Sitelinks强制6个（单品+店铺链接通用规则）
-- 2. 单品链接：Sitelink包含型号（强制要求2个）
-- 3. 店铺链接：Sitelink可包含型号（可选，非强制）
-- 4. 修复v4.20中"店铺聚焦一致性"与"包含单品型号"的冲突

-- 使用DO $$ 块确保幂等性
DO $$
DECLARE
  v4_exists boolean;
  v4_21_exists boolean;
BEGIN
  -- 检查v4.21是否已存在
  SELECT INTO v4_21_exists
    EXISTS (
      SELECT 1 FROM prompt_versions
      WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.21'
    );

  -- 如果v4.21已存在，直接激活并退出
  IF v4_21_exists THEN
    -- 停用其他版本
    UPDATE prompt_versions
    SET is_active = false
    WHERE prompt_id = 'ad_creative_generation' AND version != 'v4.21';

    -- 激活v4.21
    UPDATE prompt_versions
    SET is_active = true
    WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.21';

    RAISE NOTICE 'ad_creative_generation v4.21 already exists, activated it';
    RETURN;
  END IF;

  -- 检查v4.20是否存在
  SELECT INTO v4_exists
    EXISTS (
      SELECT 1 FROM prompt_versions
      WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.20'
    );

  -- 停用v4.20（如果存在）
  IF v4_exists THEN
    UPDATE prompt_versions
    SET is_active = false
    WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.20';

    RAISE NOTICE 'ad_creative_generation v4.20 deactivated';
  END IF;

  -- 插入v4.21
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
    change_notes,
    created_at
  ) VALUES (
    'ad_creative_generation',
    'v4.21',
    '广告创意生成',
    '广告创意生成v4.21 - 店铺链接Sitelink型号可选版',
    '修复v4.20前后冲突：
1. 明确Sitelinks强制6个（单品+店铺通用）
2. 单品链接：Sitelink包含型号（强制2个）
3. 店铺链接：Sitelink可含型号（可选）
4. 修复店铺聚焦与单品型号的冲突规则',
    'database',
    'loadPrompt',
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

## 🔧 v4.21 Sitelinks要求 (2025-12-26)

### ⚠️ 强制要求：生成6个Sitelinks（单品+店铺链接通用规则）

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

---

## 🎯 v4.21 单品聚焦要求 (CRITICAL - 2025-12-25)

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
- ✅ **🆕 v4.21: 至少80% (12/15)标题必须包含完整产品型号**
  * 如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），则12个标题必须包含该型号
- ❌ **禁止**提到其他品类名称
- ❌ **禁止**使用过于通用的品牌描述

**🎯 型号识别度检查**：
- 生成15个标题后，统计包含产品型号的数量
- 如果少于12个，重新生成直到满足要求

---

#### 规则2: Descriptions聚焦

**要求**：
- ✅ **必须**描述单品的具体功能/特性/优势
- ✅ **🆕 v4.21: 建议至少2个描述包含产品型号**
- ✅ 可以使用产品应用场景
- ❌ **禁止**提到"browse our collection"（暗示多商品）
- ❌ **禁止**提到其他品类名称

---

#### 规则3: Sitelinks聚焦（单品链接）

**要求**：
- ✅ **必须**每个Sitelink都与单品相关
- ✅ **🆕 v4.21: 强制至少2个Sitelink的text包含产品型号**
  * 示例："Gen 2 Details", "Gen 2 Tech Specs", "Gen 2 vs Gen 1"
- ✅ 可以是：产品详情、技术规格、用户评价、安装指南、保修信息、型号对比
- ❌ **禁止**指向产品列表页（如"Shop All Cameras"）
- ❌ **禁止**指向其他品类页

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

---

#### 规则4: Callouts聚焦

**要求**：
- ✅ **必须**突出单品的独特卖点/功能/优势
- ✅ 可以是：技术规格、功能特性、性能指标、保障信息
- ❌ **禁止**通用品牌卖点（如"Wide Product Range"）

---

#### 规则5: 关键词嵌入验证

**要求**：
- ✅ 从 {{ai_keywords_section}} 选择关键词嵌入
- ✅ 选中的关键词必须与单品相关
- ❌ 如果关键词提到其他品类，**跳过该词**

---

### ❗强制检查清单（单品链接）

生成内容前，确认以下所有项：

- [ ] 至少12/15标题包含完整产品型号（如"Gen 2"）- **强制**
- [ ] 至少2/4描述包含产品型号 - 建议
- [ ] 至少2/6 Sitelinks的text包含产品型号 - **强制**
- [ ] 所有Headlines提到产品名称或主品类
- [ ] 没有任何内容提到其他品类（doorbell, vacuum, lock等）
- [ ] Sitelinks全部指向单品相关页面（无"Shop All", "Browse Collection"）
- [ ] Callouts突出单品卖点（无"Wide Product Range", "Full Line"）

---

### 🔍 自查问题

1. **产品型号识别度测试**：标题中产品型号出现率是否≥80%？
2. **产品聚焦测试**：删除品牌名后，用户能否识别出这是在推广哪个具体产品？
3. **品类单一测试**：内容是否只提到一个品类？
4. **着陆页一致测试**：用户点击广告后，着陆页是否与广告描述完全一致？

---

## 🆕 v4.21 店铺链接Sitelinks规则（与单品链接区别）

### 📋 店铺链接 vs 单品链接 Sitelinks规则对比

| 规则 | 单品链接 | 店铺链接 |
|------|---------|---------|
| Sitelinks数量 | 6个（强制） | 6个（强制） |
| Sitelinks包含型号 | **强制**至少2个 | **可选**（可提增强相关性） |
| Sitelinks聚焦目标 | 单品详情/规格 | 店铺分类/热销/保障 |
| 示例 | "Gen 2 Details" | "Shop All Cameras" |

### 🎯 店铺链接 Sitelinks要求

**规则1: 数量固定**
- 必须生成**恰好6个**Sitelinks

**规则2: 店铺链接可选包含型号**
- ✅ **可以**在Sitelink中包含产品型号以增强相关性（示例："Qrevo S8 Details"）
- ✅ **可以**使用店铺通用链接（示例："Shop All {{brand}}", "New Arrivals"）
- ✅ **可以**使用分类页链接（示例："Sroboter", "Staubsauger"）
- ✅ **可以**使用保障/服务链接（示例："Warranty", "Support"）

**规则3: 店铺链接Sitelinks示例**
```json
"sitelinks": [
  {"text": "Shop All {{brand}}", "url": "/", "description": "Explore our full collection"},
  {"text": "New Arrivals", "url": "/", "description": "Latest products added"},
  {"text": "Qrevo S8 Details", "url": "/", "description": "Featured product specs"},
  {"text": "Customer Reviews", "url": "/", "description": "4.8★ from 10K+ users"},
  {"text": "Warranty Info", "url": "/", "description": "2-year warranty included"},
  {"text": "Support", "url": "/", "description": "24/7 customer service"}
]
```

**🆕 v4.21 店铺链接特别说明**：
- 店铺链接目标是驱动用户进店探索
- **允许**使用"Shop All"类通用链接（单品链接禁止）
- **可选**包含单品型号增强相关性（不强求）
- **必须**与店铺整体主题相关

---

### 🔍 店铺链接差异化验证检查

**生成完成后，检查以下问题**：

1. **桶角度一致性**：
   - 桶A的标题是否70%+与官方/授权/正品相关？
   - 桶B的标题是否50%+与场景/解决方案相关？
   - 桶C的标题是否50%+与热销/推荐相关？
   - 桶D的标题是否50%+与信任/保障相关？

2. **跨桶差异性**：
   - 5个店铺创意之间是否有明显的主题角度差异？

3. **店铺聚焦一致性**：
   - 所有创意是否都聚焦整个店铺？
   - ✅ 店铺链接**允许**使用"Shop All"类链接
   - ✅ 店铺链接**可以**包含单品型号增强相关性（可选）
   - ❌ 如果需要严格单品聚焦，请使用**单品链接**而非店铺链接

---

## 🆕 v4.21 单品链接桶类型差异化角度规则 (CRITICAL - 2025-12-26)

### ⚠️ 强制规则：5个差异化创意必须各自专注不同的表达角度

**单品聚焦** + **角度差异化** = 高效A/B测试

**当前桶信息**：
- 桶类型：{{bucket_type}}
- 桶主题：{{bucket_intent}}

---

### 📊 单品链接各桶类型的差异化角度定义

| 桶 | 英文主题 | 中文主题 | 核心策略 |
|---|---------|---------|---------|
| A | Brand-Oriented | 品牌导向 | 强调品牌信誉、官方渠道 |
| B | Scenario-Oriented | 场景导向 | 强调使用场景、问题解决 |
| C | Feature-Oriented | 功能导向 | 强调技术参数、核心卖点 |
| D | High-Intent | 高购买意图 | 强调促销、紧迫感 |
| S | Synthetic | 综合推广 | 整合所有角度 |

---

### 🎯 桶A - 品牌导向策略

**标题分布（15个）**：
- 品牌相关：3个
- 产品信息：6个（必须包含完整型号）
- 促销信息：3个
- 使用场景：3个

---

### 🎯 桶B - 场景导向策略

**标题分布（15个）**：
- 使用场景：6个
- 产品信息：4个（必须包含完整型号）
- 品牌信息：2个
- 促销信息：3个

---

### 🎯 桶C - 功能导向策略

**标题分布（15个）**：
- 核心功能：6个
- 产品信息：4个（必须包含完整型号）
- 品牌信息：2个
- 使用场景：3个

---

### 🎯 桶D - 高购买意图策略

**标题分布（15个）**：
- 促销信息：5个
- 产品信息：5个（必须包含完整型号）
- 品牌信息：2个
- 使用场景：3个

---

### 🎯 桶S - 综合推广策略

**标题分布（15个）**：
- 平均分布：各类型约3个

---

## 🆕 v4.21 店铺链接桶类型差异化角度规则 (CRITICAL - 2025-12-26)

### ⚠️ 强制规则：店铺链接的5个差异化创意必须各自专注不同的表达角度

**店铺目标**：驱动用户进店探索，扩大品牌认知

---

### 📊 店铺链接各桶类型的差异化角度定义

| 桶 | 英文主题 | 中文主题 | 核心策略 |
|---|---------|---------|---------|
| A | Brand-Trust | 品牌信任导向 | 官方授权、品牌保障 |
| B | Scene-Solution | 场景解决导向 | 展示产品如何解决用户问题 |
| C | Collection-Highlight | 精选推荐导向 | 店铺热销和推荐产品 |
| D | Trust-Signals | 信任信号导向 | 评价、售后、保障 |
| S | Store-Overview | 店铺全景导向 | 全面展示店铺 |

---

### 🎯 桶A - 品牌信任导向策略

**标题分布（15个）**：
- 品牌相关：8个（官方、授权、正品）
- 场景信息：1个
- 品类信息：1个

---

### 🎯 桶B - 场景解决导向策略

**标题分布（15个）**：
- 品牌信息：2个
- 场景信息：6个
- 品类信息：2个

---

### 🎯 桶C - 精选推荐导向策略

**标题分布（15个）**：
- 品牌信息：4个
- 品类信息：3个
- 信任信号：2个
- 场景信息：1个

---

### 🎯 桶D - 信任信号导向策略

**标题分布（15个）**：
- 品牌信息：3个
- 信任信号：4个（评价、保障、售后）
- 场景信息：2个
- 品类信息：1个

---

### 🎯 桶S - 店铺全景导向策略

**标题分布（15个）**：
- 品牌信息：5个
- 场景信息：3个
- 品类信息：2个

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
6. Return exactly 6 sitelinks (CRITICAL - 强制要求)
7. **🆕 v4.21: 单品链接 - 至少12/15标题必须包含产品型号（强制）**
8. **🆕 v4.21: 单品链接 - 至少2/6 Sitelinks必须包含产品型号（强制）**
9. **🆕 v4.21: 店铺链接 - Sitelinks可包含产品型号（可选，非强制）**
10. **🆕 v4.21: 店铺链接允许使用"Shop All"类通用链接（单品链接禁止）**
11. **🆕 v4.21: 所有创意必须遵循{{bucket_type}}桶策略**
12. **🆕 v4.21: 5个差异化创意必须有明显角度差异**
13. If you cannot generate valid JSON, return an error message starting with "ERROR:".
14. Ensure ALL creative elements focus on the correct target (single product OR entire store) - no mixed references!
',
    'zh-CN',
    1,
    true,
    'v4.21 修复冲突:
1. 明确Sitelinks强制6个（单品+店铺通用）
2. 单品链接：Sitelink包含型号（强制2个）
3. 店铺链接：Sitelink可含型号（可选）
4. 店铺链接允许使用"Shop All"类通用链接
5. 修复v4.20店铺聚焦与单品型号的冲突规则',
    NOW()
  );

  RAISE NOTICE 'ad_creative_generation v4.21 created and activated';
END $$;

-- 验证
SELECT id, prompt_id, version, is_active, created_at
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY id DESC
LIMIT 5;

-- ✅ Migration complete!
-- ad_creative_generation v4.21 已激活
-- 主要修复：
-- 1. 明确Sitelinks强制6个
-- 2. 单品链接Sitelink包含型号（强制2个）
-- 3. 店铺链接Sitelink可含型号（可选）
-- 4. 店铺链接允许使用"Shop All"类通用链接
-- 5. 修复v4.20店铺聚焦与单品型号的冲突规则
