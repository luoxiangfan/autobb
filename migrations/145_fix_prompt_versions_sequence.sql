-- Migration: 145_fix_prompt_versions_sequence.sql
-- Description: No-op for SQLite (sequence alignment not applicable)
-- Date: 2026-01-28
-- Database: SQLite

-- SQLite does not use sequences like PostgreSQL.
-- This migration exists only to keep numbering aligned.
SELECT 1;
