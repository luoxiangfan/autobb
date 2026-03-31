-- 关键词意图聚类 v4.18 - 增强店铺链接分桶精准度
-- 修复问题：
-- 1. 添加明确的排除规则，避免关键词被错误分配
-- 2. 强化桶之间的边界定义
-- 3. 添加优先级规则处理多义关键词

-- 停用旧版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'keyword_intent_clustering';

-- 幂等性：避免重复执行时 v4.18 已存在导致唯一约束失败
DELETE FROM prompt_versions
WHERE prompt_id = 'keyword_intent_clustering' AND version = 'v4.18';

-- 插入新版本 v4.18
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  is_active,
  created_at
) VALUES (
  'keyword_intent_clustering',
  'v4.18',
  '关键词聚类',
  '关键词意图聚类v4.18 - 增强店铺链接分桶精准度',
  '修复店铺链接分桶精准度，添加排除规则避免错误分配',
  'keyword_intent_clustering.txt',
  'clusterKeywordsByIntent',
  '你是一个专业的Google Ads关键词分析专家。根据链接类型将关键词按用户搜索意图分成语义桶。

# 链接类型
链接类型：{{linkType}}
{{^linkType}}product{{/linkType}}
- product (单品链接): 目标是让用户购买具体产品
- store (店铺链接): 目标是让用户进入店铺

# 品牌信息
品牌名称：{{brandName}}
产品类别：{{productCategory}}

# 待分类关键词（已排除纯品牌词）
{{keywords}}

{{^linkType}}
# ========================================
# 单品链接分桶策略 (Product Page)
# ========================================
## 桶A - 产品型号导向 (Product-Specific)
**用户画像**：搜索具体产品型号、配置
**关键词特征**：
- 型号词：model xxx, pro, plus, max, ultra
- 产品词：camera, doorbell, vacuum, speaker
- 配置词：2k, 4k, 1080p, wireless, solar

**示例**：
- eufy security camera
- eufy doorbell 2k
- eufycam 2 pro
- eufy solar panel

## 桶B - 购买意图导向 (Purchase-Intent)
**用户画像**：有购买意向，搜索价格/优惠
**关键词特征**：
- 价格词：price, cost, cheap, affordable, deal, discount
- 购买词：buy, purchase, shop, order
- 促销词：sale, clearance, promotion, bundle

**示例**：
- buy security camera
- security camera deal
- eufy camera price
- discount doorbell

## 桶C - 功能特性导向 (Feature-Focused)
**用户画像**：关注技术规格、功能特性
**关键词特征**：
- 功能词：night vision, motion detection, two-way audio
- 规格词：4k, 2k, 1080p, wireless, battery
- 性能词：long battery, solar powered, waterproof

**示例**：
- wireless security camera
- night vision doorbell
- solar powered camera
- 4k security system

## 桶D - 紧迫促销导向 (Urgency-Promo)
**用户画像**：追求即时购买、最佳优惠
**关键词特征**：
- 紧迫感词：limited, today, now, urgent, ends soon
- 限时词：flash sale, today only, limited time
- 库存词：in stock, available, few left

**示例**：
- security camera today
- doorbell camera sale
- limited time offer
- eufy camera in stock

{{/linkType}}
{{#linkType}}
{{#equals linkType "store"}}
# ========================================
# 店铺链接分桶策略 (Store Page) - v4.18 增强版
# ========================================

## 🔥 v4.18 核心原则：精准分配 + 明确排除

**重要原则**：
1. **明确边界**：每个桶都有清晰的包含规则和排除规则
2. **优先级排序**：当关键词符合多个桶时，按优先级分配
3. **均衡分布**：确保5个桶都有关键词，但不强制"勉强符合"

---

### 桶A - 品牌信任导向 (Brand-Trust) 【优先级：2】

**用户画像**：认可品牌，寻求官方购买渠道、正品保障
**包含规则**：
- 官方词：official, store, website, shop（当单独出现时）
- 授权词：authorized, certified, genuine, authentic
- 正品保障：original, real, warranty, guarantee（当强调品牌信任时）
- 纯购买导向：buy, purchase, get, order（不含促销/价格词时）

**❌ 排除规则（关键）**：
- 不包含促销词：discount, sale, deal, coupon, promo, code, offer, clearance
- 不包含价格词：price, cost, cheap, affordable, budget
- 不包含具体型号：s8, q7, s7, q5, max, ultra, pro（单独型号）
- 不包含地理位置：locations, near me, delivery, shipping, local

**优先级规则**：
- "roborock official store" → 桶A ✅（官方+店铺）
- "roborock store discount" → 桶S ❌（店铺+促销，促销优先）
- "roborock buy" → 桶A ✅（纯购买意图）
- "buy roborock s8" → 桶C ❌（含型号，型号优先）

**示例**（符合桶A）：
- roborock official store
- roborock authorized dealer
- buy roborock authentic
- roborock genuine products

**反例**（不应归入桶A）：
- roborock store discount code ❌ → 应归入桶S（含促销词）
- roborock store locations ❌ → 应归入桶B或桶S（地理位置）
- roborock s8 buy ❌ → 应归入桶C（含具体型号）

---

### 桶B - 场景解决方案导向 (Scene-Solution) 【优先级：3】

**用户画像**：有具体使用场景需求、想了解产品适用性
**包含规则**：
- 场景词：home, house, apartment, kitchen, living room, bedroom
- 环境词：indoor, outdoor, garage, backyard, patio
- 任务词：clean, mop, vacuum, sweep, wash
- 目标对象：floor, carpet, tile, hardwood, pet hair, baby

**❌ 排除规则（关键）**：
- 不包含具体型号：s8, q7, max, ultra, pro（除非与场景词强关联）
- 不包含地理位置：locations, near, delivery, store finder
- 不包含促销/价格：discount, sale, price, deal
- 不包含单纯产品类别：robot vacuum（不含使用场景）

**识别技巧**：
- 看关键词是否回答 "在哪里用？" "用来做什么？"
- "roborock for home" ✅（场景明确）
- "roborock s8" ❌（只有型号，无场景）
- "roborock pet hair" ✅（目标对象明确）

**示例**（符合桶B）：
- roborock home cleaning
- robot vacuum for pet hair
- roborock floor cleaner
- vacuum for hardwood floors

**反例**（不应归入桶B）：
- roborock store locations ❌ → 应归入桶S（地理位置，非使用场景）
- roborock s8 pro ❌ → 应归入桶C（具体型号）
- roborock vacuum ❌ → 应归入桶S（通用品类词）

---

### 桶C - 精选推荐导向 (Collection-Highlight) 【优先级：1】

**用户画像**：想了解店铺热销、推荐产品、具体型号
**包含规则**：
- 热销词：best, top, popular, best seller, #1, rated
- 推荐词：recommended, featured, choice, must have
- 新品词：new, latest, 2024, 2025, newest
- **具体型号**：s8, q7, s7 max, q5, s8 pro ultra（重要特征！）
- 高端词：premium, flagship, advanced

**❌ 排除规则**：
- 不包含促销/价格：discount, sale, price, deal（除非与型号强关联）
- 不包含评价词：review, rating, feedback（应归入桶D）

**优先级规则（最高）**：
- **包含具体型号的关键词，优先归入桶C**
- "roborock s8" → 桶C ✅
- "best roborock s8" → 桶C ✅
- "roborock s8 price" → 桶S ❌（型号+价格，价格优先）

**示例**（符合桶C）：
- roborock s8 pro ultra
- roborock q7 max
- best roborock vacuum
- top rated robot vacuum
- roborock new 2024

**反例**（不应归入桶C）：
- roborock price ❌ → 应归入桶S（价格查询）
- roborock review ❌ → 应归入桶D（评价查询）

---

### 桶D - 信任信号导向 (Trust-Signals) 【优先级：4】

**用户画像**：关注店铺信誉、用户评价、售后保障
**包含规则**：
- 评价词：review, rating, testimonial, feedback, comment, opinion
- 保障词：warranty, guarantee, replacement, refund, return policy
- 服务词：support, service, customer service, help, assistance
- 质量词：quality, reliability, durability

**❌ 排除规则（关键）**：
- 不包含价格词：price, cost, cheap, affordable（价格查询不是信任信号）
- 不包含促销词：discount, sale, deal, coupon
- 不包含具体型号（除非与评价强关联）："roborock review" ✅，"roborock s8" ❌

**示例**（符合桶D）：
- roborock review
- robot vacuum rating
- roborock warranty
- vacuum cleaner customer service
- roborock quality

**反例**（不应归入桶D）：
- roborock price ❌ → 应归入桶S（价格查询）
- roborock s8 ❌ → 应归入桶C（具体型号）
- roborock floor cleaning ❌ → 应归入桶B（使用场景）

---

### 桶S - 店铺全景导向 (Store-Overview) 【优先级：5】

**用户画像**：想全面了解店铺、查找店铺位置、寻找优惠促销
**包含规则**：
- 店铺相关：all products, full range, collection, catalog
- 品类通用：robot vacuum, vacuum cleaner（不含具体型号）
- **促销/价格**：discount, sale, deal, coupon, promo, code, price, cost, cheap
- **地理位置**：locations, store finder, near me, delivery, shipping
- 综合查询：品牌 + 品类（如 "roborock vacuum"）

**❌ 排除规则**：
- 不包含具体型号（除非与促销强关联）："roborock s8 price" 可归入桶S
- 不包含纯场景词："pet hair vacuum" → 桶B

**兜底规则**：
- 如果关键词不明确符合桶A/B/C/D，默认归入桶S
- 所有包含促销/价格词的关键词，默认归入桶S

**示例**（符合桶S）：
- roborock store discount code
- roborock sale
- roborock price
- roborock store locations
- robot vacuum（通用品类）
- roborock all products

---

## 🎯 分桶决策流程（v4.18）

按以下顺序检查关键词：

### 第1步：检查排他性特征（强制规则）
```
IF 包含 {discount, sale, deal, coupon, promo, code, price, cost, cheap}
  → 桶S（促销/价格优先）

ELSE IF 包含 {s8, q7, s7, q5, max, ultra, pro} 且为具体型号
  → 桶C（型号优先）

ELSE IF 包含 {review, rating, testimonial, feedback}
  → 桶D（评价优先）

ELSE 继续检查其他特征
```

### 第2步：检查场景特征
```
IF 包含 {home, house, pet hair, floor, carpet, hardwood} 且不含型号
  → 桶B（场景解决方案）
```

### 第3步：检查品牌信任特征
```
IF 包含 {official, authorized, genuine, authentic} 且不含促销/价格
  → 桶A（品牌信任）
```

### 第4步：兜底规则
```
ELSE
  → 桶S（店铺全景）
```

{{/equals}}
{{/linkType}}
{{/linkType}}

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶
2. **完整性**：所有关键词都必须分配
3. **🔥 精准性（v4.18核心）**：
   - 优先匹配明确特征（促销→桶S，型号→桶C，评价→桶D）
   - 使用排除规则避免错误分配
   - 按决策流程顺序检查（不再强制"勉强符合"）
4. **均衡性**：目标是每个桶有合理分布，但不强制平均

# 输出格式（店铺链接 - 5桶）
{
  "bucketA": { "intent": "品牌信任导向", "intentEn": "Brand-Trust", "description": "用户认可品牌，寻求官方购买渠道", "keywords": [...] },
  "bucketB": { "intent": "场景解决方案导向", "intentEn": "Scene-Solution", "description": "用户有具体使用场景需求", "keywords": [...] },
  "bucketC": { "intent": "精选推荐导向", "intentEn": "Collection-Highlight", "description": "用户想了解店铺热销/推荐产品", "keywords": [...] },
  "bucketD": { "intent": "信任信号导向", "intentEn": "Trust-Signals", "description": "用户关注店铺信誉、售后保障", "keywords": [...] },
  "bucketS": { "intent": "店铺全景导向", "intentEn": "Store-Overview", "description": "用户想全面了解店铺、查找优惠促销", "keywords": [...] },
  "statistics": { "totalKeywords": N, "bucketACount": N, "bucketBCount": N, "bucketCCount": N, "bucketDCount": N, "bucketSCount": N, "balanceScore": 0.95 }
}

注意事项：
1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中
3. balanceScore = 1 - (max差异 / 总数)
4. 🔥 严格遵循排除规则和优先级！不要将促销词分到桶A，不要将型号词分到桶B',
  1,
  datetime('now')
);
