-- Migration: 164_openclaw_execution_plane.sql
-- Date: 2026-02-07
-- Description: OpenClaw 命令执行平面（确认链路、步骤审计、回调幂等、日报投递审计）

-- ---------------------------------------------------------------------
-- 1) OpenClaw command runs
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_command_runs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
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
  confirm_required BOOLEAN NOT NULL DEFAULT 0,
  confirm_expires_at TEXT,
  idempotency_key TEXT,
  parent_request_id TEXT,
  queue_task_id TEXT,
  response_status INTEGER,
  response_body TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  confirm_token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  canceled_at TEXT,
  callback_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES openclaw_command_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(run_id),
  UNIQUE(confirm_token_hash)
);

CREATE INDEX IF NOT EXISTS idx_openclaw_command_confirms_user_status
  ON openclaw_command_confirms(user_id, status, expires_at);

-- ---------------------------------------------------------------------
-- 3) OpenClaw command steps
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_command_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 0,
  action_type TEXT NOT NULL DEFAULT 'proxy',
  request_json TEXT,
  response_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES openclaw_command_runs(id) ON DELETE CASCADE,
  UNIQUE(run_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_openclaw_command_steps_run
  ON openclaw_command_steps(run_id, step_index);

-- ---------------------------------------------------------------------
-- 4) OpenClaw callback events (idempotency)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_callback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(channel, event_id)
);

CREATE INDEX IF NOT EXISTS idx_openclaw_callback_events_user
  ON openclaw_callback_events(user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 5) Extend openclaw_action_logs
-- ---------------------------------------------------------------------
ALTER TABLE openclaw_action_logs ADD COLUMN run_id TEXT;
ALTER TABLE openclaw_action_logs ADD COLUMN risk_level TEXT;
ALTER TABLE openclaw_action_logs ADD COLUMN confirm_status TEXT;
ALTER TABLE openclaw_action_logs ADD COLUMN latency_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_openclaw_actions_run ON openclaw_action_logs(run_id);

-- ---------------------------------------------------------------------
-- 6) Extend openclaw_daily_reports delivery tracking
-- ---------------------------------------------------------------------
ALTER TABLE openclaw_daily_reports ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE openclaw_daily_reports ADD COLUMN delivery_error TEXT;
ALTER TABLE openclaw_daily_reports ADD COLUMN last_delivery_task_id TEXT;

CREATE INDEX IF NOT EXISTS idx_openclaw_reports_delivery_status
  ON openclaw_daily_reports(user_id, sent_status, report_date);
