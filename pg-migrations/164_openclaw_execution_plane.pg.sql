-- Migration: 164_openclaw_execution_plane.pg.sql
-- Date: 2026-02-07
-- Description: OpenClaw 命令执行平面（确认链路、步骤审计、回调幂等、日报投递审计）

-- ---------------------------------------------------------------------
-- 1) OpenClaw command runs
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_command_runs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_type TEXT NOT NULL DEFAULT 'session',
  channel TEXT,
  sender_id TEXT,
  intent TEXT,
  request_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  request_query_json TEXT,
  request_body_json TEXT,
  risk_level TEXT NOT NULL DEFAULT 'low',
  status TEXT NOT NULL DEFAULT 'draft',
  confirm_required BOOLEAN NOT NULL DEFAULT FALSE,
  confirm_expires_at TIMESTAMP,
  idempotency_key TEXT,
  parent_request_id TEXT,
  queue_task_id TEXT,
  response_status INTEGER,
  response_body TEXT,
  error_message TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_openclaw_command_runs_user_status
  ON openclaw_command_runs(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_openclaw_command_runs_user_created
  ON openclaw_command_runs(user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 2) OpenClaw command confirms
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_command_confirms (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES openclaw_command_runs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  confirm_token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP NOT NULL,
  confirmed_at TIMESTAMP,
  canceled_at TIMESTAMP,
  callback_event_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(run_id),
  UNIQUE(confirm_token_hash)
);

CREATE INDEX IF NOT EXISTS idx_openclaw_command_confirms_user_status
  ON openclaw_command_confirms(user_id, status, expires_at);

-- ---------------------------------------------------------------------
-- 3) OpenClaw command steps
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_command_steps (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES openclaw_command_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL DEFAULT 0,
  action_type TEXT NOT NULL DEFAULT 'proxy',
  request_json TEXT,
  response_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  latency_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(run_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_openclaw_command_steps_run
  ON openclaw_command_steps(run_id, step_index);

-- ---------------------------------------------------------------------
-- 4) OpenClaw callback events (idempotency)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_callback_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  payload_json TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel, event_id)
);

CREATE INDEX IF NOT EXISTS idx_openclaw_callback_events_user
  ON openclaw_callback_events(user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 5) Extend openclaw_action_logs
-- ---------------------------------------------------------------------
ALTER TABLE openclaw_action_logs ADD COLUMN IF NOT EXISTS run_id TEXT;
ALTER TABLE openclaw_action_logs ADD COLUMN IF NOT EXISTS risk_level TEXT;
ALTER TABLE openclaw_action_logs ADD COLUMN IF NOT EXISTS confirm_status TEXT;
ALTER TABLE openclaw_action_logs ADD COLUMN IF NOT EXISTS latency_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_openclaw_actions_run ON openclaw_action_logs(run_id);

-- ---------------------------------------------------------------------
-- 6) Extend openclaw_daily_reports delivery tracking
-- ---------------------------------------------------------------------
ALTER TABLE openclaw_daily_reports ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE openclaw_daily_reports ADD COLUMN IF NOT EXISTS delivery_error TEXT;
ALTER TABLE openclaw_daily_reports ADD COLUMN IF NOT EXISTS last_delivery_task_id TEXT;

CREATE INDEX IF NOT EXISTS idx_openclaw_reports_delivery_status
  ON openclaw_daily_reports(user_id, sent_status, report_date);
