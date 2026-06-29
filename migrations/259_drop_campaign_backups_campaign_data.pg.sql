-- 259: Remove redundant campaign_backups.campaign_data (scalar columns + campaign_config suffice)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'campaign_backups'
  ) THEN
    ALTER TABLE campaign_backups DROP COLUMN IF EXISTS campaign_data;
  END IF;
END $$;
