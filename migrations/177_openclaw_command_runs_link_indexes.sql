-- Migration: 177_openclaw_command_runs_link_indexes.sql
-- Date: 2026-02-13
-- Description: Speed up Feishu chat health linking (parent_request_id + sender/time)

CREATE INDEX IF NOT EXISTS idx_openclaw_command_runs_user_parent_request_id
  ON openclaw_command_runs(user_id, parent_request_id);

CREATE INDEX IF NOT EXISTS idx_openclaw_command_runs_user_channel_sender_created
  ON openclaw_command_runs(user_id, channel, sender_id, created_at DESC);

