-- Migration: 157_ad_creative_generation_v4.43.sql
-- Description: ad_creative_generation v4.43 - CTA对齐 + 关键词嵌入强化
-- Date: 2026-02-04
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
  (SELECT id FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.43'),
  'ad_creative_generation',
  'v4.43',
  '广告创意生成',
  '广告创意生成v4.43 - CTA对齐 + 关键词嵌入强化',
  'CTA对齐评分口径；关键词嵌入率硬性达标；单品页防店铺化措辞',
  'prompts/ad_creative_generation_v4.43.txt',
  'buildAdCreativePrompt',
  replace('-- ============================================\n-- Google Ads 广告创意生成 v4.43\n-- KISS-3类型：A(品牌/信任) + B(场景+功能) + D(转化/价值)\n-- 强制证据约束 + 仅Headline#1品牌DKI + 多单品卖点混合\n-- v4.43: CTA对齐评分口径 + 关键词嵌入率硬性达标 + 单品页防“店铺化”措辞\n-- ============================================\n\n## 任务\n为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。\n\n## ⚠️ 字符限制（CRITICAL - 必须严格遵守）\n生成时必须控制长度，不得依赖后端截断：\n- Headlines：每个≤30字符（含空格、标点）\n- Descriptions：每个≤90字符（含空格、标点）\n- Callouts：每个≤25字符\n- Sitelink text：每个≤25字符\n- Sitelink description：每个≤35字符\n\n## 基本要求\n1. 所有内容必须使用目标语言：{{target_language}}\n2. 固定数量：15个标题，4个描述，6个Callouts，6个Sitelinks；关键词10-20个\n3. 所有创意元素必须与单品/店铺链接类型一致\n4. 每个元素必须语义完整，不得因字符限制而截断句子\n\n## 语言指令\n{{language_instruction}}\n\n## 产品/店铺信息\n{{link_type_section}}\n{{store_creative_instructions}}\n\nPRODUCT: {{product_description}}\nUSPs: {{unique_selling_points}}\nAUDIENCE: {{target_audience}}\nCOUNTRY: {{target_country}} | LANGUAGE: {{target_language}}\n\n{{enhanced_features_section}}\n{{localization_section}}\n{{brand_analysis_section}}\n{{extras_data}}\n\n## 🧩 补充单品优先级（仅当存在补充单品信息）\n如果在 EXTRAS DATA 或 VERIFIED FACTS 中出现以下前缀信息（如 `SUPPLEMENTAL PICKS` / `SUPPLEMENTAL HOOKS` / `STORE HOT FEATURES` / `STORE USER VOICES` / `STORE CATEGORIES` / `STORE PRICE RANGE`）：\n- 必须优先使用这些补充单品卖点与名称，作为主要创意素材\n- 需要“多单品卖点混合”：至少覆盖 2 个不同单品的卖点\n- 至少 2 个标题 + 1 个描述 + 1 个 Sitelink/Callout 需要引用补充单品信息（在不超字符限制的前提下）\n- 价格/评分等数字必须来自 VERIFIED FACTS，严禁编造\n**仅适用于店铺页(Store Page)**：产品页(Product Page)不做多单品混合，必须聚焦单一产品。\n\n{{verified_facts_section}}\n\n{{promotion_section}}\n{{theme_section}}\n{{reference_performance_section}}\n{{extracted_elements_section}}\n\n## ✅ Evidence-Only Claims（CRITICAL）\n你必须严格遵守以下规则，避免虚假陈述：\n- 只能使用"VERIFIED FACTS"中出现过的数字、折扣、限时、保障/支持承诺、覆盖范围、速度/时长等可验证信息\n- 如果VERIFIED FACTS中没有对应信息：不得编造，不得"默认有"，改用不含数字/不含承诺的表述\n- 不得写"24/7""X分钟开通""覆盖X国""X%折扣""退款保证""终身"等，除非VERIFIED FACTS明确提供\n- 若 VERIFIED FACTS 为空：禁止出现任何数字/促销/运费/保障/时效承诺，只能用非数值、非承诺的价值型表述\n- EXTRACTED 元素仅用于措辞参考，不得引入任何数字/承诺/限时/库存信息\n\n## 关键词使用规则\n{{ai_keywords_section}}\n{{keyword_bucket_section}}\n{{bucket_info_section}}\n\n**关键词嵌入规则**：\n- 8/15 (53%+) 标题必须包含关键词\n- 4/4 (100%) 描述必须包含关键词\n- 优先使用搜索量更高的关键词\n- 品牌词必须至少出现在2个标题中\n**硬性要求**：如未达到8/15关键词嵌入率，必须重写标题直到达标\n\n## 标题规则（15个，≤30字符）\n\n### Headline #1（MANDATORY）\n- 必须是：{KeyWord:{{brand}}} Official（如超长则允许仅 {KeyWord:{{brand}}}）\n- 只允许使用品牌词作为默认文本（避免无关替换）\n\n### DKI使用限制（CRITICAL）\n- 仅Headline #1 允许使用 {KeyWord:...}\n- 其他标题禁止使用DKI格式\n\n### 标题类型分布（保持多样性）\n使用以下指导生成剩余标题，避免重复表达：\n{{headline_brand_guidance}}\n{{headline_feature_guidance}}\n{{headline_promo_guidance}}\n{{headline_cta_guidance}}\n{{headline_urgency_guidance}}\n**紧迫感规则（CRITICAL）**：\n- 只有在 VERIFIED FACTS 或 PROMOTION 中存在明确“库存/截止时间/限时”证据时，才允许使用紧迫感标题\n- 若无证据，禁止使用任何限时/库存暗示\n\n**问题型标题（必需）**：\n- 至少2个标题为问题句（以?结尾），用于刺痛/共鸣（但不得编造事实）\n\n## 描述规则（4个，≤90字符）\n要求：每条描述都必须包含关键词，并以“目标语言的CTA”结尾（不得混语言）。\n**CTA硬性要求**：至少2条描述必须包含明确CTA词。\n- 若目标语言为 English：CTA必须包含以下动词之一（确保被识别）：Shop Now / Buy Now / Learn More / Get / Order / Start / Try / Sign Up\n- 若目标语言非 English：使用等价CTA动词（不得混语言）\n**单品页限制**：产品页不得使用“explore our collection/store”等店铺引导措辞\n\n### 描述结构（必须覆盖）\n{{description_1_guidance}}\n{{description_2_guidance}}\n{{description_3_guidance}}\n{{description_4_guidance}}\n\n**Pain → Solution（必需）**：\n- 至少1条描述必须按：痛点短句 → 解决方案 →（若有）证据点 → CTA\n- 证据点只能来自 VERIFIED FACTS / PROMOTION（EXTRACTED 仅作措辞参考）\n\n## Callouts（6个，≤25字符）\n{{callout_guidance}}\n\n## 桶类型适配（KISS-3类型）\n根据 {{bucket_type}} 调整创意角度：\n\n### 桶A（品牌/信任）\n- 强调官方、正品、可信、保障（仅限证据内）\n- 品牌词覆盖更高，但避免标题重复\n\n### 桶B（场景+功能）\n- 用“场景/痛点”开头，再用“功能/卖点”给出解决方案\n- 避免机械重复品牌词，保持场景/功能多样性\n\n### 桶D（转化/价值）\n- 优先突出可验证的优惠/价值点 + 强行动号召\n- 若无证据，不写折扣/限时/数字，只写“价值/省心/替代方案”类表述\n\n## 输出（JSON only）\n{{output_format_section}}\n**TYPE RULES（CRITICAL）**：\n- headlines[].type 与 descriptions[].type 必须是单一值\n- 禁止使用“|”拼接多个类型\n',
'
', char(10)),
  'Chinese',
  NULL,
  1,
  replace('v4.43:
1. CTA对齐评分口径（英文CTA动词白名单）
2. 关键词嵌入率硬性达标（≥8/15）
3. 单品页禁止店铺化措辞
',
'
', char(10)),
  '2026-02-04 14:30:00'
);

-- 3) 确保新版本激活
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.43';
