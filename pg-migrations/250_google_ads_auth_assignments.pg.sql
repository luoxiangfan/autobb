-- Migration 250: Google Ads auth assignment (admin shared vs per-user config)
CREATE TABLE IF NOT EXISTS google_ads_auth_assignments (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  assignment_mode TEXT NOT NULL DEFAULT 'own' CHECK (assignment_mode IN ('own', 'shared_admin')),
  shared_admin_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  auth_type TEXT NOT NULL DEFAULT 'oauth' CHECK (auth_type IN ('oauth', 'service_account')),
  configured_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_google_ads_auth_assignments_shared_admin
  ON google_ads_auth_assignments(shared_admin_user_id);
