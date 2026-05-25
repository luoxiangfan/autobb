-- Migration 250: Google Ads auth assignment (admin shared vs per-user config)
CREATE TABLE IF NOT EXISTS google_ads_auth_assignments (
  user_id INTEGER PRIMARY KEY,
  assignment_mode TEXT NOT NULL DEFAULT 'own' CHECK (assignment_mode IN ('own', 'shared_admin')),
  shared_admin_user_id INTEGER,
  auth_type TEXT NOT NULL DEFAULT 'oauth' CHECK (auth_type IN ('oauth', 'service_account')),
  configured_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (shared_admin_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (configured_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_google_ads_auth_assignments_shared_admin
  ON google_ads_auth_assignments(shared_admin_user_id);
