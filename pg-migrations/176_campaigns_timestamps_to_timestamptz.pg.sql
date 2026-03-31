-- Migration: 176_campaigns_timestamps_to_timestamptz.pg.sql
-- Date: 2026-02-12
-- Description: 将 campaigns 的关键时间字段从 TEXT 迁移为 TIMESTAMPTZ（幂等），消除类型不一致导致的查询/更新错误

DO $$
DECLARE
  created_at_type TEXT;
  updated_at_type TEXT;
  last_sync_at_type TEXT;
  deleted_at_type TEXT;
  published_at_type TEXT;
  ts_pattern CONSTANT TEXT := '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?([+-][0-9]{2}(:?[0-9]{2})?|Z)?$';
BEGIN
  SELECT data_type INTO created_at_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'created_at';

  SELECT data_type INTO updated_at_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'updated_at';

  SELECT data_type INTO last_sync_at_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'last_sync_at';

  SELECT data_type INTO deleted_at_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'deleted_at';

  SELECT data_type INTO published_at_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'published_at';

  -- created_at: TEXT -> TIMESTAMPTZ
  IF created_at_type = 'text' THEN
    IF EXISTS (
      SELECT 1 FROM campaigns
      WHERE created_at IS NOT NULL
        AND BTRIM(created_at) <> ''
        AND BTRIM(created_at) !~ ts_pattern
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'Migration 176 aborted: campaigns.created_at has non-parseable datetime text values';
    END IF;

    UPDATE campaigns
    SET created_at = NULLIF(BTRIM(created_at), '');

    UPDATE campaigns
    SET created_at = NOW()::text
    WHERE created_at IS NULL;

    ALTER TABLE campaigns
      ALTER COLUMN created_at TYPE TIMESTAMPTZ
      USING (
        CASE
          WHEN created_at ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
            THEN REPLACE(created_at, 'T', ' ')::timestamptz
          ELSE (REPLACE(created_at, 'T', ' ') || '+00')::timestamptz
        END
      );
  ELSIF created_at_type = 'timestamp without time zone' THEN
    ALTER TABLE campaigns
      ALTER COLUMN created_at TYPE TIMESTAMPTZ
      USING (created_at AT TIME ZONE 'UTC');
  END IF;

  -- updated_at: TEXT -> TIMESTAMPTZ
  IF updated_at_type = 'text' THEN
    IF EXISTS (
      SELECT 1 FROM campaigns
      WHERE updated_at IS NOT NULL
        AND BTRIM(updated_at) <> ''
        AND BTRIM(updated_at) !~ ts_pattern
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'Migration 176 aborted: campaigns.updated_at has non-parseable datetime text values';
    END IF;

    UPDATE campaigns
    SET updated_at = NULLIF(BTRIM(updated_at), '');

    UPDATE campaigns
    SET updated_at = NOW()::text
    WHERE updated_at IS NULL;

    ALTER TABLE campaigns
      ALTER COLUMN updated_at TYPE TIMESTAMPTZ
      USING (
        CASE
          WHEN updated_at ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
            THEN REPLACE(updated_at, 'T', ' ')::timestamptz
          ELSE (REPLACE(updated_at, 'T', ' ') || '+00')::timestamptz
        END
      );
  ELSIF updated_at_type = 'timestamp without time zone' THEN
    ALTER TABLE campaigns
      ALTER COLUMN updated_at TYPE TIMESTAMPTZ
      USING (updated_at AT TIME ZONE 'UTC');
  END IF;

  -- last_sync_at: TEXT -> TIMESTAMPTZ
  IF last_sync_at_type = 'text' THEN
    IF EXISTS (
      SELECT 1 FROM campaigns
      WHERE last_sync_at IS NOT NULL
        AND BTRIM(last_sync_at) <> ''
        AND BTRIM(last_sync_at) !~ ts_pattern
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'Migration 176 aborted: campaigns.last_sync_at has non-parseable datetime text values';
    END IF;

    UPDATE campaigns
    SET last_sync_at = NULLIF(BTRIM(last_sync_at), '');

    ALTER TABLE campaigns
      ALTER COLUMN last_sync_at TYPE TIMESTAMPTZ
      USING (
        CASE
          WHEN last_sync_at IS NULL THEN NULL
          WHEN last_sync_at ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
            THEN REPLACE(last_sync_at, 'T', ' ')::timestamptz
          ELSE (REPLACE(last_sync_at, 'T', ' ') || '+00')::timestamptz
        END
      );
  ELSIF last_sync_at_type = 'timestamp without time zone' THEN
    ALTER TABLE campaigns
      ALTER COLUMN last_sync_at TYPE TIMESTAMPTZ
      USING (last_sync_at AT TIME ZONE 'UTC');
  END IF;

  -- deleted_at: TEXT -> TIMESTAMPTZ
  IF deleted_at_type = 'text' THEN
    IF EXISTS (
      SELECT 1 FROM campaigns
      WHERE deleted_at IS NOT NULL
        AND BTRIM(deleted_at) <> ''
        AND BTRIM(deleted_at) !~ ts_pattern
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'Migration 176 aborted: campaigns.deleted_at has non-parseable datetime text values';
    END IF;

    UPDATE campaigns
    SET deleted_at = NULLIF(BTRIM(deleted_at), '');

    ALTER TABLE campaigns
      ALTER COLUMN deleted_at TYPE TIMESTAMPTZ
      USING (
        CASE
          WHEN deleted_at IS NULL THEN NULL
          WHEN deleted_at ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
            THEN REPLACE(deleted_at, 'T', ' ')::timestamptz
          ELSE (REPLACE(deleted_at, 'T', ' ') || '+00')::timestamptz
        END
      );
  ELSIF deleted_at_type = 'timestamp without time zone' THEN
    ALTER TABLE campaigns
      ALTER COLUMN deleted_at TYPE TIMESTAMPTZ
      USING (deleted_at AT TIME ZONE 'UTC');
  END IF;

  -- published_at: TEXT -> TIMESTAMPTZ
  IF published_at_type = 'text' THEN
    IF EXISTS (
      SELECT 1 FROM campaigns
      WHERE published_at IS NOT NULL
        AND BTRIM(published_at) <> ''
        AND BTRIM(published_at) !~ ts_pattern
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'Migration 176 aborted: campaigns.published_at has non-parseable datetime text values';
    END IF;

    UPDATE campaigns
    SET published_at = NULLIF(BTRIM(published_at), '');

    ALTER TABLE campaigns
      ALTER COLUMN published_at TYPE TIMESTAMPTZ
      USING (
        CASE
          WHEN published_at IS NULL THEN NULL
          WHEN published_at ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
            THEN REPLACE(published_at, 'T', ' ')::timestamptz
          ELSE (REPLACE(published_at, 'T', ' ') || '+00')::timestamptz
        END
      );
  ELSIF published_at_type = 'timestamp without time zone' THEN
    ALTER TABLE campaigns
      ALTER COLUMN published_at TYPE TIMESTAMPTZ
      USING (published_at AT TIME ZONE 'UTC');
  END IF;

END $$;

-- 统一默认值（与业务 SQL 的 NOW() 保持一致）
ALTER TABLE campaigns
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();
