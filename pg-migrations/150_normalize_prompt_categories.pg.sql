-- Ensure prompt categories use Chinese labels
UPDATE prompt_versions
SET category = '关键词聚类'
WHERE prompt_id = 'keyword_intent_clustering'
  AND category <> '关键词聚类';

UPDATE prompt_versions
SET category = '关键词生成'
WHERE prompt_id = 'keywords_generation'
  AND category <> '关键词生成';

UPDATE prompt_versions
SET category = '关键词生成'
WHERE category = 'keyword_generation'
  AND prompt_id <> 'keyword_intent_clustering';
