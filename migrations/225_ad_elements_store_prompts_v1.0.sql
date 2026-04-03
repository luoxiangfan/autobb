-- Migration: 225_ad_elements_store_prompts_v1.0.sql
-- Description: Register store ad-elements prompts with version management (headlines/descriptions)
-- Date: 2026-04-02
-- Database: SQLite

-- 1) Deactivate current active versions for target prompt IDs
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id IN ('ad_elements_headlines_store', 'ad_elements_descriptions_store')
  AND is_active = 1;

-- 2) Upsert store headlines prompt v1.0
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
)
VALUES (
  (SELECT id FROM prompt_versions WHERE prompt_id = 'ad_elements_headlines_store' AND version = 'v1.0'),
  'ad_elements_headlines_store',
  'v1.0',
  '广告创意生成',
  '店铺广告标题生成v1.0',
  '店铺多商品标题Prompt，基于输入证据生成非模板化高相关标题。',
  'prompts/ad_elements_headlines_store_v1.0.txt',
  'getMultipleProductHeadlinePrompt',
  REPLACE('You are a Google Ads copywriter focused on relevance and conversion.

Target output language: {{targetLanguage}}
Brand: {{brand}}

Sampled products (input evidence):
{{topProducts}}

High-volume keywords (input evidence):
{{topKeywords}}

Task:
Generate exactly 15 Google Search ad headlines.

Rules:
1. Output language must be {{targetLanguage}}.
2. Every headline must be 30 characters or less.
3. Headlines 1-5 should combine brand and concrete product terms from sampled products.
4. Headlines 6-10 should use high-intent wording and integrate provided high-volume keywords naturally.
5. Headlines 11-15 should emphasize verifiable differentiators from input evidence (features, use cases, ratings).
6. Allow natural "brand + high-intent term" phrasing when it improves relevance.
7. Do not fabricate claims, rankings, promotions, or official status that are not present in input.
8. Avoid template-like transaction phrases and avoid keyword stuffing.
9. Do not use DKI syntax such as {KeyWord:...}.
10. Keep the 15 headlines semantically diverse and non-duplicated.

Output JSON:
{
  "headlines": ["headline1", "headline2", "headline3", "headline4", "headline5", "headline6", "headline7", "headline8", "headline9", "headline10", "headline11", "headline12", "headline13", "headline14", "headline15"]
}

Return JSON only.', '\n', char(10)),
  'English',
  NULL,
  1,
  REPLACE('v1.0:
1. 新增店铺多商品标题Prompt（ad_elements_headlines_store）。
2. 强制仅使用输入证据生成，禁止模板交易词拼接与不可验证宣称。
3. 保留合理业务需求：允许自然的品牌前缀与高意图词组合。', '\n', char(10)),
  '2026-04-02 11:40:00'
);

-- 3) Upsert store descriptions prompt v1.0
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
)
VALUES (
  (SELECT id FROM prompt_versions WHERE prompt_id = 'ad_elements_descriptions_store' AND version = 'v1.0'),
  'ad_elements_descriptions_store',
  'v1.0',
  '广告创意生成',
  '店铺广告描述生成v1.0',
  '店铺多商品描述Prompt，基于输入证据生成非模板化高相关描述。',
  'prompts/ad_elements_descriptions_store_v1.0.txt',
  'getMultipleProductDescriptionPrompt',
  REPLACE('You are a Google Ads copywriter focused on relevance and conversion.

Target output language: {{targetLanguage}}
Brand: {{brand}}

Sampled products (input evidence):
{{topProducts}}

Task:
Generate exactly 4 Google Search ad descriptions.

Rules:
1. Output language must be {{targetLanguage}}.
2. Every description must be 90 characters or less.
3. Description 1 should summarize one concrete product value backed by input evidence.
4. Description 2 should emphasize feature and use-case fit from provided evidence.
5. Description 3 should use ratings or review signals only when present in input.
6. Description 4 should end with a clear CTA and must not invent promotions.
7. Do not fabricate claims, rankings, promotions, or official status that are not present in input.
8. Avoid fixed transaction templates and keep wording concise.
9. Keep the 4 descriptions semantically diverse and non-duplicated.

Output JSON:
{
  "descriptions": ["description1", "description2", "description3", "description4"]
}

Return JSON only.', '\n', char(10)),
  'English',
  NULL,
  1,
  REPLACE('v1.0:
1. 新增店铺多商品描述Prompt（ad_elements_descriptions_store）。
2. 强制仅使用输入证据生成，禁止模板交易词拼接与不可验证宣称。', '\n', char(10)),
  '2026-04-02 11:40:00'
);

-- 4) Ensure target versions stay active
UPDATE prompt_versions
SET is_active = 1
WHERE (prompt_id = 'ad_elements_headlines_store' AND version = 'v1.0')
   OR (prompt_id = 'ad_elements_descriptions_store' AND version = 'v1.0');
