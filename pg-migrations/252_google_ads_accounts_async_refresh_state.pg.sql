-- Migration 252: Shared async Google Ads accounts refresh state (multi-instance)
CREATE TABLE IF NOT EXISTS google_ads_accounts_async_refresh_state (
  sync_key TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('oauth', 'service_account')),
  service_account_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_google_ads_accounts_async_refresh_user
  ON google_ads_accounts_async_refresh_state(user_id, updated_at);
