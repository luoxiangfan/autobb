-- 258: ad_creatives.keyword_bucket 仅允许 canonical 槽位 A/B/D（移除 C/S）

ALTER TABLE ad_creatives
DROP CONSTRAINT IF EXISTS ad_creatives_keyword_bucket_check;

ALTER TABLE ad_creatives
ADD CONSTRAINT ad_creatives_keyword_bucket_check
CHECK (keyword_bucket IS NULL OR keyword_bucket IN ('A', 'B', 'D'));

COMMENT ON COLUMN ad_creatives.keyword_bucket IS
  '创意槽位: A=品牌意图, B=商品型号/产品族意图, D=商品需求意图';
