-- Migration: 117_prompt_v4.32_brand_coverage_optimization.pg.sql
-- Description: 品牌词覆盖率优化 - 平衡品牌认知与多样性
-- Date: 2025-12-27
-- Changes:
--   1. 品牌词约束：从"最多3次"改为"3-4次"（平衡覆盖率与多样性）
--   2. 明确品牌词变体使用（Official, Store, The Brand）
--   3. 添加品牌词覆盖率检查（20-27%）
--   4. 添加产品名覆盖率检查（13%）
--   5. 修复质量检查清单与描述一致的冲突

-- Step 1: 删除可能存在的 v4.32（幂等性）
DELETE FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.32';

-- Step 2: 停用当前active版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- Step 3: 插入新版本 v4.32
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
  created_by,
  change_notes
) VALUES (
  'ad_creative_generation',
  'v4.32',
  '广告创意生成',
  '广告创意生成v4.32 - 品牌词覆盖率优化',
  '品牌词覆盖率优化：平衡品牌认知与多样性',
  'prompts/ad_creative_generation_v4.32.txt',
  'generateAdCreative',
  E'-- ============================================\n## 任务\n为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。\n\n## ⚠️ 字符限制（CRITICAL - 必须严格遵守）\n\n生成时必须控制长度，不得依赖后端截断：\n- **Headlines**: 每个≤30字符（含空格、标点）\n- **Descriptions**: 每个≤90字符（含空格、标点）\n- **Callouts**: 每个≤25字符\n- **Sitelink text**: 每个≤25字符\n- **Sitelink description**: 每个≤35字符\n\n**验证方法**：生成每个元素后立即检查字符数，超长则重写为更短版本。\n\n## 输出格式\nJSON格式：\n{\n  "headlines": ["标题1", "标题2", ...],  // 15个，每个≤30字符\n  "descriptions": ["描述1", "描述2", "描述3", "描述4"],  // 4个，每个≤90字符\n  "keywords": ["关键词1", "关键词2", ...],  // 15个\n  "callouts": ["卖点1", "卖点2", "卖点3", "卖点4", "卖点5", "卖点6"],  // 6个，每个≤25字符\n  "sitelinks": [  // 6个\n    {"text": "≤25字符", "url": "/", "description": "≤35字符"}\n  ]\n}\n\n## 基本要求\n1. 所有内容必须使用目标语言：{{target_language}}\n2. 固定数量：15个标题，4个描述，15个关键词，6个Callouts，6个Sitelinks\n3. 所有创意元素必须与单品/店铺链接类型一致\n4. 每个元素必须语义完整，不得因字符限制而截断句子\n\n## 语言指令\n{{language_instruction}}\n\n## 产品/店铺信息\n{{link_type_section}}\n\nPRODUCT: {{product_description}}\nUSPs: {{unique_selling_points}}\nAUDIENCE: {{target_audience}}\nCOUNTRY: {{target_country}} | LANGUAGE: {{target_language}}\n\n{{enhanced_features_section}}\n{{localization_section}}\n{{brand_analysis_section}}\n{{extras_data}}\n{{promotion_section}}\n{{theme_section}}\n{{reference_performance_section}}\n{{extracted_elements_section}}\n\n## 关键词使用规则\n{{ai_keywords_section}}\n\n**关键词嵌入规则**：\n- 8/15 (53%+) 标题必须包含关键词\n- 4/4 (100%) 描述必须包含关键词\n- 优先使用搜索量>1000的关键词\n- 品牌词必须在至少2个标题中出现\n\n## 标题结构：2+4+4+2+3 (Ad Strength优化版) ⭐\n\n15个标题必须分为5类，确保类型多样性（Type Distribution得分）：\n\n### 类别1 - 品牌型 (2个)\n- 包含品牌名和产品名\n- 第1个标题必须使用动态关键词插入：{KeyWord:品牌名}\n- 示例（≤30字符）：\n  * "{KeyWord:Roborock} Official" (26字符)\n  * "Roborock Qrevo Curv 2 Pro" (25字符)\n\n### 类别2 - 功能型 (4个)\n- 突出技术参数和功能特性\n- 必须包含具体数字或技术名称\n- 示例（≤30字符）：\n  * "25000 Pa Suction Power" (22字符)\n  * "100°C Hot Water Mop Washing" (27字符)\n  * "AdaptiLift Chassis Tech" (23字符)\n  * "7-Week Hands-Free Cleaning" (26字符)\n\n### 类别3 - 利益型 (4个)\n- 强调用户获得的利益和价值\n- 示例（≤30字符）：\n  * "Maison Propre Sans Effort" (26字符)\n  * "Gagnez du Temps Chaque Jour" (27字符)\n  * "Idéal Pour Poils d''Animaux" (26字符)\n  * "Un Sol Toujours Impeccable" (26字符)\n\n### 类别4 - 问题型 (2个) ⭐ 新增\n- 以问题引发用户共鸣\n- 必须以问号结尾\n- 示例（≤30字符）：\n  * "Tired of Pet Hair?" (19字符)\n  * "Want a Truly Clean Floor?" (25字符)\n  * "Besoin d''un Sol Impeccable?" (28字符)\n\n### 类别5 - 对比/紧迫型 (3个) ⭐ 优化\n- 突出竞争优势或紧迫感\n- **至少1个必须包含紧迫感关键词**（Limited / Today / Now / Exclusive / Ends Soon / Last Chance / Limité / Limitée / Aujourd''hui）\n- 示例（≤30字符）：\n  * "Why Choose Qrevo Curv 2 Pro?" (29字符)\n  * "Best Robot Vacuum for Pets" (26字符)\n  * "Limited Time: Save 23%" (23字符)\n\n**品牌词覆盖率优化（平衡品牌认知与多样性）**：\n- 品牌词"{{brand}}"出现次数：**3-4次**（覆盖率20-27%）\n  - 至少3个标题包含品牌词（确保品牌认知）\n  - 最多4个标题包含品牌词（避免过度重复影响多样性）\n- 完整产品名"{{product_name}}"出现次数：**2次**（确保产品精准匹配）\n- 品牌词变体可混合使用："{KeyWord:{{brand}}} Official", "{{brand}} Store", "The {{brand}}"\n- 类别1的2个品牌型标题必须包含品牌词\n\n**品牌词覆盖率检查**：\n- ✅ 品牌词覆盖率 = 包含品牌词的标题数 / 15，范围20-27%（3-4个标题）\n- ✅ 产品名覆盖率 = 包含产品名的标题数 / 15，约为13%（2个标题）\n- ✅ 如果品牌词覆盖不足3个，AI必须补充品牌词标题\n- ✅ 如果品牌词覆盖超过4个，AI必须减少品牌词使用\n\n## 描述结构：2+1+1 (Ad Strength优化版) ⭐\n\n4个描述必须分为3类，每个≤90字符且语义完整：\n\n### 类别1 - 产品型号+核心功能 (2个)\n- 包含产品型号 + 2-3个核心功能 + **英文CTA**\n- **每个描述必须以明确的英文CTA结尾**：Shop Now / Buy Now / Get Yours / Order Now / Learn More\n- 示例（≤90字符）：\n  * "Roborock Qrevo Curv 2 Pro: 25000Pa suction, 100°C mop. Save 23%. Shop Now!" (78字符)\n  * "Découvrez le Roborock Qrevo Curv 2 Pro. Châssis AdaptiLift. -23%. Buy Now!" (77字符)\n\n### 类别2 - 利益驱动 (1个) ⭐\n- 聚焦用户获得的利益和生活改善 + **英文CTA**\n- 示例（≤90字符）：\n  * "Gagnez du temps chaque jour. Parfait pour les animaux et tapis. Get Yours!" (77字符)\n\n### 类别3 - 信任+紧迫感 (1个) ⭐\n- 结合社交证明、保障和限时优惠 + **英文CTA**\n- 示例（≤90字符）：\n  * "5000+ clients satisfaits. Garantie 2 ans. Offre -23% limitée. Order Now!" (76字符)\n\n**CTA要求（CRITICAL）**：\n- 每个描述必须以英文CTA结尾（Google Ads最佳实践）\n- CTA选项：Shop Now / Buy Now / Get Yours / Order Now / Learn More / Start Now\n- CTA前可以用句号或感叹号分隔\n\n## Callouts结构：2+2+2\n\n6个Callouts必须分为3类，每个≤25字符：\n\n### 类别1 - 信任信号 (2个)\n示例：\n- "Official Store" (14字符)\n- "2-Year Warranty" (15字符)\n\n### 类别2 - 优惠促销 (2个)\n示例：\n- "Free Shipping" (13字符)\n- "Limited Time -23%" (17字符)\n\n### 类别3 - 产品特性 (2个)\n示例：\n- "25000Pa Suction" (15字符)\n- "100°C Mop Cleaning" (18字符)\n\n## Sitelinks结构：2+2+2\n\n6个Sitelinks，每个text≤25字符，description≤35字符：\n\n### 类别1 - 产品型号 (2个)\n示例：\n- text: "Qrevo Curv 2 Pro" (16字符)\n  description: "25000Pa suction, 100°C mop" (27字符)\n\n### 类别2 - 品牌+品类 (2个)\n示例：\n- text: "Roborock Vacuums" (17字符)\n  description: "Official store, free shipping" (31字符)\n\n### 类别3 - 功能+场景 (2个)\n示例：\n- text: "Pet Hair Solution" (17字符)\n  description: "Auto cleaning for pet owners" (29字符)\n\n## 单品链接特殊规则\n\n**如果是单品链接（product link）**：\n- 所有创意元素必须100%聚焦单品\n- 禁止提到"browse our collection"\n- 禁止提到其他品类名称\n\n## 店铺链接特殊规则\n\n**如果是店铺链接（store link）**：\n- 目标：驱动用户进店探索\n- **允许**使用"Shop All"类通用链接\n- **可以**包含单品型号（可选）\n- 必须与店铺整体主题相关\n\n## 桶类型适配\n\n根据 {{bucket_type}} 调整创意角度：\n\n### 桶A（品牌认知）\n- 全部15个标题必须包含品牌词\n- 强调官方、正品、信任\n\n### 桶B（使用场景）\n- 至少10个标题包含场景词（pet, home, family...）\n- 强调使用场景和用户痛点\n\n### 桶C（功能特性）\n- 至少10个标题包含功能词（suction, power, heat...）\n- 强调技术参数和独特功能\n\n### 桶D（价格促销）\n- 至少10个标题包含价格/促销词\n- 强调折扣、限时、性价比\n\n### 桶S（综合平衡）\n- 平衡品牌、功能、场景\n- 适合全面覆盖\n\n## 本地化规则\n\n### 货币符号\n- US: USD ($)\n- UK: GBP (£)\n- EU: EUR (€)\n\n### 紧急感本地化\n- US/UK: "Limited Time", "Today Only"\n- DE: "Nur heute", "Zeitlich begrenzt"\n- FR: "Offre limitée", "Aujourd''hui seulement"\n- JA: "今だけ", "期間限定"\n\n## 质量检查清单（Ad Strength优化版）⭐\n\n生成后检查：\n- [ ] 所有headlines ≤30字符且语义完整\n- [ ] 所有descriptions ≤90字符且语义完整\n- [ ] 所有callouts ≤25字符（6个）\n- [ ] 所有sitelink text ≤25字符\n- [ ] 所有sitelink description ≤35字符\n- [ ] 15个标题分为2+4+4+2+3（5种类型）\n- [ ] 至少2个问题型标题（以?结尾）\n- [ ] 至少1个紧迫感标题（包含Limited/Today/Now等）\n- [ ] 品牌词覆盖率20-27%（3-4个标题包含品牌词）\n- [ ] 产品名覆盖率13%（2个标题包含完整产品名）\n- [ ] 类别1的2个品牌型标题必须包含品牌词\n- [ ] 4个描述全部包含英文CTA结尾\n- [ ] 6个Callouts分为2+2+2\n- [ ] 6个Sitelinks完整\n- [ ] 15个关键词\n- [ ] 关键词嵌入率达标\n\n如果不满足任何关键要求，重新生成。',
  TRUE,
  NULL,
  '品牌词覆盖率优化 v4.32：
1. 品牌词约束：从"最多3次"改为"3-4次"（平衡覆盖率与多样性）
2. 明确品牌词变体使用（Official, Store, The Brand）
3. 添加品牌词覆盖率检查（20-27%）
4. 添加产品名覆盖率检查（13%）
5. 修复质量检查清单与描述一致的冲突
6. 预期效果：品牌搜索转化率提升15-20%'
);

-- Step 4: 验证插入
SELECT prompt_id, version, name, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY created_at DESC
LIMIT 3;
