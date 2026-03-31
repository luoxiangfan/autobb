-- Migration: 114_prompt_v4.26_clean.pg.sql
-- Description: v4.26 完整重写 - 整合所有功能，解决历史冲突
-- Date: 2025-12-26
-- PostgreSQL 版本

-- 1) 如果 v4.26 已存在：仅更新其内容（避免 UNIQUE(prompt_id, version) 冲突）
UPDATE prompt_versions
SET
  prompt_content = '-- ============================================
-- Google Ads 广告创意生成 v4.26 (2025-12-26)
-- 完整重写版 - 整合所有功能，解决历史冲突
-- ============================================

## 任务
为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。

## 输出格式
JSON格式：
{
  "headlines": ["标题1", "标题2", ...],  // 15个，每个≤30字符
  "descriptions": ["描述1", "描述2", ...],  // 5个，每个≤90字符
  "keywords": ["关键词1", "关键词2", ...],  // 10-15个
  "sitelinks": [  // 6个
    {"text": "链接文本", "url": "/", "description": "链接描述"}
  ]
}

## 基本要求
1. 所有内容必须使用目标语言：{{target_language}}
2. 所有标题 ≤30字符，所有描述 ≤90字符
3. 恰好15个标题，恰好5个描述，恰好6个Sitelinks
4. 所有创意元素必须与单品/店铺链接类型一致

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
- 5/5 (100%) 描述必须包含关键词
- 优先使用搜索量>1000的关键词
- 品牌词必须在至少2个标题中出现

## 标题结构：5+5+5 (CRITICAL)

15个标题必须分为3类，每类恰好5个：

### 类别1 - 产品型号聚焦 (5个)
- 必须包含完整产品型号
- 示例："Qrevo Curv 2 Pro: 25000 Pa", "Gen 2: Sleep Tracking"
- 这5个标题帮助用户快速识别具体产品

### 类别2 - 品牌+品类聚焦 (5个)
- 包含品牌名 + 品类词，不提具体型号
- 示例："Roborock Robot Vacuum Sale", "Aspirateur Roborock Officiel"
- 这5个标题覆盖品牌认知用户

### 类别3 - 场景+功能聚焦 (5个)
- 聚焦使用场景、核心功能或用户痛点
- 可以不提品牌，强调通用价值
- 示例："Nettoyage Auto pour Animaux", "Aspiration 25000Pa"
- 这5个标题覆盖场景搜索用户

**验证规则**：
- 生成后统计每类数量，必须恰好5+5+5=15
- 如果不符合，重新生成

## 描述结构：2+2+1 (CRITICAL)

5个描述必须分为3类：

### 类别1 - 产品型号聚焦 (2个)
- 包含产品型号 + 核心功能

### 类别2 - 品牌+品类聚焦 (2个)
- 包含品牌名 + 应用场景

### 类别3 - 功能痛点解决 (1个)
- 纯功能/痛点解决方案

**每个描述必须包含明确CTA**：
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours

## Sitelinks结构：2+2+2 (CRITICAL)

6个Sitelinks必须分为3类：

### 类别1 - 产品型号 (2个)
- 包含产品型号的链接

### 类别2 - 品牌+品类 (2个)
- 品牌+品类导向的链接

### 类别3 - 功能+场景 (2个)
- 功能/场景导向的链接

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

## 桶类型适配 (CRITICAL)

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
- DE: "Nur heute", "Oferta limitada"
- JA: "今だけ", "期間制限"

## 质量检查清单

生成后检查：
- [ ] 15个标题恰好5+5+5分类
- [ ] 5个描述包含明确CTA
- [ ] 6个Sitelinks完整
- [ ] 所有元素与单品/店铺类型一致
- [ ] 关键词嵌入率达标
- [ ] 桶主题覆盖率达标

如果不满足任何关键要求，重新生成。',
  name = '广告创意生成v4.26 - 完整重写版',
  change_notes = 'v4.26 完整重写：5+5+5标题 + 2+2+1描述 + 2+2+2 Sitelinks + 桶类型适配'
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.26';

-- 2) 如果 v4.26 不存在：才把当前 active 的 v4.25 升级为 v4.26
UPDATE prompt_versions
SET
  prompt_content = '-- ============================================
-- Google Ads 广告创意生成 v4.26 (2025-12-26)
-- 完整重写版 - 整合所有功能，解决历史冲突
-- ============================================

## 任务
为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。

## 输出格式
JSON格式：
{
  \"headlines\": [\"标题1\", \"标题2\", ...],  // 15个，每个≤30字符
  \"descriptions\": [\"描述1\", \"描述2\", ...],  // 5个，每个≤90字符
  \"keywords\": [\"关键词1\", \"关键词2\", ...],  // 10-15个
  \"sitelinks\": [  // 6个
    {\"text\": \"链接文本\", \"url\": \"/\", \"description\": \"链接描述\"}
  ]
}

## 基本要求
1. 所有内容必须使用目标语言：{{target_language}}
2. 所有标题 ≤30字符，所有描述 ≤90字符
3. 恰好15个标题，恰好5个描述，恰好6个Sitelinks
4. 所有创意元素必须与单品/店铺链接类型一致

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
- 5/5 (100%) 描述必须包含关键词
- 优先使用搜索量>1000的关键词
- 品牌词必须在至少2个标题中出现

## 标题结构：5+5+5 (CRITICAL)

15个标题必须分为3类，每类恰好5个：

### 类别1 - 产品型号聚焦 (5个)
- 必须包含完整产品型号
- 示例：\"Qrevo Curv 2 Pro: 25000 Pa\", \"Gen 2: Sleep Tracking\"
- 这5个标题帮助用户快速识别具体产品

### 类别2 - 品牌+品类聚焦 (5个)
- 包含品牌名 + 品类词，不提具体型号
- 示例：\"Roborock Robot Vacuum Sale\", \"Aspirateur Roborock Officiel\"
- 这5个标题覆盖品牌认知用户

### 类别3 - 场景+功能聚焦 (5个)
- 聚焦使用场景、核心功能或用户痛点
- 可以不提品牌，强调通用价值
- 示例：\"Nettoyage Auto pour Animaux\", \"Aspiration 25000Pa\"
- 这5个标题覆盖场景搜索用户

**验证规则**：
- 生成后统计每类数量，必须恰好5+5+5=15
- 如果不符合，重新生成

## 描述结构：2+2+1 (CRITICAL)

5个描述必须分为3类：

### 类别1 - 产品型号聚焦 (2个)
- 包含产品型号 + 核心功能

### 类别2 - 品牌+品类聚焦 (2个)
- 包含品牌名 + 应用场景

### 类别3 - 功能痛点解决 (1个)
- 纯功能/痛点解决方案

**每个描述必须包含明确CTA**：
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours

## Sitelinks结构：2+2+2 (CRITICAL)

6个Sitelinks必须分为3类：

### 类别1 - 产品型号 (2个)
- 包含产品型号的链接

### 类别2 - 品牌+品类 (2个)
- 品牌+品类导向的链接

### 类别3 - 功能+场景 (2个)
- 功能/场景导向的链接

## 单品链接特殊规则

**如果是单品链接（product link）**：
- 所有创意元素必须100%聚焦单品
- 禁止提到\"browse our collection\"
- 禁止提到其他品类名称

## 店铺链接特殊规则

**如果是店铺链接（store link）**：
- 目标：驱动用户进店探索
- **允许**使用\"Shop All\"类通用链接
- **可以**包含单品型号（可选）
- 必须与店铺整体主题相关

## 桶类型适配 (CRITICAL)

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
- US/UK: \"Limited Time\", \"Today Only\"
- DE: \"Nur heute\", \"Oferta limitada\"
- JA: \"今だけ\", \"期間制限\"

## 质量检查清单

生成后检查：
- [ ] 15个标题恰好5+5+5分类
- [ ] 5个描述包含明确CTA
- [ ] 6个Sitelinks完整
- [ ] 所有元素与单品/店铺类型一致
- [ ] 关键词嵌入率达标
- [ ] 桶主题覆盖率达标

如果不满足任何关键要求，重新生成。',
  version = 'v4.26',
  name = '广告创意生成v4.26 - 完整重写版',
  change_notes = 'v4.26 完整重写：5+5+5标题 + 2+2+1描述 + 2+2+2 Sitelinks + 桶类型适配'
WHERE prompt_id = 'ad_creative_generation' AND is_active = true AND version = 'v4.25'
  AND NOT EXISTS (
    SELECT 1 FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.26'
  );
