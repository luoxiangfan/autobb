-- Migration: 248_sync_logs_created_at_utc.pg.sql
-- Purpose: Backfill sync_logs.created_at to UTC, aligned with started_at (ISO Z)
-- Date: 2026-05-21

DO $$
DECLARE
  created_at_type TEXT;
  started_at_type TEXT;
  iso_z_pattern CONSTANT TEXT := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$';
  updated_count BIGINT;
BEGIN
  SELECT data_type INTO created_at_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sync_logs' AND column_name = 'created_at';

  SELECT data_type INTO started_at_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sync_logs' AND column_name = 'started_at';

  IF created_at_type IS NULL OR started_at_type IS NULL THEN
    RAISE NOTICE 'sync_logs timestamp columns not found, skipping backfill';
    RETURN;
  END IF;

  -- started_at is ISO UTC (Z) -> align created_at to the same instant
  IF created_at_type = 'text' AND started_at_type = 'text' THEN
    UPDATE sync_logs
    SET created_at = BTRIM(started_at)
    WHERE started_at IS NOT NULL
      AND BTRIM(started_at) <> ''
      AND BTRIM(started_at) ~ iso_z_pattern
      AND created_at IS DISTINCT FROM BTRIM(started_at);
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'sync_logs created_at backfill (text/text): % rows', updated_count;

    -- Legacy created_at with +08 offset text, no ISO started_at
    UPDATE sync_logs
    SET created_at = to_char(
      (created_at::timestamptz AT TIME ZONE 'UTC'),
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
    WHERE created_at IS NOT NULL
      AND BTRIM(created_at) <> ''
      AND BTRIM(created_at) ~ '[+-][0-9]{2}'
      AND (started_at IS NULL OR BTRIM(started_at) = '' OR BTRIM(started_at) !~ iso_z_pattern);
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'sync_logs created_at legacy +offset normalize (text): % rows', updated_count;

  ELSIF created_at_type IN ('timestamp with time zone', 'timestamp without time zone')
        AND started_at_type = 'text' THEN
    UPDATE sync_logs
    SET created_at = (BTRIM(started_at))::timestamptz
    WHERE started_at IS NOT NULL
      AND BTRIM(started_at) <> ''
      AND BTRIM(started_at) ~ iso_z_pattern
      AND created_at IS DISTINCT FROM (BTRIM(started_at))::timestamptz;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'sync_logs created_at backfill (ts/text): % rows', updated_count;

  ELSIF created_at_type IN ('timestamp with time zone', 'timestamp without time zone')
        AND started_at_type IN ('timestamp with time zone', 'timestamp without time zone') THEN
    UPDATE sync_logs
    SET created_at = started_at
    WHERE started_at IS NOT NULL
      AND created_at IS DISTINCT FROM started_at;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'sync_logs created_at backfill (ts/ts): % rows', updated_count;
  END IF;
END $$;
