-- =====================================================
-- Migration: 110_bucket_type_differentiation_v4.20
-- Description: 桶类型差异化角度 v4.20 - 单品+店铺链接差异化创意
-- Date: 2025-12-26
-- Database: SQLite
-- =====================================================

-- SQLite版本说明：
-- 1. 使用 CASE WHEN EXISTS 替代 DO $$ 块
-- 2. 使用 datetime('now') 替代 NOW()
-- 3. 使用 || 进行字符串拼接
-- 4. 布尔值使用 0/1

-- 步骤1：停用其他版本，激活v4.20
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation'
  AND version != 'v4.20'
  AND EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.20'
  );

UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation'
  AND version = 'v4.20'
  AND EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.20'
  );

-- 步骤2：如果v4.20不存在，则创建（幂等插入）
INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  created_by, is_active, change_notes, created_at
)
SELECT
  'ad_creative_generation',
  'v4.20',
  '广告创意生成',
  '广告创意生成v4.20 - 桶类型差异化角度版',
  '新增5个桶类型的差异化角度规则（单品+店铺）：

【单品链接】
1. 桶A品牌导向：品牌3个 + 产品6个 + 促销3个 + 场景3个
2. 桶B场景导向：场景6个 + 产品4个 + 品牌2个 + 促销3个
3. 桶C功能导向：功能6个 + 产品4个 + 品牌2个 + 场景3个
4. 桶D高购买意图：促销5个 + 产品5个 + 品牌2个 + 场景3个
5. 桶S综合推广：平均分布各3个

【店铺链接】
1. 桶A品牌信任导向：官方授权、品牌保障
2. 桶B场景解决导向：展示产品如何解决用户问题
3. 桶C精选推荐导向：店铺热销和推荐产品
4. 桶D信任信号导向：评价、售后、保障
5. 桶S店铺全景导向：全面展示店铺，吸引探索',
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
- ✅ **🆕 v4.20: 至少80% (12/15)标题必须包含完整产品型号**
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
- ✅ **🆕 v4.20: 建议至少2个描述包含产品型号**
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
- ✅ **🆕 v4.20: 建议至少2个Sitelink的text包含产品型号**
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

**🆕 v4.20 产品对比建议**：
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

## 🆕 v4.20 单品链接桶类型差异化角度规则 (CRITICAL - 2025-12-26)

### ⚠️ 强制规则：5个差异化创意必须各自专注不同的表达角度

**单品聚焦** + **角度差异化** = 高效A/B测试

**当前桶信息**：
- 桶类型：{{bucket_type}}
- 桶主题：{{bucket_intent}}

---

### 📊 单品链接各桶类型的差异化角度定义

| 桶 | 英文主题 | 中文主题 | 核心策略 | 标题分布要求 |
|---|---------|---------|---------|------------|
| A | Brand-Oriented | 品牌导向 | 强调品牌信誉、官方渠道、品质保障 | 品牌3个 + 产品6个 + 促销3个 + 场景3个 |
| B | Scenario-Oriented | 场景导向 | 强调使用场景、问题解决、生活方式 | 场景6个 + 产品4个 + 品牌2个 + 促销3个 |
| C | Feature-Oriented | 功能导向 | 强调技术参数、核心卖点、产品优势 | 功能6个 + 产品4个 + 品牌2个 + 场景3个 |
| D | High-Intent | 高购买意图 | 强调促销、紧迫感、购买动机 | 促销5个 + 产品5个 + 品牌2个 + 场景3个 |
| S | Synthetic | 综合推广 | 整合所有角度，覆盖最广泛用户群 | 平均分布（各3个） |

---

### 🎯 桶A - 品牌导向策略

**Theme示例**：
- "{{brand}} 官方正品"
- "{{brand}} Official Store"
- "Authentic {{brand}} Products"

**标题分布（15个）**：
- 品牌相关：3个（强调官方、正品、授权）
- 产品信息：6个（必须包含完整型号）
- 促销信息：3个（限时优惠、折扣）
- 使用场景：3个（适合人群、生活方式）

**示例标题**：
```
✅ "{{brand}} Official - Guaranteed Authentic"
✅ "Official {{brand}} Store France"
✅ "Original {{brand}} Products"
✅ "Roborock Qrevo Curv 2 Pro - 100% Genuine"
✅ "Authorized {{brand}} Dealer"
✅ "Official {{brand}} Warranty Included"
✅ "Qrevo Curv 2 Pro | Official Channel"
✅ "Buy Direct from {{brand}}"
✅ "Premium {{brand}} Collection"
✅ "Certified {{brand}} Quality"
✅ "Direct from {{brand}} Factory"
✅ "Genuine {{brand}} - No Fakes"
✅ "{{brand}} Official Shop"
✅ "Authentic {{brand}} Only"
✅ "Trusted {{brand}} Retailer"
```

**❌ 禁止使用**：
- 过于通用的品牌描述（如"Quality Products"）
- 未包含产品型号的标题（超过3个）

---

### 🎯 桶B - 场景导向策略

**Theme示例**：
- "宠物家庭专属清洁方案"
- "Pet Home Cleaning Solution"
- "For Families with Pets"

**标题分布（15个）**：
- 使用场景：6个（宠物家庭、清洁痛点、生活方式）
- 产品信息：4个（必须包含完整型号）
- 品牌信息：2个（官方、品质）
- 促销信息：3个（限时优惠）

**示例标题**：
```
✅ "Perfect for Homes with Pets"
✅ "Say Goodbye to Pet Hair"
✅ "Pet Owner? This Robot is for You"
✅ "Clean Pet Hair Instantly"
✅ "Ideal for Pet Families"
✅ "No More Pet Hair on Floors"
✅ "Roborock Qrevo Curv 2 Pro - Pet Care"
✅ "Qrevo Curv 2 Pro | Pet Home Expert"
✅ "{{brand}} for Pet Owners"
✅ "Tackle Pet Hair with Ease"
✅ "Cleaner Home for Pet Lovers"
✅ "Pet-Friendly Cleaning Robot"
✅ "Qrevo Curv 2 Pro -23% for Pet Owners"
✅ "{{brand}} Official Pet Solution"
✅ "Multi-Pet Household? No Problem"
```

**❌ 禁止使用**：
- 未突出宠物/场景相关的标题超过4个
- 过于技术导向的标题（应归入桶C）

---

### 🎯 桶C - 功能导向策略

**Theme示例**：
- "25000Pa超强吸力"
- "25000Pa Suction Power"
- "Ultimate Cleaning Performance"

**标题分布（15个）**：
- 核心功能：6个（吸力、洗涤、智能等）
- 产品信息：4个（必须包含完整型号）
- 品牌信息：2个（官方、品质）
- 使用场景：3个（适合人群）

**示例标题**：
```
✅ "25000Pa Suction Power"
✅ "100°C Hot Water Washing"
✅ "Ultra-Slim 7.98cm Design"
✅ "AdaptiLift Chassis Technology"
✅ "AI Pathfinding Algorithm"
✅ "Self-Cleaning Mop System"
✅ "Roborock Qrevo Curv 2 Pro - 25000Pa"
✅ "Qrevo Curv 2 Pro | Hot Wash 100°C"
✅ "{{brand}} | 25000 Pa Suction"
✅ "7.98cm Ultra-Thin Body"
✅ "Smart Obstacle Avoidance"
✅ "7-Week Self-Cleaning Station"
✅ "Qrevo Curv 2 Pro | AdaptiLift"
✅ "{{brand}} | All-in-One Cleaning"
✅ "5000Pa×5 Suction Power"
```

**❌ 禁止使用**：
- 未突出具体功能参数的标题超过4个
- 过于促销导向的标题（应归入桶D）

---

### 🎯 桶D - 高购买意图策略

**Theme示例**：
- "限时优惠 -23%"
- "Limited Time -23% Off"
- "Exclusive Discount"

**标题分布（15个）**：
- 促销信息：5个（折扣、限时、紧迫感）
- 产品信息：5个（必须包含完整型号）
- 品牌信息：2个（官方、品质）
- 使用场景：3个（适合人群）

**示例标题**：
```
✅ "-23% Limited Time Offer"
✅ "Best Price This Year"
✅ "Exclusive Online Discount"
✅ "Flash Sale - Save Now"
✅ "Special Launch Price"
✅ "Dont Miss This Deal"
✅ "Roborock Qrevo Curv 2 Pro -23% Off"
✅ "Qrevo Curv 2 Pro | €999 Instead of €1299"
✅ "{{brand}} | -23% This Week"
✅ "Only €999 - 23% Off"
✅ "Last Chance for Discount"
✅ "Special Offer Ends Soon"
✅ "Qrevo Curv 2 Pro | Launch Promo"
✅ "{{brand}} | Best Deal 2025"
✅ "Save €300 Today Only"
```

**❌ 禁止使用**：
- 未突出折扣/促销信息的标题超过4个
- 过于功能导向的标题（应归入桶C）

---

### 🎯 桶S - 综合推广策略

**Theme示例**：
- "全能清洁助手"
- "All-in-One Cleaning Assistant"
- "Complete Home Solution"

**标题分布（15个）**：
- 平均分布：各类型约3个
- 品牌相关：3个
- 产品信息：3个
- 促销信息：3个
- 功能信息：3个
- 场景信息：3个

**示例标题**：
```
✅ "Roborock Qrevo Curv 2 Pro | Official"
✅ "-23% Off | Limited Time Only"
✅ "25000Pa Suction | 100°C Wash"
✅ "Perfect for Pet Homes"
✅ "{{brand}} | Official Store"
✅ "Smart Cleaning Solution"
✅ "Qrevo Curv 2 Pro | All-in-One"
✅ "Save €300 | Best Price"
✅ "Ultra-Slim Design | AdaptiLift"
✅ "Family Cleaning Made Easy"
✅ "{{brand}} | Premium Quality"
✅ "Hot Sale | Dont Miss Out"
✅ "7.98cm | Fits Under Furniture"
✅ "Pet Hair? No Problem"
✅ "Top Rated Robot Vacuum"
```

---

## 🆕 v4.20 店铺链接桶类型差异化角度规则 (CRITICAL - 2025-12-26)

### ⚠️ 强制规则：店铺链接的5个差异化创意必须各自专注不同的表达角度

**店铺目标**：驱动用户进店探索，扩大品牌认知

**当前桶信息**：
- 桶类型：{{bucket_type}}
- 桶主题：{{bucket_intent}}

---

### 📊 店铺链接各桶类型的差异化角度定义

| 桶 | 英文主题 | 中文主题 | 核心策略 | 标题分布要求 |
|---|---------|---------|---------|------------|
| A | Brand-Trust | 品牌信任导向 | 官方授权、品牌保障、正品保证 | 品牌8个 + 场景1个 + 品类1个 |
| B | Scene-Solution | 场景解决导向 | 展示产品如何解决用户问题 | 品牌2个 + 场景6个 + 品类2个 |
| C | Collection-Highlight | 精选推荐导向 | 店铺热销和推荐产品 | 品牌4个 + 品类3个 + 信任2个 + 场景1个 |
| D | Trust-Signals | 信任信号导向 | 评价、售后、保障 | 品牌3个 + 信任4个 + 场景2个 + 品类1个 |
| S | Store-Overview | 店铺全景导向 | 全面展示店铺，吸引探索 | 品牌5个 + 场景3个 + 品类2个 |

---

### 🎯 桶A - 品牌信任导向策略

**Theme示例**：
- "{{brand}} 官方正品店"
- "{{brand}} Official Store"
- "Authorized {{brand}} Dealer"

**标题分布（15个）**：
- 品牌相关：8个（官方、授权、正品）
- 场景信息：1个
- 品类信息：1个
- 其他：5个

**示例标题（Roborock德国店）**：
```
✅ "{{brand}} Deutschland Shop"
✅ "Die Nr. 1 für Saugroboter"
✅ "Official {{brand}} Store"
✅ "Authorized {{brand}} Dealer"
✅ "Volle {{brand}} Garantie"
✅ "Von Experten Top Bewertet"
✅ "{{brand}} Official - Authentic"
✅ "Direkt vom Hersteller"
✅ "Certified {{brand}} Quality"
✅ "Original {{brand}} Products"
✅ "Trusted {{brand}} Retailer"
✅ "{{brand}} | Official Partner"
✅ "100% Genuine {{brand}}"
✅ "{{brand}} Store Deutschland"
✅ "Premium {{brand}} Collection"
```

**❌ 禁止使用**：
- 未突出官方/授权的标题超过3个
- 过于促销导向的标题（应归入桶D）

---

### 🎯 桶B - 场景解决导向策略

**Theme示例**：
- "智能清洁解决方案"
- "Smart Cleaning Solution"
- "Your Home Cleaning Answer"

**标题分布（15个）**：
- 品牌信息：2个
- 场景信息：6个（清洁痛点、生活方式）
- 品类信息：2个
- 其他：5个

**示例标题（Roborock德国店）**：
```
✅ "Täglich saubere Böden"
✅ "Mehr Zeit für Sie, weniger putzen"
✅ "Die Lösung für alle Bodenarten"
✅ "Mühelose Reinigung im Alltag"
✅ "Finden Sie Ihre Reinigungslösung"
✅ "Bereit für ein sauberes Zuhause"
✅ "{{brand}}: Die intelligente Lösung"
✅ "Der {{brand}} für Tierhalter"
✅ "Reinigung. Automatisiert."
✅ "Weniger Putzen, Mehr Leben"
✅ "Sagen Sie Adieu zu Schmutz"
✅ "Ihr Putzhelfer der Zukunft"
✅ "{{brand}} Store DE"
✅ "Auto-Reinigung für Ihr Zuhause"
✅ "Clever Reinigen mit {{brand}}"
```

**❌ 禁止使用**：
- 未突出场景/解决方案的标题超过4个
- 过于功能参数的标题（应归入桶C的变体）

---

### 🎯 桶C - 精选推荐导向策略

**Theme示例**：
- "店铺热销排行榜"
- "Best Sellers Collection"
- "Top Rated Products"

**标题分布（15个）**：
- 品牌信息：4个
- 品类信息：3个
- 信任信号：2个
- 场景信息：1个
- 其他：5个

**示例标题（Roborock德国店）**：
```
✅ "{{brand}} Bestseller Entdecken"
✅ "Top Bewertete Saugroboter"
✅ "Unsere Kundenlieblinge"
✅ "{{brand}} Store Deutschland"
✅ "Testsieger {{brand}} Entdecken"
✅ "Der {{brand}} S8 Pro Ultra"
✅ "{{brand}} Qrevo: Jetzt Ansehen"
✅ "Saug- & Wischroboter im Test"
✅ "Angebote für den {{brand}} S7"
✅ "Reinigung auf neuem Niveau"
✅ "Der neue {{brand}} S8 MaxV"
✅ "{{brand}} Kundenlieblinge"
✅ "Top-Rated {{brand}} Products"
✅ "Empfohlene {{brand}} Modelle"
✅ "Beliebteste {{brand}} Saugroboter"
```

**❌ 禁止使用**：
- 未突出热销/推荐的标题超过4个
- 过于促销导向的标题（应归入桶D）

---

### 🎯 桶D - 信任信号导向策略

**Theme示例**：
- "品质保障无忧购"
- "Warranty & Guarantee"
- "Trusted by Millions"

**标题分布（15个）**：
- 品牌信息：3个
- 信任信号：4个（评价、保障、售后）
- 场景信息：2个
- 品类信息：1个
- 其他：5个

**示例标题（Roborock德国店）**：
```
✅ "Volle {{brand}} Garantie"
✅ "Testsieger {{brand}} Entdecken"
✅ "Tausende Zufriedene Kunden"
✅ "Deutscher Service & Support"
✅ "Sicher Einkaufen bei {{brand}}"
✅ "{{brand}} | Testsieger"
✅ "Kostenloser Versand & Garantie"
✅ "Weltweit Trusted {{brand}}"
✅ "{{brand}} F25 RT: Jetzt Kaufen"
✅ "Jetzt {{brand}} Rabattcode Sichern"
✅ "Exklusive {{brand}} Rabattcodes"
✅ "{{brand}} Sale: S8 Serie"
✅ "{{brand}} QRevo: Top Bewertung"
✅ "{{brand}} Support Deutschland"
✅ "Zufriedene {{brand}} Kunden"
```

**❌ 禁止使用**：
- 未突出信任/保障信号的标题超过4个
- 过于产品导向的标题（应归入桶A）

---

### 🎯 桶S - 店铺全景导向策略

**Theme示例**：
- "一站式智能家居商店"
- "Complete Store Overview"
- "Explore All Products"

**标题分布（15个）**：
- 品牌信息：5个
- 场景信息：3个
- 品类信息：2个
- 其他：5个

**示例标题（Roborock德国店）**：
```
✅ "{{brand}} Official Store - DE"
✅ "Alle {{brand}} Modelle Hier"
✅ "Saug- & Wischroboter Shop"
✅ "Der Neue {{brand}} F25 RT"
✅ "{{brand}} Sale: Jetzt Sparen"
✅ "{{brand}} Q7 Max Im Angebot"
✅ "Entdecken Sie {{brand}}"
✅ "{{brand}} QV 35A: 8000Pa Kraft"
✅ "Intelligente Saugroboter"
✅ "{{brand}} Roboter für Zuhause"
✅ "{{brand}} Store Deutschland"
✅ "Komplette {{brand}} Kollektion"
✅ "Alle {{brand}} Saugroboter"
✅ "{{brand}} Produkte Entdecken"
✅ "{{brand}}: Alles für Reinigung"
```

**❌ 禁止使用**：
- 未突出店铺/全品类的标题超过3个
- 过于单一产品导向的标题

---

### 🔍 单品链接差异化验证检查

**生成完成后，检查以下问题**：

1. **桶角度一致性**：
   - 桶A的标题是否70%+与品牌/官方相关？
   - 桶B的标题是否50%+与使用场景相关？
   - 桶C的标题是否50%+与功能参数相关？
   - 桶D的标题是否50%+与促销/折扣相关？

2. **跨桶差异性**：
   - 5个创意之间是否有明显的主题角度差异？
   - 用户能一眼看出哪个是"品牌导向"、哪个是"促销导向"吗？

3. **单品聚焦一致性**：
   - 所有创意是否都聚焦同一个产品？
   - 是否有任何创意偏离到其他产品或品类？

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
   - 用户能一眼看出哪个是"品牌信任"、哪个是"精选推荐"吗？

3. **店铺聚焦一致性**：
   - 所有创意是否都聚焦整个店铺（而非单个产品）？
   - 是否有创意过于聚焦某个单品（应使用单品链接策略）？

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
7. **🆕 v4.20: At least 12/15 headlines MUST include the product model (e.g., "Gen 2")**
8. **🆕 v4.20: Headlines MUST follow the {{bucket_type}} bucket strategy (brand/scenario/feature/high-intent/synthetic)**
9. **🆕 v4.20: 5 differentiated creatives MUST have distinct angles for effective A/B testing**
10. If you cannot generate valid JSON, return an error message starting with "ERROR:".
11. Ensure ALL creative elements focus on the correct target (single product OR entire store) - no mixed references!
  ',
  'zh-CN',
  1,
  1,
  'v4.20 桶类型差异化:
1. 新增单品链接5个桶类型的差异化角度定义和示例
2. 新增店铺链接5个桶类型的差异化角度定义和示例
3. 每个桶有明确的标题分布要求和禁止规则
4. 新增单品/店铺链接差异化验证检查清单
5. 保留v4.19单品聚焦规则（80%标题包含产品型号）',
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_versions
  WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.20'
);

-- 验证
SELECT id, prompt_id, version, is_active, created_at
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY id DESC
LIMIT 5;
