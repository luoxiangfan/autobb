-- 259: Remove redundant campaign_backups.campaign_data (scalar columns + campaign_config suffice)

ALTER TABLE campaign_backups DROP COLUMN IF EXISTS campaign_data;
