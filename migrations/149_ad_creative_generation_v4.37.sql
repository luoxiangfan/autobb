-- Migration: 149_ad_creative_generation_v4.37.sql
-- Description: ad_creative_generation v4.37 - 补充单品优先
-- Date: 2026-01-30
-- Database: SQLite

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 2) 幂等写入新版本（若已存在则更新内容）
INSERT OR REPLACE INTO prompt_versions (
  id,
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
  (SELECT id FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.37'),
  'ad_creative_generation',
  'v4.37',
  '广告创意生成',
  '广告创意生成v4.37 - 补充单品优先',
  '强化店铺模式下补充单品卖点优先级；要求在标题/描述/附加信息中优先使用补充单品信息（有则必用）',
  'prompts/ad_creative_generation_v4.37.txt',
  'buildAdCreativePrompt',
  replace('-- ============================================\n-- Google Ads 广告创意生成 v4.37\n-- KISS-3类型：A(品牌/信任) + B(场景+功能) + D(转化/价值)\n-- 强制证据约束 + 仅Headline#1品牌DKI + 补充单品优先\n-- ============================================\n\n## 任务\n为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。\n\n## ⚠️ 字符限制（CRITICAL - 必须严格遵守）\n生成时必须控制长度，不得依赖后端截断：\n- Headlines：每个≤30字符（含空格、标点）\n- Descriptions：每个≤90字符（含空格、标点）\n- Callouts：每个≤25字符\n- Sitelink text：每个≤25字符\n- Sitelink description：每个≤35字符\n\n## 基本要求\n1. 所有内容必须使用目标语言：{{target_language}}\n2. 固定数量：15个标题，4个描述，15个关键词，6个Callouts，6个Sitelinks\n3. 所有创意元素必须与单品/店铺链接类型一致\n4. 每个元素必须语义完整，不得因字符限制而截断句子\n\n## 语言指令\n{{language_instruction}}\n\n## 产品/店铺信息\n{{link_type_section}}\n\nPRODUCT: {{product_description}}\nUSPs: {{unique_selling_points}}\nAUDIENCE: {{target_audience}}\nCOUNTRY: {{target_country}} | LANGUAGE: {{target_language}}\n\n{{enhanced_features_section}}\n{{localization_section}}\n{{brand_analysis_section}}\n{{extras_data}}\n\n## 🧩 补充单品优先级（仅当存在补充单品信息）\n如果在 EXTRAS DATA 或 VERIFIED FACTS 中出现以下前缀信息（如 `SUPPLEMENTAL PICKS` / `STORE HOT FEATURES` / `STORE USER VOICES` / `STORE CATEGORIES` / `STORE PRICE RANGE`）：\n- 必须优先使用这些补充单品卖点与名称，作为主要创意素材\n- 至少 2 个标题 + 1 个描述 + 1 个 Sitelink/Callout 需要引用补充单品信息（在不超字符限制的前提下）\n- 不得编造未出现的单品属性或价格\n\n{{verified_facts_section}}\n\n{{promotion_section}}\n{{theme_section}}\n{{reference_performance_section}}\n{{extracted_elements_section}}\n\n## ✅ Evidence-Only Claims（CRITICAL）\n你必须严格遵守以下规则，避免虚假陈述：\n- 只能使用“VERIFIED FACTS”中出现过的数字、折扣、限时、保障/支持承诺、覆盖范围、速度/时长等可验证信息\n- 如果VERIFIED FACTS中没有对应信息：不得编造，不得“默认有”，改用不含数字/不含承诺的表述\n- 不得写“24/7”“X分钟开通”“覆盖X国”“X%折扣”“退款保证”“终身”等，除非VERIFIED FACTS明确提供\n\n## 关键词使用规则\n{{ai_keywords_section}}\n{{keyword_bucket_section}}\n{{bucket_info_section}}\n\n**关键词嵌入规则**：\n- 8/15 (53%+) 标题必须包含关键词\n- 4/4 (100%) 描述必须包含关键词\n- 优先使用搜索量更高的关键词\n- 品牌词必须至少出现在2个标题中\n\n## 标题规则（15个，≤30字符）\n\n### Headline #1（MANDATORY）\n- 必须是：{KeyWord:{{brand}}} Official（如超长则允许仅 {KeyWord:{{brand}}}）\n- 只允许使用品牌词作为默认文本（避免无关替换）\n\n### DKI使用限制（CRITICAL）\n- 仅Headline #1 允许使用 {KeyWord:...}\n- 其他标题禁止使用DKI格式\n\n### 标题类型分布（保持多样性）\n使用以下指导生成剩余标题，避免重复表达：\n{{headline_brand_guidance}}\n{{headline_feature_guidance}}\n{{headline_promo_guidance}}\n{{headline_cta_guidance}}\n{{headline_urgency_guidance}}\n\n**问题型标题（必需）**：\n- 至少2个标题为问题句（以?结尾），用于刺痛/共鸣（但不得编造事实）\n\n## 描述规则（4个，≤90字符）\n要求：每条描述都必须包含关键词，并以“目标语言的CTA”结尾（不得混语言）。\n\n### 描述结构（必须覆盖）\n{{description_1_guidance}}\n{{description_2_guidance}}\n{{description_3_guidance}}\n{{description_4_guidance}}\n\n**Pain → Solution（必需）**：\n- 至少1条描述必须按：痛点短句 → 解决方案 →（若有）证据点 → CTA\n- 证据点只能来自 VERIFIED FACTS / PROMOTION / EXTRACTED 元素\n\n## Callouts（6个，≤25字符）\n{{callout_guidance}}\n\n## 桶类型适配（KISS-3类型）\n根据 {{bucket_type}} 调整创意角度：\n\n### 桶A（品牌/信任）\n- 强调官方、正品、可信、保障（仅限证据内）\n- 品牌词覆盖更高，但避免标题重复\n\n### 桶B（场景+功能）\n- 用“场景/痛点”开头，再用“功能/卖点”给出解决方案\n- 避免机械重复品牌词，保持场景/功能多样性\n\n### 桶D（转化/价值）\n- 优先突出可验证的优惠/价值点 + 强行动号召\n- 若无证据，不写折扣/限时/数字，只写“价值/省心/替代方案”类表述\n\n## 输出（JSON only）\n{{output_format_section}}\n','
',char(10)),
  'Chinese',
  NULL,
  1,
  replace('v4.37:
1. 强化店铺模式的补充单品优先级（SUPPLEMENTAL PICKS/STORE HOT FEATURES 等）
2. 要求在标题/描述/Sitelink或Callout中优先使用补充单品卖点
3. 保留证据约束，禁止编造单品信息
','
',char(10)),
  '2026-01-30 10:00:00'
);

-- 3) 确保新版本激活
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.37';
