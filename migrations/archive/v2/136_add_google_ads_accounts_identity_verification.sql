-- Migration: 136_add_google_ads_accounts_identity_verification.sql
-- Date: 2026-01-08
-- Description: 为 google_ads_accounts 增加广告主身份验证（Identity Verification）字段

ALTER TABLE google_ads_accounts
ADD COLUMN identity_verification_program_status TEXT;

ALTER TABLE google_ads_accounts
ADD COLUMN identity_verification_start_deadline_time TEXT;

ALTER TABLE google_ads_accounts
ADD COLUMN identity_verification_completion_deadline_time TEXT;

ALTER TABLE google_ads_accounts
ADD COLUMN identity_verification_overdue INTEGER NOT NULL DEFAULT 0;

ALTER TABLE google_ads_accounts
ADD COLUMN identity_verification_checked_at TEXT;

