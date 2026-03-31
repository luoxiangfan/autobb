-- Migration: Prompt v4.30 - 明确Keywords数量+精简标记
-- Date: 2025-12-26
-- Description: Keywords统一为15个，减少CRITICAL标记，优化用词

-- 删除可能存在的 v4.30（幂等性）
DELETE FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.30';

-- 停用旧版本
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

-- 插入新版本 v4.30
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
  'ad_creative_generation',
  'v4.30',
  '广告创意生成',
  '广告创意生成v4.30 - 明确Keywords数量+精简标记',
  'Keywords统一为15个，减少CRITICAL标记，优化用词',
  'src/lib/ad-creative-generator.ts',
  'generateAdCreative',
  '-- ============================================
## 任务
为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。

## ⚠️ 字符限制（CRITICAL - 必须严格遵守）

生成时必须控制长度，不得依赖后端截断：
- **Headlines**: 每个≤30字符（含空格、标点）
- **Descriptions**: 每个≤90字符（含空格、标点）
- **Callouts**: 每个≤25字符
- **Sitelink text**: 每个≤25字符
- **Sitelink description**: 每个≤35字符

**验证方法**：生成每个元素后立即检查字符数，超长则重写为更短版本。

## 输出格式
JSON格式：
{
  "headlines": ["标题1", "标题2", ...],  // 15个，每个≤30字符
  "descriptions": ["描述1", "描述2", "描述3", "描述4"],  // 4个，每个≤90字符
  "keywords": ["关键词1", "关键词2", ...],  // 15个
  "callouts": ["卖点1", "卖点2", "卖点3", "卖点4", "卖点5", "卖点6"],  // 6个，每个≤25字符
  "sitelinks": [  // 6个
    {"text": "≤25字符", "url": "/", "description": "≤35字符"}
  ]
}

## 基本要求
1. 所有内容必须使用目标语言：{{target_language}}
2. 固定数量：15个标题，4个描述，15个关键词，6个Callouts，6个Sitelinks
3. 所有创意元素必须与单品/店铺链接类型一致
4. 每个元素必须语义完整，不得因字符限制而截断句子

## 语言指令
{{language_instruction}}

## 产品/店铺信息
{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}

{{enhanced_features_section}}
{{localization_section}}
{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}
{{theme_section}}
{{reference_performance_section}}
{{extracted_elements_section}}

## 关键词使用规则
{{ai_keywords_section}}

**关键词嵌入规则**：
- 8/15 (53%+) 标题必须包含关键词
- 4/4 (100%) 描述必须包含关键词
- 优先使用搜索量>1000的关键词
- 品牌词必须在至少2个标题中出现

## 标题结构：5+5+5 

15个标题必须分为3类，每类5个：

### 类别1 - 产品型号聚焦 (5个)
- 必须包含完整产品型号
- 第1个标题必须使用动态关键词插入：{KeyWord:品牌名}
- 示例（≤30字符）：
  * "{KeyWord:Roborock} Official" (26字符)
  * "Qrevo Curv 2 Pro: 25000 Pa" (27字符)
  * "Gen 2: Sleep Tracking" (23字符)

### 类别2 - 利益导向聚焦 (5个) ⭐
- 强调用户获得的利益和价值，而非产品特性
- 示例（≤30字符）：
  * "Gagnez 2h par Semaine" (22字符)
  * "Maison Propre Sans Effort" (26字符)
  * "Save 2 Hours Weekly" (19字符)
  * "Effortless Clean Home" (21字符)
  * "No More Pet Hair Mess" (21字符)

### 类别3 - 行动号召聚焦 (5个) ⭐
- 使用多样化结构，驱动点击
- 结构类型（每种至少1个）：
  * 疑问句："Need a Smarter Vacuum?" (24字符)
  * 紧迫感："Limited Time: Save 23%" (23字符)
  * 社交证明："5000+ Clients Satisfaits" (25字符)
  * 直接CTA："Shop Official Store" (19字符)
  * 独特卖点："Only 100°C Mop Cleaning" (24字符)

## 描述结构：2+1+1 (CRITICAL) ⭐

4个描述必须分为3类，每个≤90字符且语义完整：

### 类别1 - 产品型号+核心功能 (2个)
- 包含产品型号 + 2-3个核心功能 + CTA
- 示例（≤90字符）：
  * "Roborock Qrevo Curv 2 Pro: 25000Pa suction, 100°C mop. Save 23%. Shop now." (78字符)
  * "Gen 2 with sleep tracking & heart rate. Limited offer. Order today." (69字符)

### 类别2 - 利益驱动 (1个) ⭐
- 聚焦用户获得的利益和生活改善
- 示例（≤90字符）：
  * "Save 2 hours weekly with auto cleaning. Perfect for pet owners. Buy now." (75字符)

### 类别3 - 信任+紧迫感 (1个) ⭐
- 结合社交证明、保障和限时优惠
- 示例（≤90字符）：
  * "5000+ satisfied customers. 2-year warranty. Free shipping. Limited -23%. Order today." (87字符)

**每个描述必须包含明确CTA**：
- CTA示例：Shop now, Buy now, Order today, Get yours

## Callouts结构：2+2+2 

6个Callouts必须分为3类，每个≤25字符：

### 类别1 - 信任信号 (2个)
示例：
- "Official Store" (14字符)
- "2-Year Warranty" (15字符)

### 类别2 - 优惠促销 (2个)
示例：
- "Free Shipping" (13字符)
- "Limited Time -23%" (17字符)

### 类别3 - 产品特性 (2个)
示例：
- "25000Pa Suction" (15字符)
- "100°C Mop Cleaning" (18字符)

## Sitelinks结构：2+2+2 

6个Sitelinks，每个text≤25字符，description≤35字符：

### 类别1 - 产品型号 (2个)
示例：
- text: "Qrevo Curv 2 Pro" (16字符)
  description: "25000Pa suction, 100°C mop" (27字符)

### 类别2 - 品牌+品类 (2个)
示例：
- text: "Roborock Vacuums" (17字符)
  description: "Official store, free shipping" (31字符)

### 类别3 - 功能+场景 (2个)
示例：
- text: "Pet Hair Solution" (17字符)
  description: "Auto cleaning for pet owners" (29字符)

## 单品链接特殊规则

**如果是单品链接（product link）**：
- 所有创意元素必须100%聚焦单品
- 禁止提到"browse our collection"
- 禁止提到其他品类名称

## 店铺链接特殊规则

**如果是店铺链接（store link）**：
- 目标：驱动用户进店探索
- **允许**使用"Shop All"类通用链接
- **可以**包含单品型号（可选）
- 必须与店铺整体主题相关

## 桶类型适配 

根据 {{bucket_type}} 调整创意角度：

### 桶A（品牌认知）
- 全部15个标题必须包含品牌词
- 强调官方、正品、信任

### 桶B（使用场景）
- 至少10个标题包含场景词（pet, home, family...）
- 强调使用场景和用户痛点

### 桶C（功能特性）
- 至少10个标题包含功能词（suction, power, heat...）
- 强调技术参数和独特功能

### 桶D（价格促销）
- 至少10个标题包含价格/促销词
- 强调折扣、限时、性价比

### 桶S（综合平衡）
- 平衡品牌、功能、场景
- 适合全面覆盖

## 本地化规则

### 货币符号
- US: USD ($)
- UK: GBP (£)
- EU: EUR (€)

### 紧急感本地化
- US/UK: "Limited Time", "Today Only"
- DE: "Nur heute", "Zeitlich begrenzt"
- FR: "Offre limitée", "Aujourd''hui seulement"
- JA: "今だけ", "期間限定"

## 质量检查清单

生成后检查：
- [ ] 所有headlines ≤30字符且语义完整
- [ ] 所有descriptions ≤90字符且语义完整
- [ ] 所有callouts ≤25字符（6个）
- [ ] 所有sitelink text ≤25字符
- [ ] 所有sitelink description ≤35字符
- [ ] 15个标题分为5+5+5
- [ ] 4个描述包含明确CTA
- [ ] 6个Callouts分为2+2+2
- [ ] 6个Sitelinks完整
- [ ] 15个关键词
- [ ] 关键词嵌入率达标
- [ ] 至少2个疑问句标题
- [ ] 至少2个利益导向标题

如果不满足任何关键要求，重新生成。',
  true,
  NOW()
);
