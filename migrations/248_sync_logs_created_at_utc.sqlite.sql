-- Migration: 248_sync_logs_created_at_utc.sqlite.sql
-- Purpose: Backfill sync_logs.created_at to UTC ISO (Z), aligned with started_at
-- Date: 2026-05-21

-- started_at stored as ISO UTC (ends with Z) -> use same value for created_at
UPDATE sync_logs
SET created_at = started_at
WHERE started_at IS NOT NULL
  AND TRIM(started_at) <> ''
  AND TRIM(started_at) LIKE '%Z'
  AND (created_at IS NULL OR created_at != started_at);

-- Legacy rows: created_at without Z but started_at has Z already handled above.
-- Normalize remaining created_at that still differ when started_at is SQLite datetime text.
UPDATE sync_logs
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', started_at)
WHERE started_at IS NOT NULL
  AND TRIM(started_at) <> ''
  AND TRIM(started_at) NOT LIKE '%Z'
  AND TRIM(started_at) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND (created_at IS NULL OR created_at != strftime('%Y-%m-%dT%H:%M:%fZ', started_at));
