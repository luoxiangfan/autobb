-- Migration: 174_openclaw_feishu_chat_health_logs.pg.sql
-- Date: 2026-02-10
-- Description: 持久化 Feishu 聊天链路健康日志（放行/拦截/错误）

CREATE TABLE IF NOT EXISTS openclaw_feishu_chat_health_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  message_id TEXT,
  chat_id TEXT,
  chat_type TEXT,
  message_type TEXT,
  sender_primary_id TEXT,
  sender_open_id TEXT,
  sender_union_id TEXT,
  sender_user_id TEXT,
  sender_candidates_json TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('allowed', 'blocked', 'error')),
  reason_code TEXT NOT NULL,
  reason_message TEXT,
  message_text TEXT,
  message_text_length INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_openclaw_feishu_health_user_created
  ON openclaw_feishu_chat_health_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_openclaw_feishu_health_user_decision_created
  ON openclaw_feishu_chat_health_logs(user_id, decision, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_openclaw_feishu_health_message_id
  ON openclaw_feishu_chat_health_logs(message_id);
