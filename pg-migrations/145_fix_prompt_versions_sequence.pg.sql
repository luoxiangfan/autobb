-- Migration: 145_fix_prompt_versions_sequence.pg.sql
-- Description: Align prompt_versions_id_seq with max(id) to prevent duplicate key errors
-- Date: 2026-01-28
-- Database: PostgreSQL

DO $$
BEGIN
  IF to_regclass('public.prompt_versions') IS NOT NULL
     AND to_regclass('public.prompt_versions_id_seq') IS NOT NULL THEN
    PERFORM setval(
      'prompt_versions_id_seq',
      (SELECT COALESCE(MAX(id), 1) FROM prompt_versions)
    );
  END IF;
END $$;
